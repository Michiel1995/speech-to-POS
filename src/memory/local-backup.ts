import { z } from "zod";

import type { DraftOrder } from "@/src/domain/schemas";
import { parseLanguageLearning } from "@/src/learning/local-language-learning";
import {
  ContextRecordSchema,
  DraftRecordSchema,
  EventsRecordSchema,
  parseContextRecord,
  parseDraftRecord,
  parseEventsRecord,
  serializeLocalState,
} from "@/src/memory/local-state";
import { BACKUP_CONTROLLED_STORAGE_KEYS, LOCAL_STORAGE_KEYS } from "@/src/memory/storage-keys";

export const LOCAL_BACKUP_VERSION = 1;
export const MAX_LOCAL_BACKUP_BYTES = 2 * 1024 * 1024;
const MAX_ROLLBACK_BYTES = 4 * 1024 * 1024;
const MAX_BACKUP_TABLES = 100;
const MAX_BACKUP_LINES = 500;
const MAX_BACKUP_EVENTS = 3_000;

export interface StoragePort {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const ApprovedLanguageMappingSchema = z.object({
  id: z.string().min(1).max(240),
  spokenFragment: z.string().min(2).max(100),
  productId: z.string().min(1).max(180),
  evidenceCount: z.number().int().positive(),
  status: z.literal("APPROVED"),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();

const ApprovedLanguageStateSchema = z.object({
  version: z.literal(2),
  mappings: z.array(ApprovedLanguageMappingSchema).max(200),
}).strict();

export const LocalBackupSchema = z.object({
  schemaVersion: z.literal(LOCAL_BACKUP_VERSION),
  product: z.literal("Service Ears"),
  createdAt: z.string().datetime(),
  data: z.object({
    activeTableId: z.string().min(1).max(100).nullable(),
    draftsByTable: DraftRecordSchema,
    contextByTable: ContextRecordSchema,
    eventsByTable: EventsRecordSchema,
    approvedLanguage: ApprovedLanguageStateSchema,
  }).strict(),
}).strict().superRefine((backup, context) => {
  const tableIds = new Set([
    ...Object.keys(backup.data.draftsByTable),
    ...Object.keys(backup.data.contextByTable),
    ...Object.keys(backup.data.eventsByTable),
  ]);
  const lineCount = Object.values(backup.data.draftsByTable)
    .reduce((total, draft) => total + draft.lines.length, 0);
  const eventCount = Object.values(backup.data.eventsByTable)
    .reduce((total, events) => total + events.length, 0);

  if (tableIds.size > MAX_BACKUP_TABLES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `maximaal ${MAX_BACKUP_TABLES} tafels` });
  }
  if (lineCount > MAX_BACKUP_LINES) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `maximaal ${MAX_BACKUP_LINES} bestellijnen` });
  }
  if (eventCount > MAX_BACKUP_EVENTS) {
    context.addIssue({ code: z.ZodIssueCode.custom, message: `maximaal ${MAX_BACKUP_EVENTS} gebeurtenissen` });
  }
});

export type LocalBackup = z.infer<typeof LocalBackupSchema>;

export interface LocalBackupPreview {
  activeTableId: string | null;
  draftCount: number;
  lineCount: number;
  contextTableCount: number;
  eventCount: number;
  approvedMappingCount: number;
}

export type LocalBackupParseResult =
  | { ok: true; backup: LocalBackup; preview: LocalBackupPreview }
  | { ok: false; error: string };

type ControlledStorageKey = (typeof BACKUP_CONTROLLED_STORAGE_KEYS)[number];
type RawStorageSnapshot = Record<ControlledStorageKey, string | null>;

const RawStorageSnapshotSchema = z.object({
  [LOCAL_STORAGE_KEYS.activeTable]: z.string().nullable(),
  [LOCAL_STORAGE_KEYS.drafts]: z.string().nullable(),
  [LOCAL_STORAGE_KEYS.context]: z.string().nullable(),
  [LOCAL_STORAGE_KEYS.events]: z.string().nullable(),
  [LOCAL_STORAGE_KEYS.languageLearning]: z.string().nullable(),
}).strict();

const RollbackSchema = z.object({
  version: z.literal(1),
  createdAt: z.string().datetime(),
  values: RawStorageSnapshotSchema,
}).strict();

function utf8Bytes(value: string): number {
  return new TextEncoder().encode(value).byteLength;
}

function snapshotStorage(storage: StoragePort): RawStorageSnapshot {
  return Object.fromEntries(
    BACKUP_CONTROLLED_STORAGE_KEYS.map((key) => [key, storage.getItem(key)]),
  ) as RawStorageSnapshot;
}

function restoreSnapshot(storage: StoragePort, snapshot: RawStorageSnapshot): void {
  for (const key of BACKUP_CONTROLLED_STORAGE_KEYS) {
    const value = snapshot[key];
    if (value === null) storage.removeItem(key);
    else storage.setItem(key, value);
  }
}

function snapshotMatches(storage: StoragePort, expected: RawStorageSnapshot): boolean {
  return BACKUP_CONTROLLED_STORAGE_KEYS.every((key) => storage.getItem(key) === expected[key]);
}

function backupPreview(backup: LocalBackup): LocalBackupPreview {
  return {
    activeTableId: backup.data.activeTableId,
    draftCount: Object.keys(backup.data.draftsByTable).length,
    lineCount: Object.values(backup.data.draftsByTable).reduce((total, draft) => total + draft.lines.length, 0),
    contextTableCount: Object.keys(backup.data.contextByTable).length,
    eventCount: Object.values(backup.data.eventsByTable).reduce((total, events) => total + events.length, 0),
    approvedMappingCount: backup.data.approvedLanguage.mappings.length,
  };
}

export function buildLocalBackup(storage: StoragePort, now = new Date()): LocalBackup {
  const learning = parseLanguageLearning(storage.getItem(LOCAL_STORAGE_KEYS.languageLearning));
  return LocalBackupSchema.parse({
    schemaVersion: LOCAL_BACKUP_VERSION,
    product: "Service Ears",
    createdAt: now.toISOString(),
    data: {
      activeTableId: storage.getItem(LOCAL_STORAGE_KEYS.activeTable),
      draftsByTable: parseDraftRecord(storage.getItem(LOCAL_STORAGE_KEYS.drafts)),
      contextByTable: parseContextRecord(storage.getItem(LOCAL_STORAGE_KEYS.context)),
      eventsByTable: parseEventsRecord(storage.getItem(LOCAL_STORAGE_KEYS.events)),
      approvedLanguage: {
        version: 2,
        mappings: learning.mappings.filter((mapping) => mapping.status === "APPROVED"),
      },
    },
  });
}

export function formatLocalBackup(backup: LocalBackup): string {
  return JSON.stringify(backup, null, 2);
}

export function parseLocalBackup(text: string): LocalBackupParseResult {
  if (utf8Bytes(text) > MAX_LOCAL_BACKUP_BYTES) {
    return { ok: false, error: "Dit bestand is groter dan 2 MB en kan niet veilig worden hersteld." };
  }
  try {
    const result = LocalBackupSchema.safeParse(JSON.parse(text) as unknown);
    if (!result.success) {
      return { ok: false, error: "Deze back-up is beschadigd, onvolledig of van een niet-ondersteunde versie." };
    }
    return { ok: true, backup: result.data, preview: backupPreview(result.data) };
  } catch {
    return { ok: false, error: "Dit is geen geldig Service Ears-back-upbestand." };
  }
}

function restoredDrafts(drafts: Record<string, DraftOrder>, now: Date): Record<string, DraftOrder> {
  return Object.fromEntries(Object.entries(drafts).map(([tableId, draft]) => {
    const safeDraft = { ...draft };
    delete safeDraft.posSubmission;
    delete safeDraft.sentBy;
    const warningId = `restored:${draft.id}`;
    const warnings = safeDraft.warnings.some((warning) => warning.id === warningId)
      ? safeDraft.warnings
      : [...safeDraft.warnings, {
        id: warningId,
        type: "stale_menu" as const,
        message: "Hersteld concept: controleer de actuele kaart en beschikbaarheid voor verzending.",
      }];
    return [tableId, {
      ...safeDraft,
      status: "NOT_SENT" as const,
      updatedAt: now.toISOString(),
      warnings,
    }];
  }));
}

function desiredSnapshot(backup: LocalBackup, now: Date): RawStorageSnapshot {
  const drafts = restoredDrafts(backup.data.draftsByTable, now);
  return {
    [LOCAL_STORAGE_KEYS.activeTable]: backup.data.activeTableId,
    [LOCAL_STORAGE_KEYS.drafts]: serializeLocalState(drafts),
    [LOCAL_STORAGE_KEYS.context]: serializeLocalState(backup.data.contextByTable),
    [LOCAL_STORAGE_KEYS.events]: serializeLocalState(backup.data.eventsByTable),
    [LOCAL_STORAGE_KEYS.languageLearning]: JSON.stringify(backup.data.approvedLanguage),
  };
}

export function applyLocalBackupAtomically(storage: StoragePort, backup: LocalBackup, now = new Date()): void {
  const validated = LocalBackupSchema.parse(backup);
  const previous = snapshotStorage(storage);
  const previousRollback = storage.getItem(LOCAL_STORAGE_KEYS.backupRollback);
  const rollback = JSON.stringify({ version: 1, createdAt: now.toISOString(), values: previous });
  if (utf8Bytes(rollback) > MAX_ROLLBACK_BYTES) {
    throw new Error("De huidige lokale staat is te groot om veilig terug te draaien.");
  }

  const desired = desiredSnapshot(validated, now);
  try {
    storage.setItem(LOCAL_STORAGE_KEYS.backupRollback, rollback);
    restoreSnapshot(storage, desired);
    if (!snapshotMatches(storage, desired)) throw new Error("Controle van opgeslagen gegevens is mislukt.");
  } catch (error) {
    try {
      restoreSnapshot(storage, previous);
      if (previousRollback === null) storage.removeItem(LOCAL_STORAGE_KEYS.backupRollback);
      else storage.setItem(LOCAL_STORAGE_KEYS.backupRollback, previousRollback);
    } catch {
      // The original error is more useful; the caller can keep the app open and retry.
    }
    throw error;
  }
}

export function hasLocalBackupRollback(storage: StoragePort): boolean {
  const raw = storage.getItem(LOCAL_STORAGE_KEYS.backupRollback);
  if (!raw || utf8Bytes(raw) > MAX_ROLLBACK_BYTES) return false;
  try {
    return RollbackSchema.safeParse(JSON.parse(raw) as unknown).success;
  } catch {
    return false;
  }
}

export function restorePreviousLocalStateAtomically(storage: StoragePort): void {
  const raw = storage.getItem(LOCAL_STORAGE_KEYS.backupRollback);
  if (!raw || utf8Bytes(raw) > MAX_ROLLBACK_BYTES) throw new Error("Er is geen geldige vorige staat beschikbaar.");
  let parsed: z.infer<typeof RollbackSchema>;
  try {
    parsed = RollbackSchema.parse(JSON.parse(raw) as unknown);
  } catch {
    throw new Error("De vorige staat is beschadigd en kan niet veilig worden teruggezet.");
  }

  const current = snapshotStorage(storage);
  try {
    restoreSnapshot(storage, parsed.values);
    if (!snapshotMatches(storage, parsed.values)) throw new Error("Controle van de teruggezette gegevens is mislukt.");
    storage.removeItem(LOCAL_STORAGE_KEYS.backupRollback);
  } catch (error) {
    try {
      restoreSnapshot(storage, current);
      storage.setItem(LOCAL_STORAGE_KEYS.backupRollback, raw);
    } catch {
      // Preserve the first actionable failure.
    }
    throw error;
  }
}
