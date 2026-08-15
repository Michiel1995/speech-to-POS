export interface VoicePerformanceSample {
  operationId: string;
  kind: "conversation" | "correction" | "text" | "send";
  outcome: "ready" | "sent" | "error" | "cancelled";
  totalMs: number;
  stopToReviewMs?: number;
  provisionalStopToReviewMs?: number;
  transcriptionMs?: number;
  interpretationMs?: number;
  createdAt: string;
}

export interface VoicePerformanceSummary {
  samples: number;
  totalP50Ms: number;
  totalP95Ms: number;
  stopToReviewP50Ms?: number;
  stopToReviewP95Ms?: number;
  provisionalStopToReviewP50Ms?: number;
  provisionalStopToReviewP95Ms?: number;
  errorRate: number;
}

export const MAX_VOICE_PERFORMANCE_SAMPLES = 100;

function finiteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export function parseVoicePerformanceSamples(value: string | null): VoicePerformanceSample[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((sample): sample is VoicePerformanceSample => {
      if (!sample || typeof sample !== "object") return false;
      const item = sample as Partial<VoicePerformanceSample>;
      return typeof item.operationId === "string" &&
        ["conversation", "correction", "text", "send"].includes(item.kind ?? "") &&
        ["ready", "sent", "error", "cancelled"].includes(item.outcome ?? "") &&
        finiteNonNegative(item.totalMs) &&
        typeof item.createdAt === "string";
    }).slice(-MAX_VOICE_PERFORMANCE_SAMPLES);
  } catch {
    return [];
  }
}

export function appendVoicePerformanceSample(
  current: VoicePerformanceSample[],
  sample: VoicePerformanceSample,
): VoicePerformanceSample[] {
  return [...current, sample].slice(-MAX_VOICE_PERFORMANCE_SAMPLES);
}

export function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(quantile * sorted.length) - 1));
  return Math.round(sorted[index]);
}

export function summarizeVoicePerformance(samples: VoicePerformanceSample[]): VoicePerformanceSummary {
  const stopToReview = samples.map((sample) => sample.stopToReviewMs).filter(finiteNonNegative);
  const provisionalStopToReview = samples.map((sample) => sample.provisionalStopToReviewMs).filter(finiteNonNegative);
  return {
    samples: samples.length,
    totalP50Ms: percentile(samples.map((sample) => sample.totalMs), 0.5),
    totalP95Ms: percentile(samples.map((sample) => sample.totalMs), 0.95),
    stopToReviewP50Ms: stopToReview.length ? percentile(stopToReview, 0.5) : undefined,
    stopToReviewP95Ms: stopToReview.length ? percentile(stopToReview, 0.95) : undefined,
    provisionalStopToReviewP50Ms: provisionalStopToReview.length ? percentile(provisionalStopToReview, 0.5) : undefined,
    provisionalStopToReviewP95Ms: provisionalStopToReview.length ? percentile(provisionalStopToReview, 0.95) : undefined,
    errorRate: samples.length ? samples.filter((sample) => sample.outcome === "error").length / samples.length : 0,
  };
}

export class VoicePerformanceTrace {
  private marks = new Map<string, number>();

  constructor(
    readonly operationId: string,
    readonly kind: VoicePerformanceSample["kind"],
    private readonly startedAtMs: number,
  ) {}

  mark(name: "stop" | "provisional-review" | "transcription-start" | "transcription-end" | "interpretation-start" | "interpretation-end", nowMs: number): void {
    this.marks.set(name, nowMs);
  }

  finish(outcome: VoicePerformanceSample["outcome"], nowMs: number, createdAt = new Date().toISOString()): VoicePerformanceSample {
    const duration = (start: string, end: string) => {
      const startMs = this.marks.get(start);
      const endMs = this.marks.get(end);
      return startMs === undefined || endMs === undefined ? undefined : Math.max(0, Math.round(endMs - startMs));
    };
    const stopMs = this.marks.get("stop");
    const provisionalReviewMs = this.marks.get("provisional-review");
    return {
      operationId: this.operationId,
      kind: this.kind,
      outcome,
      totalMs: Math.max(0, Math.round(nowMs - this.startedAtMs)),
      stopToReviewMs: stopMs === undefined ? undefined : Math.max(0, Math.round(nowMs - stopMs)),
      provisionalStopToReviewMs: stopMs === undefined || provisionalReviewMs === undefined
        ? undefined
        : Math.max(0, Math.round(provisionalReviewMs - stopMs)),
      transcriptionMs: duration("transcription-start", "transcription-end"),
      interpretationMs: duration("interpretation-start", "interpretation-end"),
      createdAt,
    };
  }
}
