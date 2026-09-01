import type { DraftOrder } from "@/src/domain/schemas";
import type { ConversationIntent } from "@/src/order-understanding/intent-router";
import type { OrderActionType, PlannedOrderAction } from "@/src/order-understanding/order-actions";

export const MAX_TABLE_EVENTS = 60;
export const MAX_HISTORY_SNAPSHOTS = 20;

export interface TableMemoryEvent {
  id: string;
  tableId: string;
  utteranceId: string;
  createdAt: string;
  intent: ConversationIntent;
  action: OrderActionType;
  status: "applied" | "answered" | "ignored" | "needs_confirmation";
  summary: string;
  productIds: string[];
  confidence: number;
}

export interface DraftHistory {
  past: DraftOrder[];
  present?: DraftOrder;
  future: DraftOrder[];
}

export function stableUtteranceId(tableId: string, text: string): string {
  const normalized = `${tableId}|${text.toLocaleLowerCase("nl-BE").replace(/\s+/g, " ").trim()}`;
  let hash = 2_166_136_261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `utt-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function memoryEventFromAction(
  tableId: string,
  utteranceId: string,
  action: PlannedOrderAction,
  hasBlockingIssue = false,
): TableMemoryEvent {
  return {
    id: `${utteranceId}:${action.type}:${action.productIds.join("-") || "context"}`,
    tableId,
    utteranceId,
    createdAt: new Date().toISOString(),
    intent: action.intent,
    action: action.type,
    status: hasBlockingIssue ? "needs_confirmation" : action.type === "ANSWER_QUESTION" ? "answered" : action.mutatesOrder ? "applied" : "ignored",
    summary: action.summary.slice(0, 180),
    productIds: action.productIds.slice(0, 5),
    confidence: action.confidence,
  };
}

export function appendTableEvents(current: TableMemoryEvent[], additions: TableMemoryEvent[]): TableMemoryEvent[] {
  const unique = new Map(current.map((event) => [event.id, event]));
  for (const event of additions) unique.set(event.id, event);
  return [...unique.values()].sort((left, right) => left.createdAt.localeCompare(right.createdAt)).slice(-MAX_TABLE_EVENTS);
}

export function wasUtteranceProcessed(events: TableMemoryEvent[], utteranceId: string, withinMs = 30_000): boolean {
  const cutoff = Date.now() - withinMs;
  return events.some((event) => event.utteranceId === utteranceId && event.status !== "needs_confirmation" && new Date(event.createdAt).getTime() >= cutoff);
}

export function pushDraftHistory(history: DraftHistory, next: DraftOrder): DraftHistory {
  if (!history.present) return { past: [], present: next, future: [] };
  return { past: [...history.past, history.present].slice(-MAX_HISTORY_SNAPSHOTS), present: next, future: [] };
}

export function undoDraft(history: DraftHistory): DraftHistory {
  const previous = history.past.at(-1);
  if (!previous || !history.present) return history;
  return { past: history.past.slice(0, -1), present: previous, future: [history.present, ...history.future].slice(0, MAX_HISTORY_SNAPSHOTS) };
}

export function redoDraft(history: DraftHistory): DraftHistory {
  const next = history.future[0];
  if (!next || !history.present) return history;
  return { past: [...history.past, history.present].slice(-MAX_HISTORY_SNAPSHOTS), present: next, future: history.future.slice(1) };
}
