import { describe, expect, it } from "vitest";

import type { DraftOrder } from "@/src/domain/schemas";
import {
  applyLocalBackupAtomically,
  buildLocalBackup,
  formatLocalBackup,
  hasLocalBackupRollback,
  MAX_LOCAL_BACKUP_BYTES,
  parseLocalBackup,
  restorePreviousLocalStateAtomically,
  type StoragePort,
} from "@/src/memory/local-backup";
import { parseDraftRecord, serializeLocalState } from "@/src/memory/local-state";
import { BACKUP_CONTROLLED_STORAGE_KEYS, LOCAL_STORAGE_KEYS } from "@/src/memory/storage-keys";
import { customer, interpret } from "@/tests/helpers";

class MemoryStorage implements StoragePort {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

class OneShotFailureStorage extends MemoryStorage {
  failKey?: string;

  override setItem(key: string, value: string): void {
    if (key === this.failKey) {
      this.failKey = undefined;
      throw new Error("quota failure");
    }
    super.setItem(key, value);
  }
}

const NOW = new Date("2026-08-15T04:00:00.000Z");

function sentDraft(): DraftOrder {
  const draft = interpret([customer("Een Duvel.")]);
  return {
    ...draft,
    status: "SENT",
    sentBy: "waiter-1",
    posSubmission: {
      adapter: "mock-pos",
      externalOrderId: "mock-order-1",
      idempotencyKey: "secret-idempotency",
      confirmedByWaiter: false,
      sentAt: NOW.toISOString(),
    },
  };
}

function seedExportableState(storage: MemoryStorage): DraftOrder {
  const draft = sentDraft();
  storage.setItem(LOCAL_STORAGE_KEYS.activeTable, draft.tableId);
  storage.setItem(LOCAL_STORAGE_KEYS.drafts, serializeLocalState({ [draft.tableId]: draft }));
  storage.setItem(LOCAL_STORAGE_KEYS.context, serializeLocalState({
    [draft.tableId]: { productIds: ["POS-1001"], updatedAt: NOW.toISOString() },
  }));
  storage.setItem(LOCAL_STORAGE_KEYS.events, serializeLocalState({ [draft.tableId]: [] }));
  storage.setItem(LOCAL_STORAGE_KEYS.languageLearning, JSON.stringify({
    version: 2,
    mappings: [
      {
        id: "mapping:POS-1001:duvelke",
        spokenFragment: "duvelke",
        productId: "POS-1001",
        evidenceCount: 3,
        status: "APPROVED",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
      {
        id: "mapping:POS-1002:sterreke",
        spokenFragment: "sterreke",
        productId: "POS-1002",
        evidenceCount: 1,
        status: "PENDING",
        createdAt: NOW.toISOString(),
        updatedAt: NOW.toISOString(),
      },
    ],
  }));
  storage.setItem("service-ears:voice-performance:v1", "PRIVATE_TIMING_SHOULD_NOT_EXPORT");
  storage.setItem("service-ears:live-edge-preview:v1", "PRIVATE_TRANSCRIPT_SHOULD_NOT_EXPORT");
  storage.setItem("service-ears:menu-cache:v1", "PRIVATE_MENU_SHOULD_NOT_EXPORT");
  return draft;
}

describe("local backup and restore", () => {
  it("exports only controlled work state and approved language mappings", () => {
    const storage = new MemoryStorage();
    seedExportableState(storage);

    const text = formatLocalBackup(buildLocalBackup(storage, NOW));
    const parsed = parseLocalBackup(text);

    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.preview).toMatchObject({ draftCount: 1, lineCount: 1, approvedMappingCount: 1 });
    expect(parsed.backup.data.approvedLanguage.mappings).toHaveLength(1);
    expect(text).not.toContain("PENDING");
    expect(text).not.toContain("PRIVATE_TIMING_SHOULD_NOT_EXPORT");
    expect(text).not.toContain("PRIVATE_TRANSCRIPT_SHOULD_NOT_EXPORT");
    expect(text).not.toContain("PRIVATE_MENU_SHOULD_NOT_EXPORT");
  });

  it("rejects malformed, unknown-version and oversized files before mutation", () => {
    expect(parseLocalBackup("not json")).toEqual({ ok: false, error: "Dit is geen geldig Service Ears-back-upbestand." });
    expect(parseLocalBackup(JSON.stringify({ schemaVersion: 99 }))).toMatchObject({ ok: false });
    expect(parseLocalBackup("x".repeat(MAX_LOCAL_BACKUP_BYTES + 1))).toMatchObject({ ok: false });
  });

  it("rejects backups that exceed the bounded table limit", () => {
    const storage = new MemoryStorage();
    const backup = buildLocalBackup(storage, NOW);
    backup.data.contextByTable = Object.fromEntries(Array.from({ length: 101 }, (_, index) => [
      `table-${index}`,
      { productIds: [], updatedAt: NOW.toISOString() },
    ]));

    expect(parseLocalBackup(formatLocalBackup(backup))).toMatchObject({ ok: false });
  });

  it("restores drafts as unsubmitted and removes stale POS success fields", () => {
    const source = new MemoryStorage();
    const originalDraft = seedExportableState(source);
    const backup = buildLocalBackup(source, NOW);
    const target = new MemoryStorage();

    applyLocalBackupAtomically(target, backup, new Date("2026-08-15T05:00:00.000Z"));

    const restored = parseDraftRecord(target.getItem(LOCAL_STORAGE_KEYS.drafts))[originalDraft.tableId];
    expect(restored.status).toBe("NOT_SENT");
    expect(restored.sentBy).toBeUndefined();
    expect(restored.posSubmission).toBeUndefined();
    expect(restored.updatedAt).toBe("2026-08-15T05:00:00.000Z");
    expect(restored.warnings).toContainEqual(expect.objectContaining({ type: "stale_menu" }));
    expect(hasLocalBackupRollback(target)).toBe(true);
  });

  it("keeps the prior state and prior rollback if any restore write fails", () => {
    const source = new MemoryStorage();
    seedExportableState(source);
    const target = new OneShotFailureStorage();
    for (const key of BACKUP_CONTROLLED_STORAGE_KEYS) target.setItem(key, `before:${key}`);
    target.setItem(LOCAL_STORAGE_KEYS.backupRollback, "prior-rollback");
    const before = Object.fromEntries(BACKUP_CONTROLLED_STORAGE_KEYS.map((key) => [key, target.getItem(key)]));
    target.failKey = LOCAL_STORAGE_KEYS.context;

    expect(() => applyLocalBackupAtomically(target, buildLocalBackup(source, NOW), NOW)).toThrow("quota failure");

    expect(Object.fromEntries(BACKUP_CONTROLLED_STORAGE_KEYS.map((key) => [key, target.getItem(key)]))).toEqual(before);
    expect(target.getItem(LOCAL_STORAGE_KEYS.backupRollback)).toBe("prior-rollback");
  });

  it("restores the exact pre-import state once and then removes the rollback", () => {
    const source = new MemoryStorage();
    seedExportableState(source);
    const target = new MemoryStorage();
    target.setItem(LOCAL_STORAGE_KEYS.activeTable, "table-before");
    target.setItem(LOCAL_STORAGE_KEYS.context, "context-before");
    const before = Object.fromEntries(BACKUP_CONTROLLED_STORAGE_KEYS.map((key) => [key, target.getItem(key)]));

    applyLocalBackupAtomically(target, buildLocalBackup(source, NOW), NOW);
    restorePreviousLocalStateAtomically(target);

    expect(Object.fromEntries(BACKUP_CONTROLLED_STORAGE_KEYS.map((key) => [key, target.getItem(key)]))).toEqual(before);
    expect(hasLocalBackupRollback(target)).toBe(false);
    expect(() => restorePreviousLocalStateAtomically(target)).toThrow("geen geldige vorige staat");
  });
});
