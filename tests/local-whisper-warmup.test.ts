import { describe, expect, it } from "vitest";

import {
  createWhisperWarmupWav,
  transitionLocalWhisperReadiness,
  type LocalWhisperServerReadiness,
} from "@/src/speech/local-whisper-server";

describe("local Whisper inference warmup", () => {
  it("creates a valid bounded PCM16 mono WAV that can prime inference", () => {
    const wav = createWhisperWarmupWav(500, 16_000);
    const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);

    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe("RIFF");
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe("WAVE");
    expect(view.getUint16(20, true)).toBe(1);
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(16_000);
    expect(wav.byteLength).toBe(16_044);
  });

  it("enforces a minimum warmup duration without allocating unbounded audio", () => {
    expect(createWhisperWarmupWav(0).byteLength).toBe(3_244);
    expect(createWhisperWarmupWav(1_000).byteLength).toBe(32_044);
  });

  it("models cold start, warm reuse and recovery without treating a request timeout as model failure", () => {
    const idle: LocalWhisperServerReadiness = { state: "idle", coldStart: true, updatedAt: 0 };
    const loading = transitionLocalWhisperReadiness(idle, { type: "start", modelId: "small" }, 1);
    const timedOutRequest = transitionLocalWhisperReadiness(loading, { type: "request-timeout" }, 2);
    const warm = transitionLocalWhisperReadiness(timedOutRequest, { type: "ready", modelId: "small" }, 3);
    const recovering = transitionLocalWhisperReadiness(warm, {
      type: "recover",
      kind: "runtime-unavailable",
    }, 4);
    const reloading = transitionLocalWhisperReadiness(recovering, { type: "start", modelId: "small" }, 5);
    const recovered = transitionLocalWhisperReadiness(reloading, { type: "ready", modelId: "small" }, 6);

    expect(loading).toMatchObject({ state: "loading", coldStart: true });
    expect(timedOutRequest).toMatchObject({ state: "loading", coldStart: true });
    expect(warm).toMatchObject({ state: "ready", coldStart: false });
    expect(recovering).toMatchObject({ state: "recovering", lastErrorKind: "runtime-unavailable" });
    expect(recovered).toMatchObject({ state: "ready", coldStart: false, modelId: "small" });
  });
});
