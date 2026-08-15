import { existsSync, readdirSync, statSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { DomainError } from "@/src/domain/errors";

export type LocalWhisperModelTier = "tiny" | "base" | "small" | "medium" | "large-turbo" | "large";

export interface LocalWhisperModel {
  id: string;
  label: string;
  path: string;
  fileName: string;
  tier: LocalWhisperModelTier;
  fileSizeMb: number;
  estimatedMemoryMb: number;
  minimumSystemMemoryMb: number;
  minimumLogicalProcessors: number;
  qualityRank: number;
}

export interface LocalWhisperSelection extends LocalWhisperModel {
  threadCount: number;
  targetLatencyMs: number;
  policy: "adaptive" | "fixed";
  reason: string;
}

interface ModelRuntimeMeasurement {
  runs: number;
  failures: number;
  slowStreak: number;
  averageProcessingMs: number;
  averageRealtimeFactor: number;
  disabledUntil?: number;
  lastReason?: string;
}

export interface LocalSpeechRuntimeStatus {
  configured: boolean;
  policy: "adaptive" | "fixed";
  selectedModel?: {
    id: string;
    label: string;
    tier: LocalWhisperModelTier;
    fileSizeMb: number;
    estimatedMemoryMb: number;
    threadCount: number;
    reason: string;
  };
  installedModels: Array<{
    id: string;
    label: string;
    tier: LocalWhisperModelTier;
    fileSizeMb: number;
    eligible: boolean;
    reason: string;
    averageProcessingMs?: number;
    averageRealtimeFactor?: number;
  }>;
  device: {
    totalMemoryGb: number;
    freeMemoryGb: number;
    logicalProcessors: number;
    maxSpeechThreads: number;
    maxConcurrentTranscriptions: 1;
    backend: string;
  };
  targetLatencyMs: number;
  queuedTranscriptions: number;
  activeTranscriptions: number;
}

export interface ModelDiscoveryOptions {
  fixedModelPath?: string;
  modelDirectories?: string[];
  totalMemoryMb?: number;
  freeMemoryMb?: number;
  logicalProcessors?: number;
  maxThreads?: number;
  targetLatencyMs?: number;
  policy?: "adaptive" | "fixed";
  now?: number;
}

const MB = 1024 * 1024;
const runtimeMeasurements = new Map<string, ModelRuntimeMeasurement>();

const TIER_PROFILE: Record<LocalWhisperModelTier, Omit<LocalWhisperModel, "id" | "label" | "path" | "fileName" | "fileSizeMb">> = {
  tiny: { tier: "tiny", estimatedMemoryMb: 420, minimumSystemMemoryMb: 3_000, minimumLogicalProcessors: 2, qualityRank: 1 },
  base: { tier: "base", estimatedMemoryMb: 620, minimumSystemMemoryMb: 4_000, minimumLogicalProcessors: 2, qualityRank: 2 },
  small: { tier: "small", estimatedMemoryMb: 950, minimumSystemMemoryMb: 4_000, minimumLogicalProcessors: 4, qualityRank: 3 },
  medium: { tier: "medium", estimatedMemoryMb: 2_500, minimumSystemMemoryMb: 8_000, minimumLogicalProcessors: 6, qualityRank: 4 },
  "large-turbo": { tier: "large-turbo", estimatedMemoryMb: 2_800, minimumSystemMemoryMb: 12_000, minimumLogicalProcessors: 8, qualityRank: 5 },
  large: { tier: "large", estimatedMemoryMb: 5_200, minimumSystemMemoryMb: 24_000, minimumLogicalProcessors: 12, qualityRank: 6 },
};

function modelTier(fileName: string): LocalWhisperModelTier | undefined {
  const normalized = fileName.toLocaleLowerCase("en-US");
  if (!normalized.endsWith(".bin") || normalized.includes("silero") || normalized.includes("vad")) return undefined;
  if (normalized.includes("large") && normalized.includes("turbo")) return "large-turbo";
  if (normalized.includes("large")) return "large";
  if (normalized.includes("medium")) return "medium";
  if (normalized.includes("small")) return "small";
  if (normalized.includes("base")) return "base";
  if (normalized.includes("tiny")) return "tiny";
  return undefined;
}

function modelLabel(tier: LocalWhisperModelTier, fileName: string): string {
  const quantized = fileName.match(/q\d(?:_[01])?/i)?.[0]?.toUpperCase();
  const base = tier === "large-turbo"
    ? "Whisper Large-v3 Turbo"
    : `Whisper ${tier[0].toUpperCase()}${tier.slice(1)}`;
  return quantized ? `${base} ${quantized}` : base;
}

function uniqueExistingModelPaths(options: ModelDiscoveryOptions): string[] {
  const candidates: string[] = [];
  if (options.fixedModelPath) candidates.push(path.resolve(options.fixedModelPath));
  for (const directory of options.modelDirectories ?? []) {
    if (!directory || !existsSync(directory)) continue;
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile()) candidates.push(path.resolve(directory, entry.name));
    }
  }
  return [...new Set(candidates)].filter((candidate) => existsSync(candidate));
}

export function discoverLocalWhisperModels(options: ModelDiscoveryOptions = {}): LocalWhisperModel[] {
  return uniqueExistingModelPaths(options).flatMap((modelPath) => {
    const fileName = path.basename(modelPath);
    const tier = modelTier(fileName);
    if (!tier) return [];
    const profile = TIER_PROFILE[tier];
    const fileSizeMb = Number((statSync(modelPath).size / MB).toFixed(1));
    return [{
      ...profile,
      id: fileName.replace(/\.bin$/i, ""),
      label: modelLabel(tier, fileName),
      path: modelPath,
      fileName,
      fileSizeMb,
      estimatedMemoryMb: Math.max(profile.estimatedMemoryMb, Math.ceil(fileSizeMb * 1.45)),
    }];
  }).sort((left, right) => right.qualityRank - left.qualityRank || left.fileSizeMb - right.fileSizeMb);
}

function configuredOptions(overrides: ModelDiscoveryOptions = {}): Required<Omit<ModelDiscoveryOptions, "fixedModelPath" | "modelDirectories" | "now">> & Pick<ModelDiscoveryOptions, "fixedModelPath" | "modelDirectories" | "now"> {
  const fixedModelPath = overrides.fixedModelPath ?? process.env.LOCAL_WHISPER_MODEL;
  const defaultDirectory = fixedModelPath ? path.dirname(fixedModelPath) : undefined;
  const configuredDirectories = (process.env.LOCAL_WHISPER_MODELS_DIRS ?? "")
    .split(path.delimiter)
    .map((entry) => entry.trim())
    .filter(Boolean);
  const modelDirectories = overrides.modelDirectories ?? [...new Set([defaultDirectory, ...configuredDirectories].filter((entry): entry is string => Boolean(entry)))];
  const logicalProcessors = overrides.logicalProcessors ?? Math.max(1, os.cpus().length);
  const maxThreadsFromEnvironment = Number(process.env.LOCAL_WHISPER_MAX_THREADS);
  const targetFromEnvironment = Number(process.env.LOCAL_WHISPER_TARGET_LATENCY_MS);
  return {
    fixedModelPath,
    modelDirectories,
    totalMemoryMb: overrides.totalMemoryMb ?? os.totalmem() / MB,
    freeMemoryMb: overrides.freeMemoryMb ?? os.freemem() / MB,
    logicalProcessors,
    maxThreads: overrides.maxThreads ?? (Number.isFinite(maxThreadsFromEnvironment) ? maxThreadsFromEnvironment : 6),
    targetLatencyMs: overrides.targetLatencyMs ?? (Number.isFinite(targetFromEnvironment) ? targetFromEnvironment : 30_000),
    policy: overrides.policy ?? (process.env.LOCAL_WHISPER_MODEL_POLICY === "fixed" ? "fixed" : "adaptive"),
    now: overrides.now,
  };
}

function eligibility(model: LocalWhisperModel, options: ReturnType<typeof configuredOptions>, now = Date.now()): { eligible: boolean; reason: string } {
  if (options.totalMemoryMb < model.minimumSystemMemoryMb) {
    return { eligible: false, reason: `minstens ${Math.ceil(model.minimumSystemMemoryMb / 1024)} GB RAM nodig` };
  }
  if (options.logicalProcessors < model.minimumLogicalProcessors) {
    return { eligible: false, reason: `minstens ${model.minimumLogicalProcessors} logische processors nodig` };
  }
  const safeFreeMemory = model.estimatedMemoryMb + 900;
  if (options.freeMemoryMb < safeFreeMemory) {
    return { eligible: false, reason: "tijdelijk te weinig vrij geheugen" };
  }
  const measurement = runtimeMeasurements.get(model.id);
  if ((measurement?.disabledUntil ?? 0) > now) {
    return { eligible: false, reason: measurement?.lastReason ?? "tijdelijk teruggeschakeld na trage verwerking" };
  }
  return { eligible: true, reason: "past binnen de veilige toestelgrenzen" };
}

function speechThreadCount(options: ReturnType<typeof configuredOptions>): number {
  const fortyFivePercent = Math.max(2, Math.floor(options.logicalProcessors * 0.45));
  return Math.max(2, Math.min(8, Math.floor(options.maxThreads), fortyFivePercent));
}

export function selectLocalWhisperModel(
  overrides: ModelDiscoveryOptions = {},
  excludedModelIds: string[] = [],
): LocalWhisperSelection | undefined {
  const options = configuredOptions(overrides);
  const models = discoverLocalWhisperModels(options).filter((model) => !excludedModelIds.includes(model.id));
  if (!models.length) return undefined;
  const fixedPath = options.fixedModelPath ? path.resolve(options.fixedModelPath) : undefined;
  const fixed = fixedPath ? models.find((model) => model.path === fixedPath) : undefined;
  const chosen = options.policy === "fixed"
    ? fixed && eligibility(fixed, options, options.now).eligible ? fixed : undefined
    : models.find((model) => eligibility(model, options, options.now).eligible);
  if (!chosen) return undefined;
  const chosenEligibility = eligibility(chosen, options, options.now);
  return {
    ...chosen,
    threadCount: speechThreadCount(options),
    targetLatencyMs: Math.max(4_000, options.targetLatencyMs),
    policy: options.policy,
    reason: options.policy === "fixed"
      ? "vast model uit de installatieconfiguratie"
      : chosenEligibility.eligible
        ? `sterkste veilige model voor ${Math.round(options.totalMemoryMb / 1024)} GB RAM en ${options.logicalProcessors} logische processors`
        : "veilig model binnen de huidige toestelgrenzen",
  };
}

/**
 * Selects the model used for the first transcription pass. Adaptive installs
 * deliberately start with the fastest eligible model below the strongest
 * tier; the strongest model remains available as a confidence rescue.
 */
export function selectLocalWhisperEntryModel(
  overrides: ModelDiscoveryOptions = {},
): { entry?: LocalWhisperSelection; strongest?: LocalWhisperSelection } {
  const strongest = selectLocalWhisperModel(overrides);
  if (!strongest) return {};
  if (strongest.policy !== "adaptive" || !["medium", "large-turbo", "large"].includes(strongest.tier)) {
    return { entry: strongest, strongest };
  }
  const faster = selectLocalWhisperModel(overrides, [strongest.id]);
  return { entry: faster ?? strongest, strongest };
}

export function recordLocalWhisperPerformance(
  selection: LocalWhisperSelection,
  elapsedMs: number,
  audioDurationSeconds: number,
  succeeded: boolean,
): void {
  const current = runtimeMeasurements.get(selection.id) ?? {
    runs: 0,
    failures: 0,
    slowStreak: 0,
    averageProcessingMs: 0,
    averageRealtimeFactor: 0,
  };
  const realtimeFactor = elapsedMs / Math.max(1_000, audioDurationSeconds * 1_000);
  const runs = current.runs + 1;
  const weight = runs === 1 ? 1 : 0.35;
  current.runs = runs;
  current.averageProcessingMs = current.averageProcessingMs * (1 - weight) + elapsedMs * weight;
  current.averageRealtimeFactor = current.averageRealtimeFactor * (1 - weight) + realtimeFactor * weight;
  if (!succeeded) {
    current.failures += 1;
    current.slowStreak += 2;
    current.disabledUntil = Date.now() + 30 * 60 * 1_000;
    current.lastReason = "tijdelijk uitgeschakeld na een verwerkingsfout";
  } else {
    const slow = elapsedMs > selection.targetLatencyMs || (audioDurationSeconds >= 8 && realtimeFactor > 2.5);
    current.slowStreak = slow ? current.slowStreak + 1 : 0;
    if (current.slowStreak >= 2 || elapsedMs > selection.targetLatencyMs * 2.5) {
      current.disabledUntil = Date.now() + 60 * 60 * 1_000;
      current.lastReason = "tijdelijk teruggeschakeld omdat dit model op dit toestel te traag was";
    }
  }
  runtimeMeasurements.set(selection.id, current);
}

export function localSpeechRuntimeStatus(overrides: ModelDiscoveryOptions = {}): LocalSpeechRuntimeStatus {
  const options = configuredOptions(overrides);
  const models = discoverLocalWhisperModels(options);
  const selected = selectLocalWhisperModel(options);
  return {
    configured: models.length > 0 && Boolean(process.env.LOCAL_WHISPER_CLI || overrides.fixedModelPath),
    policy: options.policy,
    selectedModel: selected ? {
      id: selected.id,
      label: selected.label,
      tier: selected.tier,
      fileSizeMb: selected.fileSizeMb,
      estimatedMemoryMb: selected.estimatedMemoryMb,
      threadCount: selected.threadCount,
      reason: selected.reason,
    } : undefined,
    installedModels: models.map((model) => {
      const state = eligibility(model, options, options.now);
      const measurement = runtimeMeasurements.get(model.id);
      return {
        id: model.id,
        label: model.label,
        tier: model.tier,
        fileSizeMb: model.fileSizeMb,
        eligible: state.eligible,
        reason: state.reason,
        averageProcessingMs: measurement?.runs ? Math.round(measurement.averageProcessingMs) : undefined,
        averageRealtimeFactor: measurement?.runs ? Number(measurement.averageRealtimeFactor.toFixed(2)) : undefined,
      };
    }),
    device: {
      totalMemoryGb: Number((options.totalMemoryMb / 1024).toFixed(1)),
      freeMemoryGb: Number((options.freeMemoryMb / 1024).toFixed(1)),
      logicalProcessors: options.logicalProcessors,
      maxSpeechThreads: speechThreadCount(options),
      maxConcurrentTranscriptions: 1,
      backend: process.env.LOCAL_WHISPER_BACKEND ?? "CPU/BLAS",
    },
    targetLatencyMs: options.targetLatencyMs,
    queuedTranscriptions,
    activeTranscriptions,
  };
}

let activeTranscriptions = 0;
let queuedTranscriptions = 0;
const transcriptionWaiters: Array<() => void> = [];

export async function withLocalSpeechCapacity<T>(operation: () => Promise<T>): Promise<T> {
  if (activeTranscriptions > 0) {
    if (queuedTranscriptions >= 2) {
      throw new DomainError(
        "De lokale spraakmodule verwerkt al andere audio. Wacht enkele seconden en probeer opnieuw.",
        "LOCAL_SPEECH_BUSY",
        429,
      );
    }
    queuedTranscriptions += 1;
    await new Promise<void>((resolve) => transcriptionWaiters.push(resolve));
    queuedTranscriptions -= 1;
  }
  activeTranscriptions += 1;
  try {
    return await operation();
  } finally {
    activeTranscriptions -= 1;
    transcriptionWaiters.shift()?.();
  }
}

export function resetLocalModelMeasurementsForTests(): void {
  runtimeMeasurements.clear();
}
