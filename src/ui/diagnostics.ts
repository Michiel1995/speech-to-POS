import {
  parseVoicePerformanceSamples,
  summarizeVoicePerformance,
} from "@/src/analytics/voice-performance";
import { parseErrorIncidents } from "@/src/ui/error-registry";

export interface DiagnosticsHealth {
  ok?: boolean;
  adapter?: string;
  offlineSpeechConfigured?: boolean;
  offlineVadConfigured?: boolean;
  retention?: string;
  localSpeech?: {
    configured?: boolean;
    policy?: string;
    selectedModel?: {
      id?: string;
      label?: string;
      tier?: string;
      threadCount?: number;
    };
    installedModels?: Array<{
      tier?: string;
      eligible?: boolean;
    }>;
    device?: {
      totalMemoryGb?: number;
      freeMemoryGb?: number;
      logicalProcessors?: number;
      maxSpeechThreads?: number;
      maxConcurrentTranscriptions?: number;
      backend?: string;
    };
    targetLatencyMs?: number;
    queuedTranscriptions?: number;
    activeTranscriptions?: number;
  };
  culinaryKnowledge?: {
    concepts?: number;
    acousticAliases?: number;
    speechForms?: number;
  };
}

export interface DiagnosticsInput {
  generatedAt: string;
  appVersion?: string;
  health?: DiagnosticsHealth;
  desktop: boolean;
  online: boolean;
  language?: string;
  viewport?: { width: number; height: number; devicePixelRatio: number };
  performanceJson?: string | null;
  errorRegistryJson?: string | null;
  serverErrorPresent?: boolean;
}

function safeText(value: unknown, fallback = "onbekend"): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  return value.trim().replace(/[\u0000-\u001f\u007f]/g, " ").slice(0, 120);
}

function safeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? Math.round(value * 100) / 100
    : undefined;
}

export function buildPrivacySafeDiagnostics(input: DiagnosticsInput) {
  const health = input.health;
  const speech = health?.localSpeech;
  const device = speech?.device;
  const performance = summarizeVoicePerformance(parseVoicePerformanceSamples(input.performanceJson ?? null));
  const installedModels = speech?.installedModels ?? [];
  const errorIncidents = parseErrorIncidents(input.errorRegistryJson).slice(0, 10);

  return {
    schemaVersion: 2,
    generatedAt: input.generatedAt,
    product: "Service Ears",
    app: {
      version: safeText(input.appVersion, "browser"),
      runtime: input.desktop ? "desktop" : "browser",
      online: input.online,
      language: safeText(input.language),
      viewport: input.viewport ? {
        width: safeNumber(input.viewport.width),
        height: safeNumber(input.viewport.height),
        devicePixelRatio: safeNumber(input.viewport.devicePixelRatio),
      } : undefined,
    },
    server: {
      ready: health?.ok === true,
      adapter: safeText(health?.adapter),
      retention: safeText(health?.retention),
      serverErrorPresent: Boolean(input.serverErrorPresent),
    },
    speech: {
      configured: Boolean(speech?.configured ?? health?.offlineSpeechConfigured),
      vadConfigured: Boolean(health?.offlineVadConfigured),
      policy: safeText(speech?.policy),
      selectedModel: speech?.selectedModel ? {
        id: safeText(speech.selectedModel.id),
        label: safeText(speech.selectedModel.label),
        tier: safeText(speech.selectedModel.tier),
        threadCount: safeNumber(speech.selectedModel.threadCount),
      } : undefined,
      installedModelCount: installedModels.length,
      eligibleModelCount: installedModels.filter((model) => model.eligible).length,
      queuedTranscriptions: safeNumber(speech?.queuedTranscriptions) ?? 0,
      activeTranscriptions: safeNumber(speech?.activeTranscriptions) ?? 0,
      targetLatencyMs: safeNumber(speech?.targetLatencyMs),
      device: device ? {
        totalMemoryGb: safeNumber(device.totalMemoryGb),
        freeMemoryGb: safeNumber(device.freeMemoryGb),
        logicalProcessors: safeNumber(device.logicalProcessors),
        maxSpeechThreads: safeNumber(device.maxSpeechThreads),
        maxConcurrentTranscriptions: safeNumber(device.maxConcurrentTranscriptions),
        backend: safeText(device.backend),
      } : undefined,
    },
    knowledge: health?.culinaryKnowledge ? {
      concepts: safeNumber(health.culinaryKnowledge.concepts),
      acousticAliases: safeNumber(health.culinaryKnowledge.acousticAliases),
      speechForms: safeNumber(health.culinaryKnowledge.speechForms),
    } : undefined,
    performance: {
      samples: performance.samples,
      totalP50Ms: performance.totalP50Ms,
      totalP95Ms: performance.totalP95Ms,
      stopToReviewP50Ms: performance.stopToReviewP50Ms,
      stopToReviewP95Ms: performance.stopToReviewP95Ms,
      errorRate: Math.round(performance.errorRate * 10_000) / 10_000,
    },
    errors: {
      registered: parseErrorIncidents(input.errorRegistryJson).length,
      recent: errorIncidents.map((incident) => ({
        reference: incident.reference,
        fingerprint: incident.fingerprint,
        occurredAt: incident.occurredAt,
        code: incident.code,
        phase: incident.phase,
        component: incident.component,
        status: incident.status,
        endpoint: incident.endpoint,
        serverReference: incident.serverReference,
        elapsedMs: incident.elapsedMs,
        runtime: incident.runtime,
        online: incident.online,
        speechMode: incident.speechMode,
        voicePhase: incident.voicePhase,
      })),
    },
    privacy: {
      containsAudio: false,
      containsTranscript: false,
      containsOrders: false,
      containsTableIds: false,
      containsOperationIds: false,
    },
  };
}

export function formatPrivacySafeDiagnostics(input: DiagnosticsInput): string {
  return JSON.stringify(buildPrivacySafeDiagnostics(input), null, 2);
}
