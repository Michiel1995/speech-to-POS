"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { preparedRecordingToWav, type PreparedSpeechPcm } from "@/src/audio/pcm-wav";
import { analyzeAudioQuality, audioQualityMessage, type AudioQualityResult } from "@/src/audio/audio-quality";
import {
  automaticSilenceDelaySeconds,
  MAX_AUTOMATIC_RECORDING_SECONDS,
} from "@/src/audio/endpointing";
import type { DialectProfile } from "@/src/language/flemish-dialect";
import {
  approvedAliases,
  EMPTY_LANGUAGE_LEARNING,
  parseLanguageLearning,
  recordExplicitCorrection,
  type LanguageLearningState,
} from "@/src/learning/local-language-learning";
import {
  appendTableEvents,
  pushDraftHistory,
  stableUtteranceId,
  undoDraft,
  type DraftHistory,
  type TableMemoryEvent,
} from "@/src/memory/table-memory";
import {
  parseContextRecord,
  parseDraftRecord,
  parseEventsRecord,
  serializeLocalState,
} from "@/src/memory/local-state";
import { LOCAL_STORAGE_KEYS } from "@/src/memory/storage-keys";
import type { PlannedOrderAction } from "@/src/order-understanding/order-actions";
import type {
  ConversationTurn,
  Course,
  DraftIssue,
  DraftOrder,
  TenantMenu,
} from "@/src/domain/schemas";
import {
  changeDraftLineQuantity,
  confirmSpeechProduct,
  removeDraftLine,
  rejectSpeechProduct,
  resolveIssueWithoutData,
  resolveModifier,
  resolveRemovingProduct,
  resolveWithProduct,
} from "@/src/ui/draft-actions";
import { completedBrowserSpeechText, rankSpeechHypotheses } from "@/src/speech/recognition-ranker";
import { browserSpeechFallbackDecision } from "@/src/speech/browser-speech-policy";
import {
  LOCAL_SPEECH_KEEPALIVE_MS,
  LOCAL_SPEECH_WARMUP_TIMEOUT_MS,
  localSpeechRecordingReady,
  localSpeechWarmupRequired,
  type LocalSpeechWarmupState,
  type SpeechMode,
} from "@/src/speech/warmup-policy";
import { findProductMentions } from "@/src/semantic-menu/matcher";
import { culinaryAdviceForText } from "@/src/knowledge/culinary-knowledge";
import { formatTurns, shouldClearTranscriptAfterSuccess } from "@/src/ui/transcript";
import {
  appendVoicePerformanceSample,
  parseVoicePerformanceSamples,
  VoicePerformanceTrace,
  type VoicePerformanceSample,
} from "@/src/analytics/voice-performance";
import {
  VoicePipelineError,
  userFacingVoiceError,
  voicePipelineErrorDetails,
} from "@/src/ui/voice-errors";
import {
  ERROR_REGISTRY_UPDATED_EVENT,
  appendErrorIncident,
  createErrorIncident,
  formatErrorIncident,
  parseErrorIncidents,
  type ErrorIncident,
  type ErrorPhase,
} from "@/src/ui/error-registry";
import {
  draftRevision,
  isAbortError,
  VoiceOperationCoordinator,
  type VoiceOperationKind,
  type VoiceOperationToken,
  type VoicePhase,
} from "@/src/ui/voice-operation";
import { DesktopSettings } from "./desktop-settings";

const COURSE_LABELS: Record<Course, string> = {
  drinks: "Dranken",
  starter: "Voorgerechten",
  main: "Hoofdgerechten",
  dessert: "Nagerechten",
  unspecified: "Niet ingedeeld",
};

interface MenuResponse {
  menu: TenantMenu;
  adapter: string;
  capabilities: { draftOrderCreate: boolean; openOrderRead: boolean };
}

interface ApiFailure {
  error?: string;
  code?: string;
  diagnosticId?: string;
}

type ReviewActivityPhase = "listening" | "transcribing" | "interpreting" | "updated" | "unchanged" | "error";

interface ReviewActivity {
  phase: ReviewActivityPhase;
  title: string;
  detail: string;
}

const DRAFTS_BY_TABLE_KEY = LOCAL_STORAGE_KEYS.drafts;
const CONTEXT_BY_TABLE_KEY = LOCAL_STORAGE_KEYS.context;
const EVENTS_BY_TABLE_KEY = LOCAL_STORAGE_KEYS.events;
const LANGUAGE_LEARNING_KEY = LOCAL_STORAGE_KEYS.languageLearning;
const LIVE_PREVIEW_KEY = "service-ears:live-edge-preview:v2";
const VOICE_PERFORMANCE_KEY = "service-ears:voice-performance:v1";

function draftForTable(tableId: string): DraftOrder | undefined {
  return parseDraftRecord(localStorage.getItem(DRAFTS_BY_TABLE_KEY))[tableId];
}

function storeDraftForTable(draft: DraftOrder): void {
  const drafts = parseDraftRecord(localStorage.getItem(DRAFTS_BY_TABLE_KEY));
  drafts[draft.tableId] = draft;
  localStorage.setItem(DRAFTS_BY_TABLE_KEY, serializeLocalState(drafts));
}

function clearDraftForTable(tableId: string): void {
  const drafts = parseDraftRecord(localStorage.getItem(DRAFTS_BY_TABLE_KEY));
  delete drafts[tableId];
  localStorage.setItem(DRAFTS_BY_TABLE_KEY, serializeLocalState(drafts));
}

function contextForTable(tableId: string): string[] {
  return parseContextRecord(localStorage.getItem(CONTEXT_BY_TABLE_KEY))[tableId]?.productIds ?? [];
}

function storeContextForTable(tableId: string, productIds: string[]): void {
  const contexts = parseContextRecord(localStorage.getItem(CONTEXT_BY_TABLE_KEY));
  if (productIds.length > 0) {
    contexts[tableId] = { productIds: productIds.slice(0, 12), updatedAt: new Date().toISOString() };
  } else {
    delete contexts[tableId];
  }
  localStorage.setItem(CONTEXT_BY_TABLE_KEY, serializeLocalState(contexts));
}

function eventsForTable(tableId: string): TableMemoryEvent[] {
  return parseEventsRecord(localStorage.getItem(EVENTS_BY_TABLE_KEY))[tableId] ?? [];
}

function storeEventsForTable(tableId: string, events: TableMemoryEvent[]): void {
  const stored = parseEventsRecord(localStorage.getItem(EVENTS_BY_TABLE_KEY));
  stored[tableId] = events;
  localStorage.setItem(EVENTS_BY_TABLE_KEY, serializeLocalState(stored));
}

function price(cents: number) {
  return new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function bestSpeechAlternative(
  result: BrowserSpeechRecognitionResult,
  menu?: TenantMenu,
  preferredProductIds: string[] = [],
): string {
  const alternatives = Array.from({ length: result.length }, (_, index) => result[index])
    .filter((alternative): alternative is BrowserSpeechRecognitionAlternative => Boolean(alternative));
  if (!menu) return alternatives[0]?.transcript ?? "";
  return rankSpeechHypotheses(
    alternatives.map((alternative, index) => ({
      text: alternative.transcript,
      acousticConfidence: alternative.confidence,
      source: "edge",
      index,
    })),
    menu,
    { preferredProductIds },
  )[0]?.text ?? "";
}

function UnresolvedChoice({
  draft,
  issue,
  menu,
  onChange,
}: {
  draft: DraftOrder;
  issue: DraftIssue;
  menu: TenantMenu;
  onChange: (draft: DraftOrder) => void;
}) {
  const [productId, setProductId] = useState("");
  return (
    <div className="resolution-row">
      <select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="Choose a POS product">
        <option value="">Choose valid POS product…</option>
        {[...menu.products]
          .filter((product) => product.active)
          .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
          .map((product) => (
            <option value={product.id} key={product.id}>{product.canonicalName} · {product.posName}</option>
          ))}
      </select>
      <button
        className="small-button"
        disabled={!productId}
        onClick={() => {
          const product = menu.products.find((candidate) => candidate.id === productId);
          if (product) onChange(resolveWithProduct(draft, issue.id, product, menu));
        }}
      >
        Toevoegen
      </button>
    </div>
  );
}

export function VoiceOrderConsole() {
  const [menuResponse, setMenuResponse] = useState<MenuResponse>();
  const [tableId, setTableId] = useState("TABLE-12");
  const [transcript, setTranscript] = useState("");
  const [, setSelectedDemo] = useState("");
  const [speechLanguage] = useState<"nl" | "fr" | "en" | "auto">("auto");
  const [dialectProfile] = useState<DialectProfile>("auto");
  const [draft, setDraft] = useState<DraftOrder>();
  const [assistantMessage, setAssistantMessage] = useState<string>();
  const [contextProductIds, setContextProductIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [recording, setRecording] = useState<"conversation" | "correction">();
  const [speechMode, setSpeechMode] = useState<SpeechMode>("detecting");
  const [speechInsight, setSpeechInsight] = useState<string>();
  const [shiftMode, setShiftMode] = useState(false);
  const [speechWarmupState, setSpeechWarmupState] = useState<LocalSpeechWarmupState>("idle");
  const [error, setError] = useState<string>();
  const [errorIncident, setErrorIncident] = useState<ErrorIncident>();
  const [errorCopyStatus, setErrorCopyStatus] = useState<"idle" | "copied" | "error">("idle");
  const [audioLevel, setAudioLevel] = useState(0);
  const [tableEvents, setTableEvents] = useState<TableMemoryEvent[]>([]);
  const [, setLatestActions] = useState<PlannedOrderAction[]>([]);
  const [learningState, setLearningState] = useState<LanguageLearningState>(EMPTY_LANGUAGE_LEARNING);
  const [draftHistory, setDraftHistory] = useState<DraftHistory>({ past: [], future: [] });
  const [reviewActivity, setReviewActivity] = useState<ReviewActivity>();
  const [microphoneStatus, setMicrophoneStatus] = useState("Nog niet gekalibreerd");
  const [livePreviewEnabled, setLivePreviewEnabled] = useState(true);
  const autoProcessOnSilence = true;
  const [livePreviewGuidance, setLivePreviewGuidance] = useState<string>();
  const [provisionalProducts, setProvisionalProducts] = useState<Array<{ id: string; name: string }>>([]);
  const [provisionalDraft, setProvisionalDraft] = useState<DraftOrder>();
  const [voicePhase, setVoicePhase] = useState<VoicePhase>("IDLE");
  const [, setPerformanceSamples] = useState<VoicePerformanceSample[]>([]);
  const recordingStream = useRef<MediaStream | undefined>(undefined);
  const audioContext = useRef<AudioContext | undefined>(undefined);
  const audioSource = useRef<MediaStreamAudioSourceNode | undefined>(undefined);
  const audioProcessor = useRef<ScriptProcessorNode | undefined>(undefined);
  const audioSink = useRef<GainNode | undefined>(undefined);
  const recordingChunks = useRef<Float32Array[]>([]);
  const recordingSampleRate = useRef(48_000);
  const browserRecognition = useRef<BrowserSpeechRecognition | undefined>(undefined);
  const browserRecognitionText = useRef("");
  const browserRecognitionPreviewText = useRef("");
  const browserRecognitionFailed = useRef(false);
  const browserRecognitionFallbackStarted = useRef(false);
  const browserRecognitionStopTimer = useRef<number | undefined>(undefined);
  const livePreviewRecognition = useRef<BrowserSpeechRecognition | undefined>(undefined);
  const livePreviewText = useRef("");
  const livePreviewFinalText = useRef("");
  const livePreviewActive = useRef(false);
  const provisionalReviewTimer = useRef<number | undefined>(undefined);
  const provisionalReviewController = useRef<AbortController | undefined>(undefined);
  const provisionalReviewText = useRef("");
  const provisionalReviewMarkedOperationId = useRef("");
  const recordingPurposeRef = useRef<"conversation" | "correction" | undefined>(undefined);
  const heardVoice = useRef(false);
  const consecutiveVoiceFrames = useRef(0);
  const lastVoiceAt = useRef(0);
  const ambientNoiseFloor = useRef(0.004);
  const adaptiveNoiseFloor = useRef(0.004);
  const silenceTimer = useRef<number | undefined>(undefined);
  const speechWarmupTimer = useRef<number | undefined>(undefined);
  const speechWarmupInFlight = useRef(false);
  const automaticServiceStartAttempted = useRef(false);
  const recordingStartedAt = useRef(0);
  const stoppingRecording = useRef(false);
  const operationCoordinator = useRef(new VoiceOperationCoordinator());
  const recordingOperation = useRef<VoiceOperationToken | undefined>(undefined);
  const performanceTrace = useRef<VoicePerformanceTrace | undefined>(undefined);
  const draftRef = useRef<DraftOrder | undefined>(undefined);
  const tableIdRef = useRef(tableId);
  const speechModeRef = useRef<SpeechMode>(speechMode);
  const voicePhaseRef = useRef<VoicePhase>(voicePhase);

  const menu = menuResponse?.menu;
  const selectedTable = menu?.tables.find((table) => table.id === tableId);
  const speechPreferredProductIds = useMemo(() => [...new Set([
    ...contextProductIds,
    ...(draft?.lines.map((line) => line.productId).reverse() ?? []),
  ])].slice(0, 12), [contextProductIds, draft]);

  const beginOperation = useCallback((kind: VoiceOperationKind): VoiceOperationToken => {
    const token = operationCoordinator.current.begin({
      kind,
      tableId: tableIdRef.current,
      draftRevision: draftRevision(draftRef.current),
    });
    recordingOperation.current = kind === "conversation" || kind === "correction" ? token : undefined;
    performanceTrace.current = new VoicePerformanceTrace(token.id, kind, token.startedAtMs);
    if (provisionalReviewTimer.current) window.clearTimeout(provisionalReviewTimer.current);
    provisionalReviewController.current?.abort();
    provisionalReviewTimer.current = undefined;
    provisionalReviewController.current = undefined;
    provisionalReviewText.current = "";
    provisionalReviewMarkedOperationId.current = "";
    setProvisionalProducts([]);
    setProvisionalDraft(undefined);
    setVoicePhase(kind === "send" ? "SENDING" : kind === "text" ? "INTERPRETING" : "LISTENING");
    return token;
  }, []);

  const finishOperation = useCallback((
    token: VoiceOperationToken,
    outcome: VoicePerformanceSample["outcome"],
    phase: VoicePhase,
  ) => {
    if (!operationCoordinator.current.isActive(token)) return false;
    const trace = performanceTrace.current?.operationId === token.id ? performanceTrace.current : undefined;
    if (trace) {
      const sample = trace.finish(outcome, performance.now());
      setPerformanceSamples((current) => {
        const next = appendVoicePerformanceSample(current, sample);
        localStorage.setItem(VOICE_PERFORMANCE_KEY, JSON.stringify(next));
        return next;
      });
    }
    operationCoordinator.current.complete(token);
    if (recordingOperation.current?.id === token.id) recordingOperation.current = undefined;
    if (performanceTrace.current?.operationId === token.id) performanceTrace.current = undefined;
    if (provisionalReviewTimer.current) window.clearTimeout(provisionalReviewTimer.current);
    provisionalReviewController.current?.abort();
    provisionalReviewTimer.current = undefined;
    provisionalReviewController.current = undefined;
    provisionalReviewText.current = "";
    provisionalReviewMarkedOperationId.current = "";
    setVoicePhase(phase);
    setProvisionalProducts([]);
    setProvisionalDraft(undefined);
    setBusy(false);
    return true;
  }, []);

  const mayCommitOperation = useCallback((token: VoiceOperationToken) => operationCoordinator.current.mayCommit(token, {
    tableId: tableIdRef.current,
    draftRevision: draftRevision(draftRef.current),
  }), []);

  const registerVoiceError = useCallback((
    reason: unknown,
    context: {
      phase: ErrorPhase;
      operation?: VoiceOperationToken;
      code?: string;
      status?: number;
      endpoint?: string;
      title?: string;
      fallback?: string;
    },
  ) => {
    const inherited = voicePipelineErrorDetails(reason);
    const code = context.code ?? inherited.code;
    const status = context.status ?? inherited.status;
    const endpoint = context.endpoint ?? inherited.endpoint;
    const friendly = userFacingVoiceError({
      code,
      status,
      message: inherited.message,
      fallback: context.fallback,
    });
    const incident = createErrorIncident({
      friendly,
      code,
      status,
      endpoint,
      serverReference: inherited.serverReference,
      phase: context.phase,
      elapsedMs: context.operation ? performance.now() - context.operation.startedAtMs : undefined,
      runtime: window.serviceEarsDesktop ? "desktop" : "browser",
      online: navigator.onLine,
      speechMode: speechModeRef.current,
      voicePhase: voicePhaseRef.current,
    });
    try {
      const incidents = appendErrorIncident(
        parseErrorIncidents(localStorage.getItem(LOCAL_STORAGE_KEYS.errorRegistry)),
        incident,
      );
      localStorage.setItem(LOCAL_STORAGE_KEYS.errorRegistry, JSON.stringify(incidents));
      window.dispatchEvent(new Event(ERROR_REGISTRY_UPDATED_EVENT));
    } catch {
      // Error presentation must remain available when browser storage is disabled or full.
    }
    setError(friendly.message);
    setErrorIncident(incident);
    setErrorCopyStatus("idle");
    setReviewActivity({ phase: "error", title: context.title ?? friendly.title, detail: friendly.message });
    return friendly;
  }, []);

  const clearVisibleError = useCallback(() => {
    setError(undefined);
    setErrorIncident(undefined);
    setErrorCopyStatus("idle");
  }, []);

  const copyCurrentErrorReport = useCallback(async () => {
    if (!errorIncident) return;
    try {
      await navigator.clipboard.writeText(formatErrorIncident(errorIncident));
      setErrorCopyStatus("copied");
    } catch {
      setErrorCopyStatus("error");
    }
  }, [errorIncident]);

  const requestProvisionalReview = useCallback((
    rawText: string,
    operation: VoiceOperationToken,
    immediate = false,
  ) => {
    const text = rawText.replace(/\s+/g, " ").trim();
    if (!text || !menu || !selectedTable || !operationCoordinator.current.isActive(operation)) return;
    if (provisionalReviewTimer.current) window.clearTimeout(provisionalReviewTimer.current);
    provisionalReviewController.current?.abort();
    provisionalReviewText.current = text;

    provisionalReviewTimer.current = window.setTimeout(() => {
      const controller = new AbortController();
      provisionalReviewController.current = controller;
      provisionalReviewTimer.current = undefined;
      const priorLines = draftRef.current?.lines;
      void fetch("/api/interpret", {
        method: "POST",
        signal: controller.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: `preview-${operation.id}`.slice(0, 100),
          baseDraftRevision: operation.baseDraftRevision,
          tenantId: menu.tenantId,
          tableId: selectedTable.id,
          tableLabel: selectedTable.label,
          waiterId: "waiter-demo",
          source: "audio",
          engine: "deterministic",
          turns: [{ speaker: "customer", text }],
          priorLines,
          contextProductIds,
          dialectProfile,
          approvedAliases: approvedAliases(learningState),
        }),
      }).then(async (response) => {
        if (!response.ok) return undefined;
        return await response.json() as { draft?: DraftOrder };
      }).then((result) => {
        if (!result?.draft || controller.signal.aborted) return;
        if (provisionalReviewText.current !== text || !mayCommitOperation(operation)) return;
        setProvisionalDraft(result.draft);
        setProvisionalProducts([]);
        setVoicePhase("PROVISIONAL_REVIEW");
        if (provisionalReviewMarkedOperationId.current !== operation.id) {
          provisionalReviewMarkedOperationId.current = operation.id;
          performanceTrace.current?.mark("provisional-review", performance.now());
        }
        setReviewActivity({
          phase: "updated",
          title: "Voorlopig concept klaar",
          detail: "De snelle menucontrole is zichtbaar; de definitieve controle rondt uiterlijk binnen vijf seconden af of vraagt bevestiging.",
        });
      }).catch((error: unknown) => {
        if (!isAbortError(error)) setLivePreviewGuidance("Live concept lukte niet; de lokale eindcontrole loopt verder.");
      });
    }, immediate ? 0 : 220);
  }, [contextProductIds, dialectProfile, learningState, mayCommitOperation, menu, selectedTable]);

  useEffect(() => {
    speechModeRef.current = speechMode;
  }, [speechMode]);

  useEffect(() => {
    voicePhaseRef.current = voicePhase;
  }, [voicePhase]);

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      const BrowserRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
      setSpeechMode(window.serviceEarsDesktop ? "offline" : BrowserRecognition ? "browser" : "unavailable");
      const cachedMenu = localStorage.getItem("service-ears:menu");
      const savedDraft = localStorage.getItem("service-ears:draft");
      const savedTable = localStorage.getItem(LOCAL_STORAGE_KEYS.activeTable);
      const restoredTableId = savedTable || "TABLE-12";
      if (cachedMenu) {
        try { setMenuResponse(JSON.parse(cachedMenu) as MenuResponse); } catch { /* ignore corrupt cache */ }
      }
      if (savedDraft) {
        try {
          const legacyDraft = JSON.parse(savedDraft) as DraftOrder;
          if (legacyDraft.tableId === restoredTableId && !draftForTable(restoredTableId)) {
            storeDraftForTable(legacyDraft);
          }
        } catch { /* ignore corrupt cache */ }
      }
      setTableId(restoredTableId);
      setDraft(draftForTable(restoredTableId));
      setContextProductIds(contextForTable(restoredTableId));
      setTableEvents(eventsForTable(restoredTableId));
      setLearningState(parseLanguageLearning(localStorage.getItem(LANGUAGE_LEARNING_KEY)));
      setLivePreviewEnabled(localStorage.getItem(LIVE_PREVIEW_KEY) !== "disabled");
      setPerformanceSamples(parseVoicePerformanceSamples(localStorage.getItem(VOICE_PERFORMANCE_KEY)));
      const restoredDraft = draftForTable(restoredTableId);
      draftRef.current = restoredDraft;
      tableIdRef.current = restoredTableId;
      setDraftHistory({ past: [], present: restoredDraft, future: [] });
      setHydrated(true);
    }, 0);

    void fetch("/api/menu")
      .then(async (response) => {
        if (!response.ok) throw new VoicePipelineError({
          code: "MENU_LOAD_FAILED",
          status: response.status,
          message: "De actuele menukaart kon niet worden geladen; de lokale cache blijft actief.",
          endpoint: "/api/menu",
        });
        return (await response.json()) as MenuResponse;
      })
      .then((result) => {
        setMenuResponse(result);
        localStorage.setItem("service-ears:menu", JSON.stringify(result));
      })
      .catch((reason: unknown) => registerVoiceError(reason, {
        phase: "menu",
        code: "MENU_LOAD_FAILED",
        endpoint: "/api/menu",
        fallback: "De actuele menukaart kon niet worden geladen; de lokale cache blijft actief.",
      }));
    void fetch("/api/health")
      .then(async (response) => response.ok ? response.json() as Promise<{
        offlineSpeechConfigured?: boolean;
        localSpeech?: { selectedModel?: { label: string } };
      }> : undefined)
      .then((health) => {
        if (health?.offlineSpeechConfigured) {
          setSpeechMode("offline");
          if (health.localSpeech?.selectedModel?.label) {
            setSpeechInsight(`${health.localSpeech.selectedModel.label} is adaptief geselecteerd voor dit toestel.`);
          }
        }
      })
      .catch(() => { /* browser detection remains the fallback */ });

    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    return () => {
      window.clearTimeout(hydrateTimer);
    };
  }, [registerVoiceError]);

  useEffect(() => () => {
    operationCoordinator.current.cancel();
    browserRecognition.current?.abort();
    if (browserRecognitionStopTimer.current) window.clearTimeout(browserRecognitionStopTimer.current);
    livePreviewActive.current = false;
    livePreviewRecognition.current?.abort();
    if (provisionalReviewTimer.current) window.clearTimeout(provisionalReviewTimer.current);
    provisionalReviewController.current?.abort();
    if (silenceTimer.current) window.clearInterval(silenceTimer.current);
    if (speechWarmupTimer.current) window.clearInterval(speechWarmupTimer.current);
    recordingStream.current?.getTracks().forEach((track) => track.stop());
    audioSource.current?.disconnect();
    audioProcessor.current?.disconnect();
    audioSink.current?.disconnect();
    if (audioContext.current && audioContext.current.state !== "closed") {
      void audioContext.current.close();
    }
  }, []);

  useEffect(() => {
    draftRef.current = draft;
    if (draft) storeDraftForTable(draft);
  }, [draft]);

  useEffect(() => {
    tableIdRef.current = tableId;
  }, [tableId]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(LOCAL_STORAGE_KEYS.activeTable, tableId);
  }, [hydrated, tableId]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(LANGUAGE_LEARNING_KEY, JSON.stringify(learningState));
  }, [hydrated, learningState]);

  useEffect(() => {
    if (hydrated) localStorage.setItem(LIVE_PREVIEW_KEY, livePreviewEnabled ? "enabled" : "disabled");
  }, [hydrated, livePreviewEnabled]);

  const commitDraft = useCallback((nextDraft: DraftOrder) => {
    draftRef.current = nextDraft;
    setDraftHistory((current) => pushDraftHistory(current.present ? current : { ...current, present: draft }, nextDraft));
    setDraft(nextDraft);
    const remainingBlockers = nextDraft.issues.filter((issue) => issue.blocking).length;
    setReviewActivity(remainingBlockers > 0
      ? {
          phase: "unchanged",
          title: "Bevestiging nodig",
          detail: `${remainingBlockers} controlepunt${remainingBlockers === 1 ? "" : "en"} wacht${remainingBlockers === 1 ? "" : "en"} nog op een keuze.`,
        }
      : {
          phase: "updated",
          title: "Review bijgewerkt",
          detail: "Het bestelconcept is aangepast en opnieuw gevalideerd.",
        });
  }, [draft]);

  const interpretTurns = useCallback(async (
    turns: ConversationTurn[],
    source: "text" | "audio" | "manual",
    priorLines?: DraftOrder["lines"],
    existingOperation?: VoiceOperationToken,
  ) => {
    if (!menu || !selectedTable || turns.length === 0) return;
    const operation = existingOperation ?? beginOperation(source === "manual" ? "correction" : source === "audio" ? "conversation" : "text");
    if (!operationCoordinator.current.isActive(operation)) return;
    setBusy(true);
    setVoicePhase("INTERPRETING");
    performanceTrace.current?.mark("interpretation-start", performance.now());
    clearVisibleError();
    setReviewActivity({
      phase: "interpreting",
      title: source === "audio" ? "Spraak begrijpen" : "Bestelling begrijpen",
      detail: "Producten, aantallen, vragen en de eerdere tafelcontext worden gecontroleerd.",
    });
    try {
      const utteranceText = turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|");
      const utteranceId = stableUtteranceId(selectedTable.id, utteranceText);
      const recentProcessedUtteranceIds = [...new Set(tableEvents
        .filter((event) => Date.now() - new Date(event.createdAt).getTime() < 30_000)
        .map((event) => event.utteranceId))];
      const response = await fetch("/api/interpret", {
        method: "POST",
        signal: operation.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operationId: operation.id,
          baseDraftRevision: operation.baseDraftRevision,
          tenantId: menu.tenantId,
          tableId: selectedTable.id,
          tableLabel: selectedTable.label,
          waiterId: "waiter-demo",
          source,
          engine: "deterministic",
          turns,
          priorLines,
          contextProductIds,
          dialectProfile,
          utteranceId,
          processedUtteranceIds: recentProcessedUtteranceIds,
          approvedAliases: approvedAliases(learningState),
        }),
      });
      const result = (await response.json()) as {
        operationId?: string;
        tableId?: string;
        baseDraftRevision?: string;
        draft?: DraftOrder;
        assistantMessage?: string;
        nextContextProductIds?: string[];
        events?: TableMemoryEvent[];
        actions?: PlannedOrderAction[];
        duplicateIgnored?: boolean;
      } & ApiFailure;
      if (!response.ok || !result.draft) {
        throw new VoicePipelineError({
          code: result.code,
          status: response.status,
          message: result.error,
          endpoint: "/api/interpret",
          serverReference: result.diagnosticId,
        });
      }
      if (result.operationId !== operation.id || result.tableId !== operation.tableId || result.baseDraftRevision !== operation.baseDraftRevision) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      if (!mayCommitOperation(operation)) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      performanceTrace.current?.mark("interpretation-end", performance.now());
      if (!result.duplicateIgnored) commitDraft(result.draft);
      setAssistantMessage(result.assistantMessage);
      setLatestActions(result.actions ?? []);
      const nextEvents = appendTableEvents(tableEvents, result.events ?? []);
      setTableEvents(nextEvents);
      storeEventsForTable(selectedTable.id, nextEvents);
      const nextContextProductIds = result.nextContextProductIds ?? [];
      setContextProductIds(nextContextProductIds);
      storeContextForTable(selectedTable.id, nextContextProductIds);
      const keepAudioTranscriptForReview = source === "audio" && result.draft.lines.length === 0 && !result.assistantMessage;
      if (shouldClearTranscriptAfterSuccess(source) && !keepAudioTranscriptForReview) {
        if (source !== "audio") setTranscript("");
        setSelectedDemo("");
      }
      const mutatingActions = (result.actions ?? []).filter((action) => action.mutatesOrder);
      const uniqueMutatingActions = [...new Map(
        mutatingActions.map((action) => [`${action.intent}:${action.summary}`, action]),
      ).values()];
      const blockingIssues = result.draft.issues.filter((issue) => issue.blocking);
      setReviewActivity(result.duplicateIgnored
        ? {
            phase: "unchanged",
            title: "Uitspraak was al verwerkt",
            detail: "Review bleef bewust ongewijzigd zodat dezelfde bestelling niet dubbel wordt toegevoegd.",
          }
        : blockingIssues.length > 0
          ? {
              phase: "unchanged",
              title: "Bevestiging nodig",
              detail: `Kies eerst tussen de voorgestelde opties; ${blockingIssues.length === 1 ? "dit controlepunt" : "deze controlepunten"} wordt niet stilzwijgend naar het POS gestuurd.`,
            }
        : uniqueMutatingActions.length > 0
          ? {
              phase: "updated",
              title: "Review bijgewerkt",
              detail: uniqueMutatingActions.slice(0, 2).map((action) => action.summary).join(" · "),
            }
          : {
              phase: "unchanged",
              title: result.assistantMessage ? "Vraag beantwoord" : "Geen bestelwijziging gehoord",
              detail: result.assistantMessage
                ? "Het antwoord staat bij Conversation; Review bleef bewust ongewijzigd omdat er nog niets werd besteld."
                : "De uitspraak is als context verwerkt, maar bevatte geen voldoende duidelijke toevoeging, wijziging of verwijdering.",
            });
      finishOperation(operation, "ready", "READY_FOR_REVIEW");
    } catch (reason) {
      if (isAbortError(reason) || !operationCoordinator.current.isActive(operation)) return;
      registerVoiceError(reason, { phase: "interpretation", operation, endpoint: "/api/interpret" });
      finishOperation(operation, "error", "ERROR");
    }
  }, [beginOperation, clearVisibleError, commitDraft, contextProductIds, dialectProfile, finishOperation, learningState, mayCommitOperation, menu, registerVoiceError, selectedTable, tableEvents]);

  const applyCorrection = useCallback(async (text: string, operation?: VoiceOperationToken) => {
    if (!draft || !text.trim()) return;
    await interpretTurns([{ speaker: "unknown", text: text.trim() }], "manual", draft.lines, operation);
  }, [draft, interpretTurns]);

  const uploadRecording = useCallback(async (
    blob: Blob,
    purpose: "conversation" | "correction",
    operation: VoiceOperationToken,
    audioQuality?: AudioQualityResult,
    browserPreview?: string,
    browserPreviewFinal = false,
    preparation?: PreparedSpeechPcm,
  ) => {
    if (!operationCoordinator.current.isActive(operation)) return;
    setBusy(true);
    setVoicePhase("LOCAL_TRANSCRIBING");
    performanceTrace.current?.mark("transcription-start", performance.now());
    clearVisibleError();
    setReviewActivity({
      phase: "transcribing",
      title: purpose === "correction" ? "Correctie uitschrijven" : "Spraak uitschrijven",
      detail: "De lokale opname wordt nu omgezet naar tekst. Daarna wordt Review automatisch bijgewerkt.",
    });
    try {
      const data = new FormData();
      data.append("operationId", operation.id);
      data.append("tableId", operation.tableId);
      data.append("baseDraftRevision", operation.baseDraftRevision);
      data.append("audio", new File([blob], "conversation.wav", { type: "audio/wav" }));
      data.append("language", speechLanguage);
      data.append("contextProductIds", JSON.stringify(contextProductIds));
      data.append("priorProductIds", JSON.stringify(draft?.lines.map((line) => line.productId) ?? []));
      data.append("dialectProfile", dialectProfile);
      data.append("approvedAliases", JSON.stringify(approvedAliases(learningState)));
      if (browserPreview?.trim()) {
        data.append("browserHypotheses", JSON.stringify([{ text: browserPreview.trim(), confidence: 0.74 }]));
        data.append("browserPreviewFinal", String(browserPreviewFinal));
      }
      if (audioQuality) {
        data.append("audioRms", String(audioQuality.rms));
        data.append("audioSilenceRatio", String(audioQuality.silenceRatio));
        data.append("audioClippingRatio", String(audioQuality.clippingRatio));
        if (preparation) data.append("audioNoiseFloorRms", String(preparation.noiseFloorRms));
      }
      const response = await fetch("/api/transcribe", { method: "POST", body: data, signal: operation.signal });
      const result = (await response.json()) as {
        operationId?: string;
        tableId?: string;
        baseDraftRevision?: string;
        text?: string;
        turns?: ConversationTurn[];
        confidence?: number;
        vadUsed?: boolean;
        vadProfile?: "quiet" | "clipped" | "noisy" | "balanced";
        secondPassAttempted?: boolean;
        secondPassSelected?: boolean;
        hypothesisMargin?: number;
        hypotheses?: Array<{ text: string; confidence: number; selected: boolean }>;
        localModel?: {
          label: string;
          fallbackUsed: boolean;
          processingMs: number;
          audioDurationSeconds: number;
          threadCount: number;
          runtime: "persistent-server" | "cli";
        };
        crossEngine?: {
          attempted: boolean;
          selected: "edge-live-preview" | "local-whisper";
          margin: number;
        };
      } & ApiFailure;
      if (!response.ok || !result.turns || !result.text) {
        throw new VoicePipelineError({
          code: result.code,
          status: response.status,
          message: result.error,
          endpoint: "/api/transcribe",
          serverReference: result.diagnosticId,
        });
      }
      if (result.operationId !== operation.id || result.tableId !== operation.tableId || result.baseDraftRevision !== operation.baseDraftRevision) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      if (!mayCommitOperation(operation)) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      performanceTrace.current?.mark("transcription-end", performance.now());
      const speechDetails = [
        result.vadUsed ? `Lokale spraak-/ruisdetectie actief (${result.vadProfile === "quiet" ? "zachte spraak" : result.vadProfile === "clipped" ? "luid geluid" : result.vadProfile === "noisy" ? "drukke omgeving" : "gebalanceerd"}).` : undefined,
        result.secondPassAttempted
          ? result.secondPassSelected
            ? "Een contextgerichte tweede herkenning gaf het beste resultaat."
            : "Een contextgerichte tweede herkenning bevestigde het eerste resultaat."
          : undefined,
        typeof result.confidence === "number" ? `Akoestische zekerheid: ${Math.round(result.confidence * 100)}%.` : undefined,
        result.hypotheses && result.hypotheses.length > 1
          ? `${result.hypotheses.length} transcriptiekandidaten vergeleken${typeof result.hypothesisMargin === "number" && result.hypothesisMargin < 0.35 ? "; kleine scoremarge, controleer de gemarkeerde match" : ""}.`
          : undefined,
        result.crossEngine?.attempted
          ? result.crossEngine.selected === "edge-live-preview"
            ? "De live Edge-versie scoorde duidelijk beter en werd door de lokale/menucontrole gekozen."
            : "De live Edge-versie werd vergeleken; lokale Whisper bleef de beste eindversie."
          : undefined,
        result.localModel
          ? `${result.localModel.label} verwerkte ${result.localModel.audioDurationSeconds.toFixed(1)} seconden audio in ${(result.localModel.processingMs / 1_000).toFixed(1)} seconden met maximaal ${result.localModel.threadCount} threads${result.localModel.runtime === "persistent-server" ? "; model blijft tijdelijk warm voor de volgende opname" : ""}${result.localModel.fallbackUsed ? "; automatisch teruggeschakeld na een probleem" : ""}.`
          : undefined,
        preparation && preparation.trimmedDurationSeconds >= 0.35
          ? `${preparation.trimmedDurationSeconds.toFixed(1)} seconden omgevingsgeluid en eindstilte zijn vóór herkenning verwijderd.`
          : undefined,
      ].filter(Boolean).join(" ");
      setSpeechInsight(speechDetails || undefined);
      setLivePreviewGuidance(undefined);
      if (purpose === "correction") {
        await applyCorrection(result.text, operation);
      } else {
        setSelectedDemo("");
        setTranscript(formatTurns(result.turns));
        await interpretTurns(result.turns, "audio", draft?.lines, operation);
      }
    } catch (reason) {
      if (isAbortError(reason) || !operationCoordinator.current.isActive(operation)) return;
      registerVoiceError(reason, { phase: "transcription", operation, endpoint: "/api/transcribe" });
      finishOperation(operation, "error", "ERROR");
    }
  }, [applyCorrection, clearVisibleError, contextProductIds, dialectProfile, draft, finishOperation, interpretTurns, learningState, mayCommitOperation, registerVoiceError, speechLanguage]);

  const finishBrowserRecognition = useCallback(async (purpose: "conversation" | "correction", text: string, operation: VoiceOperationToken) => {
    if (!operationCoordinator.current.isActive(operation)) return;
    const recognizedText = text.trim();
    if (!recognizedText) {
      registerVoiceError(new VoicePipelineError({
        code: "NO_SPEECH_DETECTED",
        message: "Geen spraak herkend. Probeer opnieuw en spreek iets dichter bij de microfoon.",
      }), {
        phase: "browser-speech",
        operation,
        code: "NO_SPEECH_DETECTED",
      });
      finishOperation(operation, "error", "ERROR");
      return;
    }
    if (purpose === "correction") {
      await applyCorrection(recognizedText, operation);
      return;
    }
    const turns: ConversationTurn[] = [{ speaker: "customer", text: recognizedText }];
    setSpeechInsight("De beste Edge-transcriptie is gekozen met het menu en de huidige tafelcontext.");
    setTranscript(formatTurns(turns));
    await interpretTurns(turns, "audio", draft?.lines, operation);
  }, [applyCorrection, draft, finishOperation, interpretTurns, registerVoiceError]);

  const startLocalRecording = useCallback(async (purpose: "conversation" | "correction", operation: VoiceOperationToken) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const context = new AudioContext({ latencyHint: "interactive" });
      const source = context.createMediaStreamSource(stream);
      const processor = context.createScriptProcessor(4_096, 1, 1);
      const sink = context.createGain();
      sink.gain.value = 0;
      recordingChunks.current = [];
      recordingSampleRate.current = context.sampleRate;
      recordingPurposeRef.current = purpose;
      heardVoice.current = false;
      consecutiveVoiceFrames.current = 0;
      adaptiveNoiseFloor.current = ambientNoiseFloor.current;
      recordingStartedAt.current = context.currentTime;
      lastVoiceAt.current = context.currentTime;
      processor.onaudioprocess = (event) => {
        const samples = new Float32Array(event.inputBuffer.getChannelData(0));
        recordingChunks.current.push(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / Math.max(1, samples.length));
        const floor = adaptiveNoiseFloor.current;
        const speechThreshold = Math.max(0.0075, floor + Math.max(0.003, floor * 0.2));
        if (rms >= speechThreshold) {
          consecutiveVoiceFrames.current += 1;
          if (consecutiveVoiceFrames.current >= 2) {
            heardVoice.current = true;
            lastVoiceAt.current = context.currentTime;
          }
        } else {
          consecutiveVoiceFrames.current = 0;
          if (!heardVoice.current || context.currentTime - lastVoiceAt.current >= 0.25) {
            const boundedRms = Math.min(rms, floor * 1.3);
            adaptiveNoiseFloor.current = Math.max(0.0015, floor * 0.985 + boundedRms * 0.015);
          }
        }
        setAudioLevel(Math.min(1, rms * 7));
      };
      source.connect(processor);
      processor.connect(sink);
      sink.connect(context.destination);
      recordingStream.current = stream;
      audioContext.current = context;
      audioSource.current = source;
      audioProcessor.current = processor;
      audioSink.current = sink;
      setRecording(purpose);
      startOfflineLivePreview(purpose, operation);
      silenceTimer.current = window.setInterval(() => {
        const elapsedSeconds = context.currentTime - recordingStartedAt.current;
        const finishDelaySeconds = automaticSilenceDelaySeconds({
          noiseFloorRms: adaptiveNoiseFloor.current,
          spokenDurationSeconds: Math.max(0, lastVoiceAt.current - recordingStartedAt.current),
          previewText: livePreviewText.current,
        });
        const silenceFinished = autoProcessOnSilence && heardVoice.current &&
          context.currentTime - lastVoiceAt.current >= finishDelaySeconds;
        const noSpeechTimeout = !heardVoice.current && elapsedSeconds >= 15;
        const safetyLimit = elapsedSeconds >= MAX_AUTOMATIC_RECORDING_SECONDS;
        if (recordingPurposeRef.current === purpose && (silenceFinished || noSpeechTimeout || safetyLimit)) {
          if (silenceTimer.current) window.clearInterval(silenceTimer.current);
          silenceTimer.current = undefined;
          void stopRecording(purpose);
        }
      }, 250);
    } catch (reason) {
      registerVoiceError(reason, {
        phase: "microphone",
        operation,
        code: "MICROPHONE_DENIED",
        title: "Microfoon niet beschikbaar",
        fallback: "Microfoontoegang is geweigerd.",
      });
      finishOperation(operation, "error", "ERROR");
    }
  }, [autoProcessOnSilence, finishOperation, registerVoiceError]);

  const startBrowserRecording = (purpose: "conversation" | "correction", operation: VoiceOperationToken) => {
    const BrowserRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!BrowserRecognition) {
      registerVoiceError(new VoicePipelineError({
        code: "BROWSER_SPEECH_UNAVAILABLE",
        message: "Browser-spraakherkenning is niet beschikbaar. Gebruik de geïnstalleerde lokale versie of Microsoft Edge.",
      }), {
        phase: "browser-speech",
        operation,
        code: "BROWSER_SPEECH_UNAVAILABLE",
      });
      void startLocalRecording(purpose, operation);
      return;
    }
    const recognition = new BrowserRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.lang = speechLanguage === "auto"
      ? navigator.language || "nl-BE"
      : { nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[speechLanguage];
    browserRecognitionText.current = "";
    browserRecognitionPreviewText.current = "";
    browserRecognitionFailed.current = false;
    browserRecognitionFallbackStarted.current = false;
    recognition.onresult = (event) => {
      setAudioLevel(0.72);
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const candidate = bestSpeechAlternative(result, menu, speechPreferredProductIds);
        if (result.isFinal) browserRecognitionText.current += `${candidate} `;
        else interimText += candidate;
      }
      const preview = `${browserRecognitionText.current}${interimText}`.trim();
      browserRecognitionPreviewText.current = preview;
      if (purpose === "conversation" && preview) {
        setTranscript(`Customer: ${preview}`);
        requestProvisionalReview(preview, operation);
        if (menu) {
          const products = [...new Map(findProductMentions(preview, menu, { preferredProductIds: speechPreferredProductIds })
            .flatMap((mention) => mention.candidates.slice(0, 1))
            .map((product) => [product.id, { id: product.id, name: product.canonicalName }])).values()].slice(0, 4);
          setProvisionalProducts(products);
          if (products.length) setVoicePhase("PROVISIONAL_REVIEW");
        }
      }
    };
    recognition.onspeechend = () => {
      if (!autoProcessOnSilence) return;
      if (browserRecognitionStopTimer.current) window.clearTimeout(browserRecognitionStopTimer.current);
      browserRecognitionStopTimer.current = window.setTimeout(() => {
        if (browserRecognition.current !== recognition) return;
        recognition.stop();
      }, 650);
    };
    recognition.onerror = (event) => {
      browserRecognitionFailed.current = true;
      const errorCode = event.error ?? "failed";
      const fallbackDecision = browserSpeechFallbackDecision(errorCode);
      const explanation = errorCode === "not-allowed"
        ? "Microfoontoegang is geweigerd. Sta de microfoon toe in Microsoft Edge en probeer opnieuw."
        : errorCode === "network"
          ? "De Edge-spraakdienst is niet bereikbaar; de lokale opname wordt automatisch als veilige backup gebruikt."
          : errorCode === "no-speech"
            ? "Er werd geen duidelijke spraak herkend. Spreek dichter bij de microfoon of kies de lokale opname."
            : "De browser-spraakondersteuning stopte onverwacht; de lokale verwerking gaat verder als veilige backup.";
      if (fallbackDecision === "user-denied") {
        registerVoiceError(new VoicePipelineError({
          code: "MICROPHONE_DENIED",
          message: explanation,
        }), {
          phase: "browser-speech",
          operation,
          code: "MICROPHONE_DENIED",
        });
        return;
      }
      if (fallbackDecision === "fallback-local" && !browserRecognitionFallbackStarted.current) {
        browserRecognitionFallbackStarted.current = true;
        setSpeechInsight("Browser-spraak mislukte; de lokale opname verwerkt de conversatie veilig.");
        registerVoiceError(new VoicePipelineError({
          code: "BROWSER_SPEECH_FAILED",
          message: explanation,
        }), {
          phase: "browser-speech",
          operation,
          code: "BROWSER_SPEECH_FAILED",
        });
        setRecording(undefined);
        setAudioLevel(0);
        void startLocalRecording(purpose, operation);
        return;
      }
      registerVoiceError(new VoicePipelineError({
        code: "BROWSER_SPEECH_FAILED",
        message: explanation,
      }), {
        phase: "browser-speech",
        operation,
        code: "BROWSER_SPEECH_FAILED",
      });
    };
    recognition.onend = () => {
      if (browserRecognitionStopTimer.current) window.clearTimeout(browserRecognitionStopTimer.current);
      browserRecognitionStopTimer.current = undefined;
      const recognizedText = completedBrowserSpeechText(
        browserRecognitionText.current,
        browserRecognitionPreviewText.current,
      );
      browserRecognition.current = undefined;
      setRecording(undefined);
      setAudioLevel(0);
      if (browserRecognitionFailed.current && !recognizedText) {
        if (!browserRecognitionFallbackStarted.current) {
          browserRecognitionFallbackStarted.current = true;
          setSpeechInsight("Browser-spraak leverde geen bruikbare tekst; de lokale opname wordt automatisch gestart.");
          void startLocalRecording(purpose, operation);
        }
        return;
      }
      if (recognizedText) clearVisibleError();
      void finishBrowserRecognition(purpose, recognizedText, operation);
    };
    browserRecognition.current = recognition;
    setRecording(purpose);
    recognition.start();
  };

  const startOfflineLivePreview = (purpose: "conversation" | "correction", operation: VoiceOperationToken) => {
    const BrowserRecognition = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!livePreviewEnabled || !BrowserRecognition) return;
    const recognition = new BrowserRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.maxAlternatives = 5;
    recognition.lang = speechLanguage === "auto"
      ? navigator.language || "nl-BE"
      : { nl: "nl-BE", fr: "fr-BE", en: "en-GB" }[speechLanguage];
    livePreviewText.current = "";
    livePreviewFinalText.current = "";
    livePreviewActive.current = true;
    recognition.onresult = (event) => {
      let interimText = "";
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        const candidate = bestSpeechAlternative(result, menu, speechPreferredProductIds);
        if (result.isFinal) livePreviewFinalText.current += `${candidate} `;
        else interimText += `${candidate} `;
      }
      const preview = `${livePreviewFinalText.current}${interimText}`.replace(/\s+/g, " ").trim();
      livePreviewText.current = preview;
      if (!preview || purpose !== "conversation") return;
      setTranscript(`Customer: ${preview}`);
      requestProvisionalReview(preview, operation);
      const advice = menu ? culinaryAdviceForText(preview, menu) : undefined;
      const recognizedProducts = menu
        ? [...new Map(findProductMentions(preview, menu, { preferredProductIds: speechPreferredProductIds })
          .flatMap((mention) => mention.candidates)
          .map((product) => [product.id, product])).values()]
        : [];
      setProvisionalProducts(recognizedProducts.slice(0, 4).map((product) => ({ id: product.id, name: product.canonicalName })));
      if (recognizedProducts.length) setVoicePhase("PROVISIONAL_REVIEW");
      setLivePreviewGuidance(advice?.message ?? (recognizedProducts.length
        ? `Voorlopig herkend: ${recognizedProducts.map((product) => product.canonicalName).join(", ")}. De lokale eindcontrole volgt na stoppen.`
        : "Live spraak wordt al gelezen; product en context worden nog gecontroleerd."));
    };
    recognition.onerror = () => {
      livePreviewActive.current = false;
      livePreviewRecognition.current = undefined;
      setLivePreviewGuidance("Live Edge-preview is niet bereikbaar; de lokale opname loopt verder en gaat niet verloren.");
    };
    recognition.onend = () => {
      if (!livePreviewActive.current) {
        livePreviewRecognition.current = undefined;
        return;
      }
      window.setTimeout(() => {
        if (!livePreviewActive.current) return;
        try { recognition.start(); } catch { livePreviewActive.current = false; }
      }, 150);
    };
    livePreviewRecognition.current = recognition;
    try {
      recognition.start();
    } catch {
      livePreviewActive.current = false;
      livePreviewRecognition.current = undefined;
    }
  };

  const startService = useCallback(async () => {
    if (speechWarmupInFlight.current) return;
    const needsLocalWarmup = localSpeechWarmupRequired(Boolean(window.serviceEarsDesktop), speechMode) || speechMode === "browser";
    speechWarmupInFlight.current = true;
    setShiftMode(true);
    setSpeechWarmupState(needsLocalWarmup ? "warming" : "ready");
    const requestWarmup = async () => {
      try {
        const response = await fetch("/api/transcribe/warmup", {
          method: "POST",
          signal: AbortSignal.timeout(LOCAL_SPEECH_WARMUP_TIMEOUT_MS),
        });
        if (!response.ok) return false;
        const result = await response.json() as { warmed?: boolean };
        return result.warmed === true;
      } catch {
        return false;
      }
    };
    const warmup = needsLocalWarmup ? requestWarmup() : Promise.resolve(true);
    const interpretationWarmup = fetch("/api/interpret", { cache: "no-store" })
      .then(async (response) => response.ok && (await response.json() as { warmed?: boolean }).warmed === true)
      .catch(() => false);
    setMicrophoneStatus("Ruis meten… blijf één seconde stil");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const context = new AudioContext({ latencyHint: "interactive" });
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      const source = context.createMediaStreamSource(stream);
      source.connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      let peakRms = 0;
      const calibrationLevels: number[] = [];
      const deadline = performance.now() + 700;
      while (performance.now() < deadline) {
        analyser.getFloatTimeDomainData(samples);
        const rms = Math.sqrt(samples.reduce((sum, sample) => sum + sample * sample, 0) / samples.length);
        peakRms = Math.max(peakRms, rms);
        calibrationLevels.push(rms);
        await new Promise((resolve) => window.setTimeout(resolve, 70));
      }
      source.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      const sortedLevels = calibrationLevels.sort((left, right) => left - right);
      const measuredNoiseFloor = sortedLevels[Math.floor(sortedLevels.length * 0.4)] ?? 0.004;
      ambientNoiseFloor.current = Math.max(0.0015, Math.min(0.12, measuredNoiseFloor));
      adaptiveNoiseFloor.current = ambientNoiseFloor.current;
      setMicrophoneStatus(peakRms < 0.006
        ? "Microfoon werkt · spreek dichterbij"
        : ambientNoiseFloor.current >= 0.018
          ? "Drukke omgeving · adaptieve ruisfilter actief"
          : "Microfoon gereed · ruisprofiel gemeten");
    } catch {
      setMicrophoneStatus("Kalibratie overgeslagen · controleer microfoontoegang");
    }
    const [warmed, interpretationReady] = await Promise.all([warmup, interpretationWarmup]);
    speechWarmupInFlight.current = false;
    if (!warmed) {
      setSpeechWarmupState("error");
      setMicrophoneStatus((current) => `${current} · lokale controle herstelt bij verwerking`);
    } else {
      setSpeechWarmupState("ready");
      setMicrophoneStatus((current) => needsLocalWarmup ? `${current} · bestelklaar` : current);
    }
    if (!interpretationReady) {
      setMicrophoneStatus((current) => `${current} · menucontrole activeert bij de eerste bestelling`);
    }
    if (needsLocalWarmup) {
      if (speechWarmupTimer.current) window.clearInterval(speechWarmupTimer.current);
      speechWarmupTimer.current = window.setInterval(() => {
        void requestWarmup().then((stillWarm) => {
          setSpeechWarmupState(stillWarm ? "ready" : "error");
          if (!stillWarm) setMicrophoneStatus("Bestelklaar · lokale controle herstelt bij de volgende verwerking");
        });
      }, LOCAL_SPEECH_KEEPALIVE_MS);
    }
  }, [speechMode]);

  useEffect(() => {
    if (!hydrated || speechMode === "detecting" || speechMode === "unavailable" || automaticServiceStartAttempted.current) return;
    automaticServiceStartAttempted.current = true;
    void startService();
  }, [hydrated, speechMode, startService]);

  const startRecording = async (purpose: "conversation" | "correction") => {
    const operation = beginOperation(purpose);
    clearVisibleError();
    setSpeechInsight(undefined);
    setLivePreviewGuidance(undefined);
    setReviewActivity({
      phase: "listening",
      title: purpose === "correction" ? "Correctie beluisteren" : "Review luistert mee",
      detail: "Nog niets is definitief toegevoegd. Na stilte volgt automatisch uitschrijven en controleren.",
    });
    if (!window.serviceEarsDesktop && speechMode !== "offline") {
      setSpeechInsight("Edge-spraak is optioneel; de lokale microfoon blijft de primaire opname voor een veilige bestelling.");
    }
    void startLocalRecording(purpose, operation);
  };

  const stopRecording = async (forcedPurpose?: "conversation" | "correction") => {
    if (stoppingRecording.current) return;
    const purpose = forcedPurpose ?? recordingPurposeRef.current ?? recording;
    if (!purpose) return;
    const operation = recordingOperation.current;
    if (!operation || !operationCoordinator.current.isActive(operation)) return;
    stoppingRecording.current = true;
    performanceTrace.current?.mark("stop", performance.now());
    setVoicePhase("FINALIZING_AUDIO");
    if (browserRecognition.current) {
      setBusy(true);
      if (browserRecognitionStopTimer.current) window.clearTimeout(browserRecognitionStopTimer.current);
      browserRecognitionStopTimer.current = undefined;
      browserRecognition.current.stop();
      stoppingRecording.current = false;
      return;
    }
    try {
      recordingPurposeRef.current = undefined;
      if (silenceTimer.current) window.clearInterval(silenceTimer.current);
      silenceTimer.current = undefined;
      livePreviewActive.current = false;
      const browserPreview = livePreviewText.current.trim();
      const browserPreviewFinal = Boolean(livePreviewFinalText.current.trim());
      if (browserPreview && purpose === "conversation") requestProvisionalReview(browserPreview, operation, true);
      livePreviewRecognition.current?.stop();
      livePreviewRecognition.current = undefined;
      audioSource.current?.disconnect();
      audioProcessor.current?.disconnect();
      audioSink.current?.disconnect();
      recordingStream.current?.getTracks().forEach((track) => track.stop());
      if (audioContext.current && audioContext.current.state !== "closed") {
        await audioContext.current.close();
      }
      if (!heardVoice.current || recordingChunks.current.length === 0) {
        setRecording(undefined);
        setAudioLevel(0);
        registerVoiceError(new VoicePipelineError({
          code: "NO_SPEECH_DETECTED",
          message: "Geen duidelijke spraak gehoord. De lege opname is niet verwerkt; probeer opnieuw en spreek iets dichter bij de microfoon.",
        }), {
          phase: "microphone",
          operation,
          code: "NO_SPEECH_DETECTED",
        });
        finishOperation(operation, "error", "ERROR");
        return;
      }
      const { blob, preparation } = preparedRecordingToWav(
        recordingChunks.current,
        recordingSampleRate.current,
        adaptiveNoiseFloor.current,
      );
      const audioQuality = analyzeAudioQuality([preparation.samples]);
      if (!preparation.speechDetected) {
        setRecording(undefined);
        setAudioLevel(0);
        registerVoiceError(new VoicePipelineError({
          code: "AUDIO_ONLY_NOISE",
          message: "Alleen omgevingsgeluid gehoord; er is bewust niets aan de bestelling veranderd.",
        }), {
          phase: "audio-finalization",
          operation,
          code: "AUDIO_ONLY_NOISE",
        });
        finishOperation(operation, "error", "ERROR");
        return;
      }
      const qualityMessage = audioQualityMessage(audioQuality);
      if (qualityMessage) setSpeechInsight(qualityMessage);
      setRecording(undefined);
      setAudioLevel(0);
      await uploadRecording(blob, purpose, operation, audioQuality, browserPreview, browserPreviewFinal, preparation);
    } catch (reason) {
      setRecording(undefined);
      registerVoiceError(reason, {
        phase: "audio-finalization",
        operation,
        fallback: "De opname kon niet worden verwerkt.",
      });
      finishOperation(operation, "error", "ERROR");
    } finally {
      recordingStream.current = undefined;
      audioContext.current = undefined;
      audioSource.current = undefined;
      audioProcessor.current = undefined;
      audioSink.current = undefined;
      recordingChunks.current = [];
      livePreviewText.current = "";
      livePreviewFinalText.current = "";
      heardVoice.current = false;
      consecutiveVoiceFrames.current = 0;
      stoppingRecording.current = false;
    }
  };

  const sendDraft = async () => {
    if (!draft) return;
    const operation = beginOperation("send");
    setBusy(true);
    setVoicePhase("SENDING");
    clearVisibleError();
    try {
      const response = await fetch("/api/pos/drafts", {
        method: "POST",
        signal: operation.signal,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          draft: { ...draft, status: "NOT_SENT" },
          idempotencyKey: `draft:${draft.id}`,
          sentBy: "waiter-demo",
          operationId: operation.id,
          baseDraftRevision: operation.baseDraftRevision,
        }),
      });
      const result = (await response.json()) as {
        draft?: DraftOrder;
        adapter?: string;
        operationId?: string;
        tableId?: string;
        baseDraftRevision?: string;
      } & ApiFailure;
      if (!response.ok || !result.draft) {
        throw new VoicePipelineError({
          code: result.code,
          status: response.status,
          message: result.error,
          endpoint: "/api/pos/drafts",
          serverReference: result.diagnosticId,
        });
      }
      if (result.operationId !== operation.id || result.tableId !== operation.tableId || result.baseDraftRevision !== operation.baseDraftRevision) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      if (!mayCommitOperation(operation)) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      const orderReference = result.draft.posSubmission?.externalOrderId;
      if (orderReference && menuResponse?.capabilities.openOrderRead) {
        const confirmation = await fetch(`/api/pos/drafts?externalOrderId=${encodeURIComponent(orderReference)}`, {
          signal: operation.signal,
          cache: "no-store",
        });
        if (!confirmation.ok) {
          throw new VoicePipelineError({
            code: "POS_READBACK_FAILED",
            status: confirmation.status,
            message: "De POS-overdracht kon niet worden teruggelezen. Het concept blijft lokaal zichtbaar voor controle.",
            endpoint: "/api/pos/drafts",
          });
        }
      }
      if (!mayCommitOperation(operation)) {
        finishOperation(operation, "cancelled", "CANCELLED");
        return;
      }
      commitDraft(result.draft);
      const isTestOrder = (result.adapter ?? result.draft.posSubmission?.adapter) === "mock-pos";
      setReviewActivity({
        phase: "updated",
        title: isTestOrder ? "Testorder aangemaakt" : "POS-concept verzonden",
        detail: orderReference
          ? `${isTestOrder ? "Test-POS-referentie" : "POS-referentie"}: ${orderReference}. De bestelregels blijven hieronder zichtbaar.`
          : "De POS-overdracht is bevestigd en de bestelregels blijven hieronder zichtbaar.",
      });
      finishOperation(operation, "sent", "SENT");
    } catch (reason) {
      if (isAbortError(reason) || !operationCoordinator.current.isActive(operation)) return;
      setDraft((current) => current ? { ...current, status: "ERROR", updatedAt: new Date().toISOString() } : current);
      registerVoiceError(reason, { phase: "pos", operation, endpoint: "/api/pos/drafts" });
      finishOperation(operation, "error", "ERROR");
    }
  };

  const groupedLines = useMemo(() => {
    if (!draft) return [];
    return (["drinks", "starter", "main", "dessert", "unspecified"] as Course[])
      .map((course) => ({ course, lines: draft.lines.filter((line) => line.course === course) }))
      .filter((group) => group.lines.length);
  }, [draft]);
  const hasBlockers = !draft || draft.lines.length === 0 || draft.issues.some((issue) => issue.blocking);

  return (
    <main className="app-shell">
      <header className="app-header">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">SE</span>
          <div className="brand-copy">
            <p className="eyebrow">SPRAAK NAAR KASSA</p>
            <h1>Service Ears</h1>
            <p className="brand-subtitle">Bestellen door gewoon te spreken</p>
          </div>
        </div>
        <div className="header-statuses">
          <DesktopSettings
            livePreviewEnabled={livePreviewEnabled}
            onLivePreviewEnabledChange={setLivePreviewEnabled}
            showLivePreviewSetting={speechMode === "offline"}
          />
          <span className={`network ${speechMode === "unavailable" ? "offline" : "online"}`}>
            {speechMode === "unavailable"
              ? "Spraak niet beschikbaar"
              : speechMode === "detecting" || !shiftMode
                ? "Automatisch voorbereiden…"
                : speechWarmupState === "warming"
                  ? "Bestelklaar · model warmt op"
                  : "Bestelklaar"}
          </span>
        </div>
      </header>

      <section className="hero-card">
        <div className="table-picker">
          <p className="hero-overline">Klaar om te bestellen</p>
          <label htmlFor="table">Actieve tafel</label>
          <select id="table" value={tableId} onChange={(event) => {
            const nextTableId = event.target.value;
            operationCoordinator.current.cancel();
            setVoicePhase("CANCELLED");
            setProvisionalProducts([]);
            setProvisionalDraft(undefined);
            if (provisionalReviewTimer.current) window.clearTimeout(provisionalReviewTimer.current);
            provisionalReviewController.current?.abort();
            const nextDraft = draftForTable(nextTableId);
            tableIdRef.current = nextTableId;
            draftRef.current = nextDraft;
            setTableId(nextTableId);
            setDraft(nextDraft);
            setContextProductIds(contextForTable(nextTableId));
            setTableEvents(eventsForTable(nextTableId));
            setLatestActions([]);
            setDraftHistory({ past: [], present: draftForTable(nextTableId), future: [] });
            setAssistantMessage(undefined);
            setTranscript("");
            setSelectedDemo("");
            setSpeechInsight(undefined);
            setReviewActivity(undefined);
          }} disabled={!menu || busy || Boolean(recording)}>
            {menu?.tables.filter((table) => table.active).map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
          </select>
        </div>
        <div className="record-area">
          <div className="record-command">
            <button
              className={`record-button ${recording === "conversation" ? "recording" : ""}`}
              disabled={busy || !menu || !localSpeechRecordingReady(speechMode, speechWarmupState) || recording === "correction"}
              onClick={() => recording === "conversation" ? void stopRecording() : void startRecording("conversation")}
              aria-label={recording === "conversation" ? "Opname stoppen" : "Gesprek opnemen"}
            >
              <span className="record-dot" />
              {recording === "conversation" ? "Stop & verwerk" : "Luister"}
            </button>
            <div className="meter-row">
              <span>Microfoon</span>
              <div className="audio-meter" aria-label={`Microfoonniveau ${Math.round(audioLevel * 100)} procent`}><span style={{ width: `${Math.max(3, audioLevel * 100)}%` }} /></div>
            </div>
          </div>
          <div className="record-copy">
            <p>{speechMode === "offline"
              ? "Spreek natuurlijk. Bestellingen verschijnen automatisch; twijfel wordt zichtbaar gemarkeerd."
              : speechMode === "browser"
                ? "Spreek natuurlijk. De gratis browserherkenning verwerkt het gesprek direct."
                : "Spraak wordt automatisch voorbereid."} <span className="microphone-status">{microphoneStatus}</span></p>
          </div>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel capture-panel">
          <div className="panel-heading">
            <div><p className="step">01 · GESPREK</p><h2>Laatst gehoord</h2><p className="panel-intro">Taal en dialect worden automatisch herkend.</p></div>
          </div>
          <div className={`speech-feed ${transcript ? "has-text" : ""}`} aria-live="polite">
            <span className="speech-feed-mark" aria-hidden="true">“</span>
            <p>{transcript || (recording ? "Ik luister…" : "Druk op Luister en spreek zoals je dat aan tafel doet.")}</p>
          </div>
          {livePreviewGuidance && <div className="live-understanding" role="status"><strong>Live voorlopig</strong><p>{livePreviewGuidance}</p></div>}
          {speechInsight && <p className="speech-insight" role="status">{speechInsight}</p>}
          {assistantMessage && <div className="answer-card" role="status"><strong>Service Ears</strong><p>{assistantMessage}</p></div>}
          {draft && <div className="capture-actions"><button className="small-button" disabled={busy} onClick={() => {
              operationCoordinator.current.cancel();
              recordingOperation.current = undefined;
              performanceTrace.current = undefined;
              setVoicePhase("IDLE");
              setProvisionalProducts([]);
              setProvisionalDraft(undefined);
              if (provisionalReviewTimer.current) window.clearTimeout(provisionalReviewTimer.current);
              provisionalReviewController.current?.abort();
              draftRef.current = undefined;
              setDraft(undefined);
              setAssistantMessage(undefined);
              setContextProductIds([]);
              setTranscript("");
              setSelectedDemo("");
              setSpeechInsight(undefined);
              setReviewActivity(undefined);
              clearDraftForTable(tableId);
              storeContextForTable(tableId, []);
              storeEventsForTable(tableId, []);
              setTableEvents([]);
              setLatestActions([]);
              setDraftHistory({ past: [], future: [] });
              localStorage.removeItem("service-ears:draft");
            }}>Nieuwe bestelling</button></div>}
        </div>

        <div className="panel order-panel">
          <div className="panel-heading">
            <div><p className="step">02 · BESTELLING</p><h2>{draft?.tableLabel ?? "Bestelconcept"}</h2><p className="panel-intro">Uitgesproken bestellingen verschijnen meteen; twijfel staat er duidelijk bij.</p></div>
            <span className={`order-status status-${draft?.status.toLowerCase() ?? "empty"}`}>
              {draft?.status === "NOT_SENT" ? "CONCEPT" : draft?.status === "SENT" ? "VERZONDEN" : draft?.status === "ERROR" ? "FOUT" : "LEEG"}
            </span>
          </div>
          <div className="review-tools">
            <span>Spreek verder om producten toe te voegen of te verwijderen.</span>
            <button className="small-button" disabled={!draftHistory.past.length} onClick={() => { const next = undoDraft(draftHistory); setDraftHistory(next); if (next.present) setDraft(next.present); }}>Ongedaan maken</button>
          </div>

          {reviewActivity && (
            <div className={`review-activity review-activity-${reviewActivity.phase}`} role="status" aria-live="polite">
              <span className="review-activity-indicator" aria-hidden="true" />
              <div className="review-activity-content">
                <strong>{reviewActivity.title}</strong>
                <p>{reviewActivity.detail}</p>
                {reviewActivity.phase === "error" && errorIncident && (
                  <details className="technical-error-details" open>
                    <summary>Technische uitleg · {errorIncident.reference}</summary>
                    <p>{errorIncident.explanation}</p>
                    <dl>
                      <div><dt>Code</dt><dd>{errorIncident.code}</dd></div>
                      <div><dt>Fase</dt><dd>{errorIncident.phase}</dd></div>
                      {errorIncident.status && <div><dt>HTTP</dt><dd>{errorIncident.status}</dd></div>}
                      {errorIncident.serverReference && <div><dt>Server</dt><dd>{errorIncident.serverReference}</dd></div>}
                      {typeof errorIncident.elapsedMs === "number" && <div><dt>Duur</dt><dd>{errorIncident.elapsedMs} ms</dd></div>}
                    </dl>
                    <ul>{errorIncident.suggestedChecks.map((check) => <li key={check}>{check}</li>)}</ul>
                    <button type="button" className="small-button" onClick={() => void copyCurrentErrorReport()}>
                      Technisch rapport kopiëren
                    </button>
                    <small aria-live="polite">
                      {errorCopyStatus === "copied" && "Gekopieerd — plak dit rapport in Codex."}
                      {errorCopyStatus === "error" && "Kopiëren lukte niet; gebruik het register onder Instellingen."}
                    </small>
                  </details>
                )}
              </div>
            </div>
          )}

          {draft?.status === "SENT" && draft.posSubmission && (
            <div className="pos-receipt" role="status">
              <span aria-hidden="true">✓</span>
              <div>
                <strong>{draft.posSubmission.adapter === "mock-pos" ? "Testorder ontvangen" : "POS-concept ontvangen"}</strong>
                <p>{draft.posSubmission.externalOrderId}</p>
              </div>
              <time dateTime={draft.posSubmission.sentAt}>
                {new Date(draft.posSubmission.sentAt).toLocaleTimeString("nl-BE", { hour: "2-digit", minute: "2-digit" })}
              </time>
            </div>
          )}

          {!draft && <div className="empty-state"><span>⌁</span><strong>Nog geen bestelling</strong><p>Zodra je een product uitspreekt, verschijnt het hier automatisch.</p></div>}
          {provisionalDraft && (
            <div className="provisional-review provisional-draft" role="status" aria-live="polite">
              <span className="provisional-pulse" aria-hidden="true" />
              <div>
                <strong>Bestelling gehoord · eindcontrole loopt</strong>
                {provisionalDraft.lines.length > 0
                  ? <div className="provisional-lines">{provisionalDraft.lines.map((line) => <p key={line.lineId}>
                    <b>{line.quantity}× {line.canonicalName}</b>
                    {line.modifiers.length > 0 && <span> · {line.modifiers.map((modifier) => modifier.canonicalName).join(", ")}</span>}
                  </p>)}</div>
                  : <p>Context of vraag wordt gecontroleerd.</p>}
                {provisionalDraft.issues.some((issue) => issue.blocking) && <small>Bevestiging nodig voor {provisionalDraft.issues.filter((issue) => issue.blocking).length} onzeker punt.</small>}
                <small>De definitieve controle volgt uiterlijk binnen vijf seconden.</small>
              </div>
            </div>
          )}
          {!provisionalDraft && provisionalProducts.length > 0 && (
            <div className="provisional-review" role="status" aria-live="polite">
              <span className="provisional-pulse" aria-hidden="true" />
              <div>
                <strong>Voorlopig gehoord</strong>
                <p>{provisionalProducts.map((product) => product.name).join(" · ")}</p>
                <small>Nog niet bestelbaar; lokale transcriptie en contextcontrole volgen.</small>
              </div>
            </div>
          )}

          {draft && (
            <>
              {groupedLines.map((group) => (
                <div className="course-group" key={group.course}>
                  <h3>{COURSE_LABELS[group.course]}</h3>
                  {group.lines.map((line) => (
                    <div className="order-line" key={line.lineId}>
                      <span className="line-quantity">{line.quantity}</span>
                      <div className="line-details">
                        <strong>{line.canonicalName}</strong>
                        <span className="pos-name">POS · {line.posName} · {line.sku}</span>
                        {line.modifiers.map((modifier) => <span className="modifier" key={modifier.optionId}>+ {modifier.canonicalName}</span>)}
                        {line.notes.map((note) => <span className="line-note" key={note}>Notitie · {note}</span>)}
                      </div>
                      <div className="line-actions" aria-label={`${line.canonicalName} wijzigen`}>
                        <button
                          type="button"
                          onClick={() => commitDraft(changeDraftLineQuantity(draft, line.lineId, -1))}
                          aria-label={`Eén ${line.canonicalName} minder`}
                          title="Eén minder"
                        >−</button>
                        <button
                          type="button"
                          onClick={() => commitDraft(changeDraftLineQuantity(draft, line.lineId, 1))}
                          aria-label={`Eén ${line.canonicalName} meer`}
                          title="Eén meer"
                        >+</button>
                        <button
                          type="button"
                          className="line-remove"
                          onClick={() => commitDraft(removeDraftLine(draft, line.lineId))}
                          aria-label={`${line.canonicalName} verwijderen`}
                        >Verwijder</button>
                      </div>
                    </div>
                  ))}
                </div>
              ))}

              {draft.warnings.slice(0, 1).map((warning) => <div className="warning-card" key={warning.id}><strong>Veiligheidscontrole</strong><p>{warning.message}</p></div>)}

              {draft.issues.length > 0 && <p className="step issue-step">ALLEEN NOG BEVESTIGEN</p>}
              {draft.issues.slice(0, 1).map((issue) => (
                <div className="issue-card" key={issue.id}>
                  <strong>{issue.message}</strong>
                  {typeof issue.matchConfidence === "number" && (
                    <p className="match-explanation">
                      Klankmatch {Math.round(issue.matchConfidence * 100)}%
                      {typeof issue.matchMargin === "number" ? ` · voorsprong ${Math.round(issue.matchMargin * 100)}%` : ""}
                      {issue.matchEvidence?.length ? ` · ${issue.matchEvidence.map((item) => item.replaceAll("-", " ")).join(", ")}` : ""}
                    </p>
                  )}
                  {(issue.type === "ambiguous_product" || issue.type === "ambiguous_removal") && (
                    <div className="candidate-grid">
                      {issue.productCandidates?.map((candidate) => {
                        const product = menu?.products.find((item) => item.id === candidate.productId);
                        return <button key={candidate.productId} disabled={!product || !menu} onClick={() => product && menu && commitDraft(
                          issue.type === "ambiguous_removal"
                            ? resolveRemovingProduct(draft, issue.id, product)
                            : resolveWithProduct(draft, issue.id, product, menu),
                        )}>
                          <span>{candidate.canonicalName}</span><small>{candidate.posName} · {price(candidate.priceCents)}</small>
                        </button>;
                      })}
                    </div>
                  )}
                  {issue.type === "speech_confirmation" && (
                    <div className="candidate-grid">
                      <button onClick={() => {
                        const productId = issue.productCandidates?.[0]?.productId;
                        if (issue.rawText && productId) setLearningState((current) => recordExplicitCorrection(current, issue.rawText!, productId));
                        commitDraft(confirmSpeechProduct(draft, issue.id));
                      }}>
                        <span>Ja, {issue.productCandidates?.[0]?.canonicalName ?? "dat product"}</span>
                        <small>Bevestig de spraakmatch</small>
                      </button>
                      <button onClick={() => commitDraft(rejectSpeechProduct(draft, issue.id))}>
                        <span>Nee, niet juist</span>
                        <small>Verwijder alleen deze onzekere toevoeging</small>
                      </button>
                    </div>
                  )}
                  {issue.type === "unresolved_product" && issue.productCandidates?.length && menu && (
                    <div className="candidate-grid suggested-alternatives">
                      {issue.productCandidates.map((candidate) => {
                        const product = menu.products.find((item) => item.id === candidate.productId);
                        return <button key={candidate.productId} disabled={!product} onClick={() => product && commitDraft(resolveWithProduct(draft, issue.id, product, menu))}>
                          <span>Gast kiest {candidate.canonicalName}</span>
                          <small>{candidate.posName} · {price(candidate.priceCents)}</small>
                        </button>;
                      })}
                    </div>
                  )}
                  {issue.type === "unresolved_product" && menu && <UnresolvedChoice draft={draft} issue={issue} menu={menu} onChange={(nextDraft) => {
                    const selectedLine = nextDraft.lines.at(-1);
                    if (issue.rawText && selectedLine) setLearningState((current) => recordExplicitCorrection(current, issue.rawText!, selectedLine.productId));
                    commitDraft(nextDraft);
                  }} />}
                  {issue.type === "missing_modifier" && (
                    <div className="candidate-grid">
                      {issue.modifierOptions?.map((option) => <button key={option.id} onClick={() => commitDraft(resolveModifier(draft, issue.id, issue.modifierGroupId!, option))}>
                        <span>{option.canonicalName}</span><small>{option.posName}{option.priceCents ? ` · +${price(option.priceCents)}` : ""}</small>
                      </button>)}
                    </div>
                  )}
                  {issue.type === "course_exception" && <button className="small-button" onClick={() => commitDraft(resolveIssueWithoutData(draft, issue.id))}>Timing bevestigen</button>}
                </div>
              ))}
              {draft.issues.length > 1 && <p className="queued-issues">Daarna volgen nog {draft.issues.length - 1} controlepunt{draft.issues.length === 2 ? "" : "en"}.</p>}
            </>
          )}

          {draft && (
            <div className="send-bar">
              <div><span>{draft.lines.reduce((sum, line) => sum + line.quantity, 0)} producten</span><small>{hasBlockers ? "Controleer het gemarkeerde punt" : "Klaar voor de kassa"}</small></div>
              <button className="send-button" disabled={busy || hasBlockers || draft.status === "SENT"} onClick={() => void sendDraft()}>
                {draft.status === "SENT" ? (draft.posSubmission?.adapter === "mock-pos" ? "Testorder aangemaakt" : "POS-concept verzonden") : draft.status === "ERROR" ? "Opnieuw proberen" : hasBlockers ? "Eerst controleren" : "Maak POS-concept"}
              </button>
            </div>
          )}
        </div>
      </section>

      {error && <div className="error-toast" role="alert"><strong>Controle nodig</strong><span>{error}</span><button onClick={() => setError(undefined)}>×</button></div>}

      <footer>
        <strong>Service Ears · spreken, controleren, bestellen</strong>
        <span>Audio wordt na verwerking verwijderd</span>
      </footer>
    </main>
  );
}
