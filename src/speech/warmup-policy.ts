export type SpeechMode = "detecting" | "offline" | "browser" | "unavailable";
export type LocalSpeechWarmupState = "idle" | "warming" | "ready" | "error";

export const LOCAL_SPEECH_WARMUP_TIMEOUT_MS = 50_000;
export const LOCAL_SPEECH_KEEPALIVE_MS = 60_000;
export const LOCAL_SPEECH_IDLE_UNLOAD_MS = 180_000;

export function localSpeechWarmupRequired(desktop: boolean, speechMode: SpeechMode): boolean {
  return desktop || speechMode === "offline";
}

export function localSpeechRecordingReady(
  speechMode: SpeechMode,
  warmupState: LocalSpeechWarmupState,
): boolean {
  if (speechMode === "detecting" || speechMode === "unavailable") return false;
  if (warmupState !== "ready" && (speechMode === "offline" || speechMode === "browser")) return false;
  return true;
}

export function warmupKeepaliveMeetsIdleBudget(
  keepaliveMs = LOCAL_SPEECH_KEEPALIVE_MS,
  idleUnloadMs = LOCAL_SPEECH_IDLE_UNLOAD_MS,
): boolean {
  return keepaliveMs > 0 && keepaliveMs < idleUnloadMs / 2;
}
