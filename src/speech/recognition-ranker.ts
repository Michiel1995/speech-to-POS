import type { TenantMenu } from "@/src/domain/schemas";
import { normalizeFlemish, type DialectProfile } from "@/src/language/flemish-dialect";
import { routeUtterance } from "@/src/order-understanding/intent-router";
import { categoryHintsForSpokenText, findProductMentions, normalizeSpoken } from "@/src/semantic-menu/matcher";
import { recognizeCulinaryConcepts } from "@/src/knowledge/culinary-knowledge";

export interface SpeechHypothesis {
  text: string;
  acousticConfidence?: number;
  source?: string;
  index?: number;
}

export interface RankedSpeechHypothesis extends SpeechHypothesis {
  totalScore: number;
  acousticScore: number;
  menuScore: number;
  knowledgeScore: number;
  contextScore: number;
  languageScore: number;
  intentScore: number;
  productIds: string[];
  evidence: string[];
}

export interface SpeechHypothesisRankingOptions {
  preferredProductIds?: string[];
  existingProductIds?: string[];
  dialectProfile?: DialectProfile;
}

function cleanSpeechText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/**
 * Edge can end a recognition session just before its last interim fragment is
 * promoted to a final result. Keep that fragment only when it is a clear
 * continuation of the final text; otherwise the final result remains leading.
 */
export function completedBrowserSpeechText(finalText: string, previewText: string): string {
  const final = cleanSpeechText(finalText);
  const preview = cleanSpeechText(previewText);
  if (!final) return preview;
  if (!preview) return final;
  const normalizedFinal = normalizeSpoken(final);
  const normalizedPreview = normalizeSpoken(preview);
  return normalizedPreview === normalizedFinal || normalizedPreview.startsWith(`${normalizedFinal} `)
    ? preview
    : final;
}

export function safeBrowserSpeechFallback(
  hypotheses: SpeechHypothesis[],
  menu: TenantMenu,
  options: SpeechHypothesisRankingOptions = {},
): RankedSpeechHypothesis | undefined {
  const best = rankSpeechHypotheses(hypotheses, menu, options)[0];
  if (!best) return undefined;
  const routes = routeUtterance(best.text, {
    menu,
    dialectProfile: options.dialectProfile,
    hasOrder: Boolean(options.existingProductIds?.length),
    hasContext: Boolean(options.preferredProductIds?.length),
    contextProductIds: options.preferredProductIds,
  });
  const safeIntent = routes.some((route) =>
    !["non_order", "refusal", "unclear"].includes(route.intent) && route.confidence >= 0.5,
  );
  const hasGrounding = best.productIds.length > 0 || best.knowledgeScore >= 0.35 ||
    Boolean(options.preferredProductIds?.length) || routes.some((route) => route.intent.includes("question"));
  const hasUsefulEvidence = safeIntent && hasGrounding;
  return hasUsefulEvidence && best.totalScore >= 0.42 ? best : undefined;
}

const ARTIFACT_PATTERN = /\[(?:blank_audio|music|applause|laughter)\]|(\b\w+\b)(?:\s+\1){3,}/i;
const HOSPITALITY_WORDS = /\b(?:neem|wil|graag|geef|doe|breng|bestel|erbij|menu|kaart|bier|wijn|water|koffie|voorgerecht|hoofdgerecht|dessert|rekening|hebben|welke|wat|hoeveel|sans|avec|pour|please|have)\b/;

function clamp(value: number, minimum = 0, maximum = 1): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function languagePlausibility(text: string): number {
  const normalized = normalizeSpoken(text);
  if (!normalized) return 0;
  const tokens = normalized.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  const artifacts = tokens.filter((token) => /^\d{5,}$/.test(token) || /(.)\1{4,}/.test(token)).length;
  const hospitality = HOSPITALITY_WORDS.test(normalized) ? 0.18 : 0;
  const lengthPlausibility = tokens.length <= 80 ? 0.72 : Math.max(0.2, 0.72 - (tokens.length - 80) / 100);
  return clamp(lengthPlausibility + hospitality - artifacts * 0.18 - (ARTIFACT_PATTERN.test(text) ? 0.3 : 0));
}

export function rankSpeechHypotheses(
  hypotheses: SpeechHypothesis[],
  menu: TenantMenu,
  options: SpeechHypothesisRankingOptions = {},
): RankedSpeechHypothesis[] {
  const preferred = new Set(options.preferredProductIds ?? []);
  const existing = new Set(options.existingProductIds ?? []);
  const unique = new Map<string, SpeechHypothesis>();
  for (const hypothesis of hypotheses) {
    const text = hypothesis.text.replace(/\s+/g, " ").trim();
    if (!text) continue;
    const key = normalizeFlemish(text, options.dialectProfile ?? "auto");
    const current = unique.get(key);
    if (!current || (hypothesis.acousticConfidence ?? 0) > (current.acousticConfidence ?? 0)) {
      unique.set(key, { ...hypothesis, text });
    }
  }

  return [...unique.values()].map((hypothesis, fallbackIndex): RankedSpeechHypothesis => {
    const mentions = findProductMentions(hypothesis.text, menu, {
      preferredProductIds: [...preferred],
      existingProductIds: [...existing],
      categoryHints: categoryHintsForSpokenText(hypothesis.text),
    });
    const productIds = [...new Set(mentions.flatMap((mention) => mention.candidates.map((product) => product.id)))];
    const culinaryMentions = recognizeCulinaryConcepts(hypothesis.text);
    const acousticScore = clamp(Number.isFinite(hypothesis.acousticConfidence) ? hypothesis.acousticConfidence! : 0.5);
    const productCoverage = clamp(mentions.reduce((sum, mention) => sum + mention.confidence * Math.min(1, (mention.end - mention.start) / 8), 0) / 2);
    const certainty = mentions.length ? mentions.reduce((sum, mention) => sum + Math.min(1, mention.margin * 5), 0) / mentions.length : 0;
    const menuScore = clamp(productCoverage * 0.78 + certainty * 0.22);
    const knowledgeScore = clamp(culinaryMentions.reduce((sum, mention) => sum + mention.confidence, 0) / 1.5);
    const contextHits = productIds.filter((productId) => preferred.has(productId)).length;
    const existingHits = productIds.filter((productId) => existing.has(productId)).length;
    const contextScore = clamp(contextHits * 0.5 + existingHits * 0.2);
    const routes = routeUtterance(hypothesis.text, {
      menu,
      dialectProfile: options.dialectProfile,
      hasOrder: existing.size > 0,
      hasContext: preferred.size > 0,
      contextProductIds: [...preferred],
    });
    const intentScore = routes.length
      ? routes.reduce((sum, route) => sum + route.confidence, 0) / routes.length
      : 0;
    const languageScore = languagePlausibility(hypothesis.text);
    const artifactPenalty = ARTIFACT_PATTERN.test(hypothesis.text) ? 0.35 : 0;
    const totalScore = clamp(
      acousticScore * 0.5 +
      menuScore * 0.16 +
      knowledgeScore * 0.12 +
      contextScore * 0.1 +
      intentScore * 0.07 +
      languageScore * 0.05 -
      artifactPenalty,
    );
    const evidence = [
      mentions.length ? `${mentions.length}-menu-match` : "",
      culinaryMentions.length ? `${culinaryMentions.length}-culinary-knowledge-match` : "",
      contextHits ? `${contextHits}-context-match` : "",
      existingHits ? `${existingHits}-order-match` : "",
      routes.some((route) => route.intent.includes("question")) ? "question-shape" : "",
      ARTIFACT_PATTERN.test(hypothesis.text) ? "decoder-artifact" : "",
    ].filter(Boolean);
    return {
      ...hypothesis,
      index: hypothesis.index ?? fallbackIndex,
      totalScore: Number(totalScore.toFixed(4)),
      acousticScore: Number(acousticScore.toFixed(4)),
      menuScore: Number(menuScore.toFixed(4)),
      knowledgeScore: Number(knowledgeScore.toFixed(4)),
      contextScore: Number(contextScore.toFixed(4)),
      languageScore: Number(languageScore.toFixed(4)),
      intentScore: Number(intentScore.toFixed(4)),
      productIds,
      evidence,
    };
  }).sort((left, right) => right.totalScore - left.totalScore || (left.index ?? 0) - (right.index ?? 0));
}

export function speechHypothesisMargin(ranked: RankedSpeechHypothesis[]): number {
  if (!ranked.length) return 0;
  if (ranked.length === 1) return ranked[0].totalScore;
  return Number((ranked[0].totalScore - ranked[1].totalScore).toFixed(4));
}
