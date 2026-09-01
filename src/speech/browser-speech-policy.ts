export type BrowserSpeechFallbackDecision = "fallback-local" | "user-denied" | "continue-browser";

export type BrowserSpeechFallbackInput =
  | string
  | null
  | undefined
  | { error?: unknown; browserRecognitionText?: string; speechMode?: string };

export function browserSpeechFallbackDecision(input?: BrowserSpeechFallbackInput): BrowserSpeechFallbackDecision {
  const raw = typeof input === "string"
    ? input
    : input && typeof input === "object"
      ? (() => {
          const candidate = input.error ?? input.browserRecognitionText ?? "";
          if (candidate instanceof Error) return candidate.message;
          return typeof candidate === "string" ? candidate : String(candidate ?? "");
        })()
      : String(input ?? "");

  const normalized = raw.trim().toLowerCase();
  if (!normalized) return "continue-browser";
  if (normalized.includes("not-allowed") || normalized.includes("service-not-allowed")) {
    return "user-denied";
  }
  if (["network", "no-speech", "audio-capture", "aborted", "failed", "error", "503", "transcribe"].some((candidate) => normalized.includes(candidate))) {
    return "fallback-local";
  }
  return "continue-browser";
}
