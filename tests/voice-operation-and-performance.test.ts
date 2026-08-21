import { describe, expect, it } from "vitest";

import {
  appendVoicePerformanceSample,
  parseVoicePerformanceSamples,
  summarizeVoicePerformance,
  VoicePerformanceTrace,
} from "@/src/analytics/voice-performance";
import { userFacingVoiceError } from "@/src/ui/voice-errors";
import { VoiceOperationCoordinator } from "@/src/ui/voice-operation";
import { InterpretRequestSchema } from "@/src/domain/schemas";
import { MockPOSAdapter } from "@/src/pos/mock-adapter";
import { customer, interpret } from "@/tests/helpers";
import { parseDraftRecord, serializeLocalState } from "@/src/memory/local-state";
import {
  evaluateVoiceLatencyGate,
  FINAL_REVIEW_BUDGET_MS,
  FINAL_TRANSCRIPTION_BUDGET_MS,
  PROVISIONAL_REVIEW_BUDGET_MS,
} from "@/src/speech/latency-budget";

describe("voice operation race safety", () => {
  it("aborts the previous operation when a newer one begins", () => {
    const coordinator = new VoiceOperationCoordinator();
    const first = coordinator.begin({ kind: "conversation", tableId: "TABLE-12", draftRevision: "r1", nowMs: 10 });
    const second = coordinator.begin({ kind: "conversation", tableId: "TABLE-12", draftRevision: "r1", nowMs: 20 });
    expect(first.signal.aborted).toBe(true);
    expect(coordinator.isActive(first)).toBe(false);
    expect(coordinator.isActive(second)).toBe(true);
  });

  it("rejects a late result for the wrong table", () => {
    const coordinator = new VoiceOperationCoordinator();
    const token = coordinator.begin({ kind: "conversation", tableId: "TABLE-12", draftRevision: "r1" });
    expect(coordinator.mayCommit(token, { tableId: "TABLE-13", draftRevision: "r1" })).toBe(false);
  });

  it("rejects a late result after the concept changed", () => {
    const coordinator = new VoiceOperationCoordinator();
    const token = coordinator.begin({ kind: "correction", tableId: "TABLE-12", draftRevision: "r1" });
    expect(coordinator.mayCommit(token, { tableId: "TABLE-12", draftRevision: "r2" })).toBe(false);
  });

  it("makes completion idempotent", () => {
    const coordinator = new VoiceOperationCoordinator();
    const token = coordinator.begin({ kind: "text", tableId: "TABLE-12", draftRevision: "empty" });
    expect(coordinator.complete(token)).toBe(true);
    expect(coordinator.complete(token)).toBe(false);
  });
});

describe("privacy-safe latency metrics", () => {
  it("measures stop-to-review, transcription and interpretation separately", () => {
    const trace = new VoicePerformanceTrace("voice-1", "conversation", 0);
    trace.mark("stop", 1_000);
    trace.mark("provisional-review", 1_550);
    trace.mark("transcription-start", 1_050);
    trace.mark("transcription-end", 2_050);
    trace.mark("interpretation-start", 2_050);
    trace.mark("interpretation-end", 2_350);
    expect(trace.finish("ready", 2_400, "2026-08-14T10:00:00.000Z")).toMatchObject({
      totalMs: 2_400,
      stopToReviewMs: 1_400,
      provisionalStopToReviewMs: 550,
      transcriptionMs: 1_000,
      interpretationMs: 300,
    });
  });

  it("reports nearest-rank p50/p95 and error rate", () => {
    const samples = [100, 200, 300, 400, 5_000].map((totalMs, index) => ({
      operationId: `v${index}`,
      kind: "text" as const,
      outcome: index === 4 ? "error" as const : "ready" as const,
      totalMs,
      createdAt: "2026-08-14T10:00:00.000Z",
    }));
    expect(summarizeVoicePerformance(samples)).toMatchObject({ totalP50Ms: 300, totalP95Ms: 5_000, errorRate: 0.2 });
  });

  it("reports the provisional two-second and final five-second gates separately", () => {
    const samples = [
      { operationId: "v1", kind: "conversation" as const, outcome: "ready" as const, totalMs: 4_400, provisionalStopToReviewMs: 600, stopToReviewMs: 4_000, createdAt: "2026-08-14T10:00:00.000Z" },
      { operationId: "v2", kind: "conversation" as const, outcome: "ready" as const, totalMs: 5_000, provisionalStopToReviewMs: 1_800, stopToReviewMs: 4_800, createdAt: "2026-08-14T10:00:00.000Z" },
    ];
    expect(summarizeVoicePerformance(samples)).toMatchObject({
      provisionalStopToReviewP50Ms: 600,
      provisionalStopToReviewP95Ms: 1_800,
      stopToReviewP95Ms: 4_800,
    });
  });

  it("fails the hard latency gate at the boundary and reserves final render time", () => {
    expect(PROVISIONAL_REVIEW_BUDGET_MS).toBe(2_000);
    expect(FINAL_REVIEW_BUDGET_MS).toBe(5_000);
    expect(FINAL_TRANSCRIPTION_BUDGET_MS).toBeLessThan(FINAL_REVIEW_BUDGET_MS);
    expect(evaluateVoiceLatencyGate({ provisionalP95Ms: 1_999, finalP95Ms: 4_999 }).passed).toBe(true);
    expect(evaluateVoiceLatencyGate({ provisionalP95Ms: 2_000, finalP95Ms: 4_999 }).passed).toBe(false);
    expect(evaluateVoiceLatencyGate({ provisionalP95Ms: 1_999, finalP95Ms: 5_000 }).passed).toBe(false);
  });

  it("bounds and validates persisted samples", () => {
    let samples = [] as ReturnType<typeof parseVoicePerformanceSamples>;
    for (let index = 0; index < 120; index += 1) {
      samples = appendVoicePerformanceSample(samples, {
        operationId: `v${index}`, kind: "text", outcome: "ready", totalMs: index, createdAt: "2026-08-14T10:00:00.000Z",
      });
    }
    expect(samples).toHaveLength(100);
    expect(parseVoicePerformanceSamples(JSON.stringify(samples))).toHaveLength(100);
    expect(parseVoicePerformanceSamples("not-json")).toEqual([]);
  });
});

describe("typed user-facing errors", () => {
  it("explains how a five-second timeout can still yield a grounded Review", () => {
    expect(userFacingVoiceError({ code: "TRANSCRIPTION_BUDGET_EXCEEDED", status: 504 })).toMatchObject({
      title: "Lokale herkenning had meer tijd nodig",
      retryable: true,
    });
    expect(userFacingVoiceError({ code: "TRANSCRIPTION_BUDGET_EXCEEDED" }).message).toContain("menu-gegronde herkenning");
  });

  it("never exposes Failed to fetch", () => {
    expect(userFacingVoiceError({ message: "Failed to fetch" }).message).not.toMatch(/failed to fetch/i);
  });

  it("keeps the existing concept explicit for server failures", () => {
    expect(userFacingVoiceError({ status: 500 }).message).toContain("concept");
  });
});

describe("operation-bound API and POS contracts", () => {
  it("validates operation and base-revision metadata at the interpretation boundary", () => {
    expect(InterpretRequestSchema.parse({
      operationId: "voice-42",
      baseDraftRevision: "draft-r7",
      tableId: "TABLE-12",
      tableLabel: "Table 12",
      turns: [customer("Een Duvel")],
    })).toMatchObject({ operationId: "voice-42", baseDraftRevision: "draft-r7", tableId: "TABLE-12" });
  });

  it("reads a submitted mock order back by the durable POS reference", async () => {
    const adapter = new MockPOSAdapter();
    const draft = interpret([customer("Een Duvel")]);
    const sent = await adapter.createDraftOrder({ draft, idempotencyKey: "voice-readback-1", sentBy: "qa" });
    await expect(adapter.getOrder(sent.posSubmission!.externalOrderId)).resolves.toMatchObject({
      status: "SENT",
      posSubmission: { externalOrderId: sent.posSubmission!.externalOrderId },
    });
  });
});

describe("versioned local recovery", () => {
  it("migrates the valid legacy draft record without losing the order", () => {
    const draft = interpret([customer("Een Duvel")]);
    expect(parseDraftRecord(JSON.stringify({ [draft.tableId]: draft }))[draft.tableId].lines[0]).toMatchObject({
      productId: "POS-1001",
      quantity: 1,
    });
  });

  it("reads the versioned envelope and rejects corrupt drafts atomically", () => {
    const draft = interpret([customer("Een Duvel")]);
    expect(parseDraftRecord(serializeLocalState({ [draft.tableId]: draft }))[draft.tableId]).toBeDefined();
    expect(parseDraftRecord(JSON.stringify({ "TABLE-12": { lines: "corrupt" } }))).toEqual({});
    expect(parseDraftRecord(JSON.stringify({ version: 999, data: { [draft.tableId]: draft } }))).toEqual({});
  });
});
