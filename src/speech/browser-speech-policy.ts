export type BrowserSpeechFallbackDecision = "fallback-local" | "user-denied" | "continue-browser";

export function browserSpeechFallbackDecision(error?: string | null): BrowserSpeechFallbackDecision {
  const normalized = (error ?? "").trim().toLowerCase();
  if (!normalized) return "continue-browser";
  if (normalized.includes("not-allowed") || normalized.includes("service-not-allowed")) {
    return "user-denied";
  }
  if (["network", "no-speech", "audio-capture", "aborted", "failed", "error"].some((candidate) => normalized.includes(candidate))) {
    return "fallback-local";
  }
  return "continue-browser";
}
