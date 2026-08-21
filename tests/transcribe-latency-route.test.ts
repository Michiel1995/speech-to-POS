import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@/src/domain/errors";

const offlineTranscriber = vi.hoisted(() => vi.fn());

vi.mock("@/src/speech/offline-transcriber", () => ({
  transcribeHospitalityAudioOffline: offlineTranscriber,
}));

import { GET as interpretWarmup, POST as interpretPost } from "@/app/api/interpret/route";
import { POST as transcribePost } from "@/app/api/transcribe/route";

function audioRequest(text: string, confidence: number, final: boolean, contextProductIds: string[] = []): Request {
  const data = new FormData();
  data.append("operationId", "voice-latency-test");
  data.append("tableId", "TABLE-12");
  data.append("baseDraftRevision", "empty");
  data.append("audio", new File([new Uint8Array(128)], "test.wav", { type: "audio/wav" }));
  data.append("language", "nl");
  data.append("contextProductIds", JSON.stringify(contextProductIds));
  data.append("priorProductIds", "[]");
  data.append("dialectProfile", "auto");
  data.append("browserHypotheses", JSON.stringify([{ text, confidence }]));
  data.append("browserPreviewFinal", String(final));
  return new Request("http://localhost/api/transcribe", { method: "POST", body: data });
}

function localOnlyAudioRequest(): Request {
  const data = new FormData();
  data.append("operationId", "voice-local-only-test");
  data.append("tableId", "TABLE-12");
  data.append("baseDraftRevision", "empty");
  data.append("audio", new File([new Uint8Array(128)], "test.wav", { type: "audio/wav" }));
  data.append("language", "nl");
  data.append("contextProductIds", "[]");
  data.append("priorProductIds", "[]");
  data.append("dialectProfile", "auto");
  return new Request("http://localhost/api/transcribe", { method: "POST", body: data });
}

function localResult(text: string) {
  return {
    text,
    turns: [{ speaker: "unknown" as const, text }],
    language: "nl",
    engine: "whisper.cpp",
    confidence: 0.9,
    vadUsed: true,
    vadProfile: "balanced" as const,
    secondPassAttempted: false,
    secondPassSelected: false,
    hypothesisMargin: 0.9,
    hypotheses: [{ text, confidence: 0.9, totalScore: 0.9, pass: "primary", selected: true }],
    retained: false as const,
  };
}

describe("hard voice latency and factuality route", () => {
  beforeEach(() => {
    offlineTranscriber.mockReset();
    offlineTranscriber.mockResolvedValue(localResult("Doe mij twee Duvel"));
  });

  it("warms the menu interpretation path before the first spoken order", async () => {
    const response = await interpretWarmup();
    expect(response.ok).toBe(true);
    await expect(response.json()).resolves.toMatchObject({ warmed: true });
  });

  it("builds a strongly menu-grounded final concept inside two seconds without starting Whisper", async () => {
    const startedAt = performance.now();
    const speechResponse = await transcribePost(audioRequest("Doe mij twee Duvel", 0.74, true));
    const speech = await speechResponse.json() as { text: string; engine: string };
    expect(speechResponse.ok).toBe(true);
    expect(speech.engine).toBe("edge-live-confident");
    expect(offlineTranscriber).not.toHaveBeenCalled();

    const reviewResponse = await interpretPost(new Request("http://localhost/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "voice-latency-test",
        baseDraftRevision: "empty",
        tenantId: "tenant-demo-brussels",
        tableId: "TABLE-12",
        tableLabel: "Table 12",
        source: "audio",
        turns: [{ speaker: "customer", text: speech.text }],
      }),
    }));
    const review = await reviewResponse.json() as { draft: { lines: Array<{ productId: string; quantity: number }> } };
    expect(reviewResponse.ok).toBe(true);
    expect(review.draft.lines).toContainEqual(expect.objectContaining({ productId: "POS-1001", quantity: 2 }));
    expect(performance.now() - startedAt).toBeLessThan(2_000);
  });

  it("keeps a vague contextual phrase on the local verification route", async () => {
    const response = await transcribePost(audioRequest("Doe mij misschien die van daarnet", 0.9, true, ["POS-1001"]));
    expect(response.ok).toBe(true);
    expect(offlineTranscriber).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ maxPassMs: 4_200 }));
  });

  it("finishes from the recorded local WAV without requiring Edge live text", async () => {
    offlineTranscriber.mockResolvedValue(localResult("Doe mij twee Duvel"));
    const response = await transcribePost(localOnlyAudioRequest());
    const body = await response.json() as { text?: string; engine?: string };

    expect(response.ok).toBe(true);
    expect(body).toMatchObject({ text: "Doe mij twee Duvel", engine: "whisper.cpp" });
    expect(offlineTranscriber).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ maxPassMs: 8_000 }));
  });

  it("keeps a menu-grounded browser order when the local pass reaches its budget", async () => {
    offlineTranscriber.mockRejectedValue(new DomainError("budget", "TRANSCRIPTION_BUDGET_EXCEEDED", 504));
    const response = await transcribePost(audioRequest("Doe mij twee Duvel", 0.74, false));
    const body = await response.json() as { text?: string; engine?: string; crossEngine?: { fallbackUsed?: boolean } };
    expect(response.ok).toBe(true);
    expect(body.text).toBe("Doe mij twee Duvel");
    expect(body.engine).toBe("edge-live-budget-fallback");
    expect(body.crossEngine?.fallbackUsed).toBe(true);

    const reviewResponse = await interpretPost(new Request("http://localhost/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "voice-budget-fallback-test",
        baseDraftRevision: "empty",
        tenantId: "tenant-demo-brussels",
        tableId: "TABLE-12",
        tableLabel: "Table 12",
        source: "audio",
        turns: [{ speaker: "customer", text: body.text }],
      }),
    }));
    const review = await reviewResponse.json() as { draft: { lines: Array<{ productId: string; quantity: number }> } };
    expect(reviewResponse.ok).toBe(true);
    expect(review.draft.lines).toContainEqual(expect.objectContaining({ productId: "POS-1001", quantity: 2 }));
  });

  it("recovers the noisy polite product list from the reported timeout into Review", async () => {
    offlineTranscriber.mockRejectedValue(new DomainError("budget", "TRANSCRIPTION_BUDGET_EXCEEDED", 504));
    const spoken = "Beetje een cola, een penche en de steek alsjeblieft.";
    const response = await transcribePost(audioRequest(spoken, 0.74, false));
    const body = await response.json() as { text?: string; engine?: string };

    expect(response.ok).toBe(true);
    expect(body).toMatchObject({ text: spoken, engine: "edge-live-budget-fallback" });

    const reviewResponse = await interpretPost(new Request("http://localhost/api/interpret", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        operationId: "voice-noisy-list-recovery-test",
        baseDraftRevision: "empty",
        tenantId: "tenant-demo-brussels",
        tableId: "TABLE-12",
        tableLabel: "Table 12",
        source: "audio",
        turns: [{ speaker: "customer", text: body.text }],
      }),
    }));
    const review = await reviewResponse.json() as { draft: { lines: Array<{ productId: string }> } };
    const productIds = review.draft.lines.map((line) => line.productId);

    expect(reviewResponse.ok).toBe(true);
    expect(productIds).toEqual(expect.arrayContaining(["POS-1101", "POS-1002", "POS-3001"]));
  });

  it("still refuses an ungrounded browser fragment after a local timeout", async () => {
    offlineTranscriber.mockRejectedValue(new DomainError("budget", "TRANSCRIPTION_BUDGET_EXCEEDED", 504));
    const response = await transcribePost(audioRequest("Mijn nonkel vertelde gisteren een lang verhaal", 0.9, false));
    const body = await response.json() as { code?: string };
    expect(response.status).toBe(504);
    expect(body.code).toBe("TRANSCRIPTION_BUDGET_EXCEEDED");
  });
});
