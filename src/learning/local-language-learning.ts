export type LearnedMappingStatus = "PENDING" | "APPROVED";

export interface LearnedLanguageMapping {
  id: string;
  spokenFragment: string;
  productId: string;
  evidenceCount: number;
  status: LearnedMappingStatus;
  createdAt: string;
  updatedAt: string;
}

export interface LanguageLearningState {
  version: 2;
  mappings: LearnedLanguageMapping[];
}

export const EMPTY_LANGUAGE_LEARNING: LanguageLearningState = { version: 2, mappings: [] };
const AUTOMATIC_APPROVAL_EVIDENCE = 3;

function normalizeFragment(value: string): string {
  return value.toLocaleLowerCase("nl-BE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9 .'-]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
}

function mappingId(fragment: string, productId: string): string {
  return `mapping:${productId}:${fragment.replace(/\s+/g, "-")}`;
}

export function parseLanguageLearning(value: string | null): LanguageLearningState {
  if (!value) return EMPTY_LANGUAGE_LEARNING;
  try {
    const parsed = JSON.parse(value) as Partial<LanguageLearningState>;
    if (parsed.version !== 2 || !Array.isArray(parsed.mappings)) return EMPTY_LANGUAGE_LEARNING;
    const mappings = parsed.mappings.filter((mapping): mapping is LearnedLanguageMapping =>
      Boolean(mapping && typeof mapping.id === "string" && typeof mapping.spokenFragment === "string" && typeof mapping.productId === "string" && (mapping.status === "PENDING" || mapping.status === "APPROVED")),
    ).slice(0, 200);
    return { version: 2, mappings };
  } catch {
    return EMPTY_LANGUAGE_LEARNING;
  }
}

export function recordCorrection(state: LanguageLearningState, spokenFragment: string, productId: string): LanguageLearningState {
  const fragment = normalizeFragment(spokenFragment);
  if (fragment.length < 2 || !productId) return state;
  const now = new Date().toISOString();
  const id = mappingId(fragment, productId);
  const existing = state.mappings.find((mapping) => mapping.id === id);
  const evidenceCount = (existing?.evidenceCount ?? 0) + 1;
  const hasConflict = state.mappings.some((mapping) => mapping.spokenFragment === fragment && mapping.productId !== productId);
  const status: LearnedMappingStatus = !hasConflict && evidenceCount >= AUTOMATIC_APPROVAL_EVIDENCE ? "APPROVED" : existing?.status ?? "PENDING";
  const next: LearnedLanguageMapping = existing
    ? { ...existing, evidenceCount, status, updatedAt: now }
    : { id, spokenFragment: fragment, productId, evidenceCount, status, createdAt: now, updatedAt: now };
  return { version: 2, mappings: [...state.mappings.filter((mapping) => mapping.id !== id), next].slice(-200) };
}

export function addApprovedMapping(state: LanguageLearningState, spokenFragment: string, productId: string): LanguageLearningState {
  const recorded = recordCorrection(state, spokenFragment, productId);
  const fragment = normalizeFragment(spokenFragment);
  return { ...recorded, mappings: recorded.mappings.map((mapping) => mapping.id === mappingId(fragment, productId) ? { ...mapping, status: "APPROVED" } : mapping) };
}

/** A POS choice clicked by the waiter is direct supervision. */
export function recordExplicitCorrection(
  state: LanguageLearningState,
  spokenFragment: string,
  productId: string,
): LanguageLearningState {
  const fragment = normalizeFragment(spokenFragment);
  const recorded = recordCorrection(state, fragment, productId);
  const hasConflict = recorded.mappings.some((mapping) =>
    mapping.spokenFragment === fragment && mapping.productId !== productId,
  );
  if (hasConflict) return recorded;
  return {
    ...recorded,
    mappings: recorded.mappings.map((mapping) =>
      mapping.id === mappingId(fragment, productId)
        ? { ...mapping, status: "APPROVED", updatedAt: new Date().toISOString() }
        : mapping,
    ),
  };
}

export function approveMapping(state: LanguageLearningState, id: string): LanguageLearningState {
  return { ...state, mappings: state.mappings.map((mapping) => mapping.id === id ? { ...mapping, status: "APPROVED", updatedAt: new Date().toISOString() } : mapping) };
}

export function removeMapping(state: LanguageLearningState, id: string): LanguageLearningState {
  return { ...state, mappings: state.mappings.filter((mapping) => mapping.id !== id) };
}

export function approvedAliases(state: LanguageLearningState): Array<{ spokenFragment: string; productId: string }> {
  return state.mappings.filter((mapping) => mapping.status === "APPROVED").map(({ spokenFragment, productId }) => ({ spokenFragment, productId }));
}

export function exportLanguageLearning(state: LanguageLearningState): string {
  return JSON.stringify(state, null, 2);
}
