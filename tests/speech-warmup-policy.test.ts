import { describe, expect, it } from "vitest";

import {
  LOCAL_SPEECH_IDLE_UNLOAD_MS,
  LOCAL_SPEECH_KEEPALIVE_MS,
  localSpeechRecordingReady,
  localSpeechWarmupRequired,
  warmupKeepaliveMeetsIdleBudget,
} from "@/src/speech/warmup-policy";

describe("local speech warmup policy", () => {
  it("requires warmup for the packaged desktop and detected offline speech", () => {
    expect(localSpeechWarmupRequired(true, "browser")).toBe(true);
    expect(localSpeechWarmupRequired(false, "offline")).toBe(true);
    expect(localSpeechWarmupRequired(false, "browser")).toBe(false);
  });

  it("blocks offline recording until local warmup is ready", () => {
    expect(localSpeechRecordingReady("offline", "idle")).toBe(false);
    expect(localSpeechRecordingReady("offline", "warming")).toBe(false);
    expect(localSpeechRecordingReady("offline", "error")).toBe(true);
    expect(localSpeechRecordingReady("offline", "ready")).toBe(true);
    expect(localSpeechRecordingReady("browser", "warming")).toBe(false);
    expect(localSpeechRecordingReady("browser", "ready")).toBe(true);
    expect(localSpeechRecordingReady("browser", "idle")).toBe(false);
    expect(localSpeechRecordingReady("browser", "error")).toBe(true);
    expect(localSpeechRecordingReady("detecting", "idle")).toBe(false);
    expect(localSpeechRecordingReady("unavailable", "idle")).toBe(false);
  });

  it("refreshes well before the server idle-unload boundary", () => {
    expect(LOCAL_SPEECH_KEEPALIVE_MS).toBeLessThan(LOCAL_SPEECH_IDLE_UNLOAD_MS / 2);
    expect(warmupKeepaliveMeetsIdleBudget()).toBe(true);
    expect(warmupKeepaliveMeetsIdleBudget(100_000, 180_000)).toBe(false);
  });
});
