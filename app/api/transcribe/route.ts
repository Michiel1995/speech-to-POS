import { NextResponse } from "next/server";

import { DomainError } from "@/src/domain/errors";
import { apiError } from "@/src/http/api-error";
import { getPOSAdapter } from "@/src/pos/registry";
import { speechTranscriptMenuScore } from "@/src/semantic-menu/matcher";
import { isOrderableProduct } from "@/src/semantic-menu/product-index";
import { buildSpeechVocabulary } from "@/src/speech/menu-vocabulary";
import {
  confidentBrowserSpeechFallback,
  rankSpeechHypotheses,
  safeBrowserSpeechFallback,
  speechHypothesisMargin,
  type SpeechHypothesis,
} from "@/src/speech/recognition-ranker";
import {
  transcribeHospitalityAudioOffline,
  type OfflineTranscriptionResult,
  type SpeechLanguage,
} from "@/src/speech/offline-transcriber";
import { FINAL_TRANSCRIPTION_BUDGET_MS } from "@/src/speech/latency-budget";

export const runtime = "nodejs";

function productIds(value: FormDataEntryValue | null): string[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) return parsed.filter((item): item is string => typeof item === "string").slice(0, 50);
  } catch {
    // Accept comma-separated IDs from simple clients as well.
  }
  return value.split(",").map((item) => item.trim()).filter(Boolean).slice(0, 50);
}

function approvedAliases(value: FormDataEntryValue | null): Array<{ spokenFragment: string; productId: string }> {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((item): item is { spokenFragment: string; productId: string } => Boolean(
      item && typeof item === "object" && "spokenFragment" in item && "productId" in item &&
      typeof item.spokenFragment === "string" && typeof item.productId === "string",
    )).slice(0, 200);
  } catch {
    return [];
  }
}

function finiteNumber(value: FormDataEntryValue | null): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function browserHypotheses(value: FormDataEntryValue | null): SpeechHypothesis[] {
  if (typeof value !== "string" || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item, index): SpeechHypothesis[] => {
      if (!item || typeof item !== "object" || !("text" in item) || typeof item.text !== "string") return [];
      const confidence = "confidence" in item && typeof item.confidence === "number" ? item.confidence : 0.72;
      return [{ text: item.text.slice(0, 4_000), acousticConfidence: confidence, source: "edge-live-preview", index: 100 + index }];
    }).slice(0, 5);
  } catch {
    return [];
  }
}

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const operationId = typeof data.get("operationId") === "string" ? String(data.get("operationId")).slice(0, 100) : undefined;
    const tableId = typeof data.get("tableId") === "string" ? String(data.get("tableId")).slice(0, 100) : undefined;
    const baseDraftRevision = typeof data.get("baseDraftRevision") === "string" ? String(data.get("baseDraftRevision")).slice(0, 2_000) : undefined;
    const audio = data.get("audio");
    if (!(audio instanceof File)) {
      throw new DomainError("A microphone recording is required.", "AUDIO_REQUIRED");
    }
    const requestedLanguage = data.get("language");
    const supportedLanguages: SpeechLanguage[] = ["nl", "fr", "en", "auto"];
    const language: SpeechLanguage = typeof requestedLanguage === "string" && supportedLanguages.includes(requestedLanguage as SpeechLanguage)
      ? requestedLanguage as SpeechLanguage
      : "nl";
    const menu = await getPOSAdapter().getMenu();
    const activeProductIds = new Set(menu.products.filter(isOrderableProduct).map((product) => product.id));
    const contextProductIds = productIds(data.get("contextProductIds")).filter((productId) => activeProductIds.has(productId));
    const priorProductIds = productIds(data.get("priorProductIds")).filter((productId) => activeProductIds.has(productId));
    const dialectProfileValue = data.get("dialectProfile");
    const dialectProfile = typeof dialectProfileValue === "string" && ["auto", "standard", "west_flemish", "east_flemish", "antwerp", "brabant", "limburg"].includes(dialectProfileValue)
      ? dialectProfileValue as "auto" | "standard" | "west_flemish" | "east_flemish" | "antwerp" | "brabant" | "limburg"
      : "auto";
    const vocabulary = buildSpeechVocabulary(menu, {
      contextProductIds,
      priorProductIds,
      dialectProfile,
      approvedAliases: approvedAliases(data.get("approvedAliases")),
    });
    const browserCandidates = browserHypotheses(data.get("browserHypotheses"));
    const browserPreviewFinal = data.get("browserPreviewFinal") === "true";
    const rankingOptions = {
      preferredProductIds: vocabulary.preferredProductIds,
      existingProductIds: priorProductIds,
      dialectProfile,
    };
    const edgeResponse = (
      fallback: NonNullable<ReturnType<typeof safeBrowserSpeechFallback>>,
      pass: "edge-live-confident" | "edge-live-budget-fallback",
    ) => {
      const rankedFallbacks = rankSpeechHypotheses(browserCandidates, menu, rankingOptions);
      return NextResponse.json({
        operationId,
        tableId,
        baseDraftRevision,
        text: fallback.text,
        turns: [{ speaker: "unknown" as const, providerSpeaker: pass, text: fallback.text }],
        language,
        engine: pass,
        confidence: fallback.acousticScore,
        vadUsed: false,
        vadProfile: "balanced",
        secondPassAttempted: false,
        secondPassSelected: false,
        hypothesisMargin: speechHypothesisMargin(rankedFallbacks),
        hypotheses: rankedFallbacks.slice(0, 5).map((candidate, index) => ({
          text: candidate.text,
          confidence: candidate.acousticScore,
          menuScore: candidate.menuScore,
          totalScore: candidate.totalScore,
          pass,
          selected: index === 0,
        })),
        crossEngine: {
          attempted: true,
          selected: "edge-live-preview",
          margin: speechHypothesisMargin(rankedFallbacks),
          fallbackUsed: pass === "edge-live-budget-fallback",
          localPassSkipped: pass === "edge-live-confident",
        },
        retained: false,
      });
    };
    const confidentBrowser = browserPreviewFinal
      ? confidentBrowserSpeechFallback(browserCandidates, menu, rankingOptions)
      : undefined;
    if (confidentBrowser) return edgeResponse(confidentBrowser, "edge-live-confident");
    let result: OfflineTranscriptionResult;
    try {
      result = await transcribeHospitalityAudioOffline(audio, {
        language,
        primaryPrompt: vocabulary.primaryPrompt,
        retryPrompt: vocabulary.retryPrompt,
        scoreTranscript: (text) => speechTranscriptMenuScore(text, menu, vocabulary.preferredProductIds),
        audioProfile: {
          rms: finiteNumber(data.get("audioRms")),
          silenceRatio: finiteNumber(data.get("audioSilenceRatio")),
          clippingRatio: finiteNumber(data.get("audioClippingRatio")),
          noiseFloorRms: finiteNumber(data.get("audioNoiseFloorRms")),
        },
        preferLowLatency: contextProductIds.length === 1 && audio.size <= 800_000,
        maxPassMs: FINAL_TRANSCRIPTION_BUDGET_MS,
      });
    } catch (error) {
      // Keep a useful menu/context-grounded live hypothesis when the local
      // pass misses its hard latency budget. The deterministic order engine
      // still requires confirmation for fuzzy matches and rejects ungrounded
      // speech, so Review gains a candidate without inventing a POS product.
      const fallback = safeBrowserSpeechFallback(browserCandidates, menu, rankingOptions);
      if (!fallback) throw error;
      return edgeResponse(fallback, "edge-live-budget-fallback");
    }
    if (!browserCandidates.length) return NextResponse.json({ operationId, tableId, baseDraftRevision, ...result });
    const ranked = rankSpeechHypotheses([
      ...result.hypotheses.map((hypothesis, index) => ({
        text: hypothesis.text,
        acousticConfidence: hypothesis.confidence,
        source: "local-whisper",
        index,
      })),
      ...browserCandidates,
    ], menu, rankingOptions);
    const best = ranked[0];
    const bestLocal = ranked.find((hypothesis) => hypothesis.source === "local-whisper");
    const useBrowserAssist = Boolean(
      best?.source === "edge-live-preview" &&
      bestLocal &&
      result.confidence < 0.82 &&
      best.totalScore >= bestLocal.totalScore + 0.015,
    );
    return NextResponse.json({
      operationId,
      tableId,
      baseDraftRevision,
      ...result,
      ...(useBrowserAssist && best ? {
        text: best.text,
        turns: [{ speaker: "unknown" as const, providerSpeaker: "edge-live-preview", text: best.text }],
        engine: "hybrid-local-edge",
        confidence: best.acousticScore,
      } : {}),
      crossEngine: {
        attempted: true,
        selected: useBrowserAssist ? "edge-live-preview" : "local-whisper",
        margin: speechHypothesisMargin(ranked),
        candidates: ranked.slice(0, 5).map((candidate) => ({
          text: candidate.text,
          source: candidate.source,
          confidence: candidate.acousticScore,
          score: candidate.totalScore,
        })),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
