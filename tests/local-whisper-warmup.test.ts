import { describe, expect, it } from "vitest";

import { createWhisperWarmupWav } from "@/src/speech/local-whisper-server";

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
});
