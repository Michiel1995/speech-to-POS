import { describe, expect, it } from "vitest";

import { downsamplePcm, encodePcm16Wav, inspectWavAudio, preparePcmForSpeech } from "@/src/audio/pcm-wav";

describe("offline PCM recording", () => {
  it("downsamples microphone chunks to 16 kHz", () => {
    const input = new Float32Array(48_000).fill(0.25);
    const output = downsamplePcm([input.subarray(0, 20_000), input.subarray(20_000)], 48_000);
    expect(output).toHaveLength(16_000);
    expect(output[8_000]).toBeCloseTo(0.25);
  });

  it("encodes mono 16-bit WAV headers and samples", async () => {
    const wav = encodePcm16Wav(new Float32Array([-1, 0, 1]));
    const view = new DataView(await wav.arrayBuffer());
    const text = (offset: number, length: number) => String.fromCharCode(
      ...Array.from({ length }, (_, index) => view.getUint8(offset + index)),
    );

    expect(wav.type).toBe("audio/wav");
    expect(text(0, 4)).toBe("RIFF");
    expect(text(8, 4)).toBe("WAVE");
    expect(view.getUint16(22, true)).toBe(1);
    expect(view.getUint32(24, true)).toBe(16_000);
    expect(view.getInt16(44, true)).toBe(-32_768);
    expect(view.getInt16(46, true)).toBe(0);
    expect(view.getInt16(48, true)).toBe(32_767);
    expect(inspectWavAudio(await wav.arrayBuffer())).toMatchObject({
      sampleRate: 16_000,
      channels: 1,
      bitsPerSample: 16,
      dataBytes: 6,
    });
  });

  it("rejects truncated or forged WAV data before a native model sees it", () => {
    expect(() => inspectWavAudio(new ArrayBuffer(12))).toThrow(/onvolledig/);
    const forged = new ArrayBuffer(44);
    const view = new DataView(forged);
    for (const [offset, text] of [[0, "NOPE"], [8, "WAVE"]] as const) {
      for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index));
    }
    expect(() => inspectWavAudio(forged)).toThrow(/WAV-header/);
  });

  it("trims stable airport-like background before and after speech but keeps internal pauses", () => {
    const sampleRate = 16_000;
    const duration = 5 * sampleRate;
    const input = new Float32Array(duration);
    for (let index = 0; index < duration; index += 1) {
      const background = Math.sin(index * 0.37) * 0.012;
      const speechWindow = index >= sampleRate && index < sampleRate * 3.4;
      const internalPause = index >= sampleRate * 2 && index < sampleRate * 2.35;
      const speech = speechWindow && !internalPause ? Math.sin(index * 0.071) * 0.055 : 0;
      input[index] = background + speech;
    }

    const prepared = preparePcmForSpeech([input], sampleRate, 0.012);
    expect(prepared.originalDurationSeconds).toBeCloseTo(5, 2);
    expect(prepared.preparedDurationSeconds).toBeGreaterThan(2.7);
    expect(prepared.preparedDurationSeconds).toBeLessThan(3.4);
    expect(prepared.trimmedDurationSeconds).toBeGreaterThan(1.5);
    expect(prepared.speechThresholdRms).toBeGreaterThan(prepared.noiseFloorRms);
    expect(prepared.speechDetected).toBe(true);
  });

  it("keeps the complete recording when no reliable speech edge can be found", () => {
    const noise = new Float32Array(16_000).fill(0.002);
    const prepared = preparePcmForSpeech([noise], 16_000, 0.002);
    expect(prepared.samples).toHaveLength(noise.length);
    expect(prepared.speechDetected).toBe(false);
  });
});
