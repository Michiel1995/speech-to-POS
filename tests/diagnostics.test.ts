import { describe, expect, it } from "vitest";

import {
  buildPrivacySafeDiagnostics,
  formatPrivacySafeDiagnostics,
} from "@/src/ui/diagnostics";
import { createErrorIncident } from "@/src/ui/error-registry";
import { userFacingVoiceError } from "@/src/ui/voice-errors";

const health = {
  ok: true,
  adapter: "mock-pos",
  retention: "transient",
  offlineSpeechConfigured: true,
  offlineVadConfigured: true,
  localSpeech: {
    configured: true,
    policy: "adaptive",
    selectedModel: { id: "ggml-small", label: "Whisper Small", tier: "small", threadCount: 6 },
    installedModels: [{ tier: "small", eligible: true }, { tier: "large-turbo", eligible: true }],
    device: {
      totalMemoryGb: 15.9,
      freeMemoryGb: 6.123,
      logicalProcessors: 14,
      maxSpeechThreads: 6,
      maxConcurrentTranscriptions: 1,
      backend: "CPU/BLAS",
    },
    targetLatencyMs: 30_000,
    queuedTranscriptions: 0,
    activeTranscriptions: 0,
  },
  culinaryKnowledge: { concepts: 144, acousticAliases: 1_515, speechForms: 3_456 },
};

describe("privacy-safe diagnostics", () => {
  it("exports only operational health and aggregate performance", () => {
    const report = buildPrivacySafeDiagnostics({
      generatedAt: "2026-08-15T01:00:00.000Z",
      appVersion: "0.3.5",
      desktop: true,
      online: false,
      language: "nl-BE",
      viewport: { width: 1_440, height: 900, devicePixelRatio: 1.25 },
      health,
      performanceJson: JSON.stringify([{
        operationId: "private-operation-id",
        kind: "conversation",
        outcome: "ready",
        totalMs: 2_500,
        stopToReviewMs: 2_000,
        createdAt: "2026-08-15T00:59:00.000Z",
      }]),
      errorRegistryJson: JSON.stringify([createErrorIncident({
        friendly: userFacingVoiceError({ code: "TRANSCRIPTION_BUDGET_EXCEEDED" }),
        code: "TRANSCRIPTION_BUDGET_EXCEEDED",
        phase: "transcription",
        endpoint: "/api/transcribe",
        runtime: "desktop",
        online: false,
        now: new Date("2026-08-15T00:58:00.000Z"),
        referenceSuffix: "ERR001",
      })]),
    });

    expect(report).toMatchObject({
      schemaVersion: 2,
      app: { version: "0.3.5", runtime: "desktop", online: false },
      server: { ready: true, adapter: "mock-pos", retention: "transient" },
      speech: { configured: true, installedModelCount: 2, eligibleModelCount: 2 },
      performance: { samples: 1, totalP50Ms: 2_500, stopToReviewP50Ms: 2_000 },
      errors: { registered: 1, recent: [{ code: "TRANSCRIPTION_BUDGET_EXCEEDED", phase: "transcription" }] },
      privacy: { containsTranscript: false, containsOrders: false, containsOperationIds: false },
    });
    expect(JSON.stringify(report)).not.toContain("private-operation-id");
    expect(JSON.stringify(report)).not.toContain("2026-08-15T00:59:00.000Z");
  });

  it("cannot copy transcript, order or table data because they are not accepted as input", () => {
    const unsafeInput = {
      generatedAt: "2026-08-15T01:00:00.000Z",
      desktop: false,
      online: true,
      health,
      transcript: "twee Duvel en een steak",
      tableId: "TABLE-12",
      order: { lines: ["Duvel"] },
    };
    const serialized = formatPrivacySafeDiagnostics(unsafeInput);

    expect(serialized).not.toContain("twee Duvel");
    expect(serialized).not.toContain("TABLE-12");
    expect(serialized).not.toContain('"lines"');
  });

  it("degrades safely when the server is unavailable", () => {
    expect(buildPrivacySafeDiagnostics({
      generatedAt: "2026-08-15T01:00:00.000Z",
      desktop: false,
      online: true,
      serverErrorPresent: true,
    })).toMatchObject({
      app: { version: "browser", runtime: "browser" },
      server: { ready: false, serverErrorPresent: true },
      speech: { configured: false, queuedTranscriptions: 0, activeTranscriptions: 0 },
      performance: { samples: 0 },
    });
  });

  it("bounds internal strings and strips control characters", () => {
    const report = buildPrivacySafeDiagnostics({
      generatedAt: "2026-08-15T01:00:00.000Z",
      desktop: false,
      online: true,
      health: { adapter: `mock\n${"x".repeat(200)}` },
    });
    expect(report.server.adapter).not.toContain("\n");
    expect(report.server.adapter.length).toBeLessThanOrEqual(120);
  });
});
