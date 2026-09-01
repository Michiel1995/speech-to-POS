import { z } from "zod";

import { DraftOrderSchema, type DraftOrder } from "@/src/domain/schemas";
import { CONVERSATION_INTENTS } from "@/src/order-understanding/intent-router";
import { ORDER_ACTION_TYPES } from "@/src/order-understanding/order-actions";
import type { TableMemoryEvent } from "@/src/memory/table-memory";

export const LOCAL_STATE_VERSION = 1;

export interface StoredTableContext {
  productIds: string[];
  updatedAt: string;
}

export const ContextSchema = z.object({
  productIds: z.array(z.string().min(1)).max(12),
  updatedAt: z.string().datetime(),
});

export const TableMemoryEventSchema = z.object({
  id: z.string().min(1),
  tableId: z.string().min(1),
  utteranceId: z.string().min(1),
  createdAt: z.string().datetime(),
  intent: z.enum(CONVERSATION_INTENTS),
  action: z.enum(ORDER_ACTION_TYPES),
  status: z.enum(["applied", "answered", "ignored", "needs_confirmation"]),
  summary: z.string().min(1).max(180),
  productIds: z.array(z.string().min(1)).max(5),
  confidence: z.number().min(0).max(1),
});

export const DraftRecordSchema = z.record(z.string(), DraftOrderSchema);
export const ContextRecordSchema = z.record(z.string(), ContextSchema);
export const EventsRecordSchema = z.record(z.string(), z.array(TableMemoryEventSchema).max(60));

function parseRecord<T>(value: string | null, schema: z.ZodType<T>): T | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    const isEnvelope = parsed && typeof parsed === "object" && "version" in parsed && "data" in parsed;
    if (isEnvelope && (parsed as { version?: unknown }).version !== LOCAL_STATE_VERSION) return undefined;
    const candidate = isEnvelope ? (parsed as { data?: unknown }).data : parsed;
    const result = schema.safeParse(candidate);
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}

export function serializeLocalState(value: unknown): string {
  return JSON.stringify({ version: LOCAL_STATE_VERSION, data: value });
}

export function parseDraftRecord(value: string | null): Record<string, DraftOrder> {
  return parseRecord(value, DraftRecordSchema) ?? {};
}

export function parseContextRecord(value: string | null): Record<string, StoredTableContext> {
  return parseRecord(value, ContextRecordSchema) ?? {};
}

export function parseEventsRecord(value: string | null): Record<string, TableMemoryEvent[]> {
  return parseRecord(value, EventsRecordSchema) ?? {};
}
