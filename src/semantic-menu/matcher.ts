import type {
  MenuProduct,
  ModifierGroup,
  ModifierOption,
  TenantMenu,
} from "@/src/domain/schemas";
import { normalizeFlemish } from "@/src/language/flemish-dialect";
import { minimumSimilarityForAlias, phoneticKey, spokenSimilarity } from "@/src/language/phonetics";
import { isOrderableProduct, productSourceAliases, semanticProductAliases } from "@/src/semantic-menu/product-index";

export function normalizeSpoken(value: string): string {
  return normalizeFlemish(value, "auto");
}

export function categoryHintsForSpokenText(value: string): string[] {
  const normalized = normalizeSpoken(value);
  return [
    [/\b(?:bier|bieren|pint|pintje|pils|beer|biere)\b/, ["beer"]],
    [/\b(?:wijn|wijnen|wine|vin|vins)\b/, ["wine"]],
    [/\b(?:frisdrank|frisdranken|cola|limonade|soft drink)\b/, ["soft drinks"]],
    [/\b(?:cocktail|cocktails|aperitief)\b/, ["cocktails"]],
    [/\b(?:voorgerecht|voorgerechten|starter|starters|entree)\b/, ["starters"]],
    [/\b(?:hoofdgerecht|hoofdgerechten|main|mains)\b/, ["mains"]],
    [/\b(?:bijgerecht|bijgerechten|side|sides)\b/, ["sides"]],
    [/\b(?:dessert|desserts|nagerecht|nagerechten)\b/, ["desserts"]],
    [/\b(?:koffie|thee|warme drank|coffee|cafe)\b/, ["hot drinks"]],
  ].flatMap(([pattern, hints]) => (pattern as RegExp).test(normalized) ? hints as string[] : []);
}

function fuzzyAliasConfidence(spoken: string, sourceAlias: string): number {
  const candidate = normalizeSpoken(spoken);
  const alias = normalizeSpoken(sourceAlias);
  if (!candidate || !alias) return 0;
  const similarity = spokenSimilarity(candidate, alias);
  return similarity.score >= minimumSimilarityForAlias(alias) ? similarity.score : 0;
}

interface RawMatch<T> {
  start: number;
  end: number;
  alias: string;
  value: T;
  confidence: number;
  sourceAlias?: string;
  expandedExact?: boolean;
}

export interface ProductCandidateScore {
  product: MenuProduct;
  score: number;
  acousticScore: number;
  contextBonus: number;
  categoryBonus: number;
  existingOrderBonus: number;
  matchedAlias: string;
  evidence: string[];
}

export interface ProductMatchingOptions {
  preferredProductIds?: string[];
  existingProductIds?: string[];
  categoryHints?: string[];
  maxCandidates?: number;
}

export interface ProductMention {
  start: number;
  end: number;
  alias: string;
  candidates: MenuProduct[];
  candidateScores: ProductCandidateScore[];
  confidence: number;
  margin: number;
  requiresConfirmation: boolean;
}

export interface ModifierMention {
  start: number;
  end: number;
  alias: string;
  group: ModifierGroup;
  option: ModifierOption;
}

function isBoundary(text: string, index: number): boolean {
  if (index < 0 || index >= text.length) return true;
  return /\s|[.']/u.test(text[index]);
}

function collectMatches<T>(text: string, entries: Array<{ aliases: string[]; value: T }>): RawMatch<T>[] {
  const normalized = normalizeSpoken(text);
  const matches: RawMatch<T>[] = [];

  for (const entry of entries) {
    for (const sourceAlias of entry.aliases) {
      const alias = normalizeSpoken(sourceAlias);
      let fromIndex = 0;
      while (alias && fromIndex < normalized.length) {
        const start = normalized.indexOf(alias, fromIndex);
        if (start === -1) break;
        const end = start + alias.length;
        if (isBoundary(normalized, start - 1) && isBoundary(normalized, end)) {
          matches.push({ start, end, alias, value: entry.value, confidence: 1 });
        }
        fromIndex = start + 1;
      }
    }
  }

  return matches;
}

function collectFuzzyProductMatches(
  text: string,
  menu: TenantMenu,
  options: ProductMatchingOptions = {},
  protectedSpans: Array<RawMatch<MenuProduct>> = [],
): RawMatch<MenuProduct>[] {
  const normalized = normalizeSpoken(text);
  const tokens = [...normalized.matchAll(/[a-z0-9]+(?:[.'][a-z0-9]+)*/g)].map((match) => ({
    value: match[0],
    start: match.index,
    end: match.index + match[0].length,
  }));
  const matches: RawMatch<MenuProduct>[] = [];
  const maximumWindow = Math.min(6, tokens.length);
  for (let windowSize = 1; windowSize <= maximumWindow; windowSize += 1) {
    for (let index = 0; index + windowSize <= tokens.length; index += 1) {
      const window = tokens.slice(index, index + windowSize);
      const windowStart = window[0].start;
      const windowEnd = window.at(-1)!.end;
      const overlapping = protectedSpans.filter((span) => windowStart < span.end && windowEnd > span.start);
      const containsExact = overlapping.filter((span) => windowStart <= span.start && windowEnd >= span.end);
      if (overlapping.length > 0 && containsExact.length === 0) continue;
      const candidate = window.map((token) => token.value).join(" ");
      if (/^(?:geen|zonder|niet|haal|laat|annuleer|schrap|nog|ook|extra|doe|geef|neem|bestel|voeg|zet|breng|voor|graag)\b|\b(?:en|of|maar|weg|zitten|vallen|graag|erbij)$/.test(candidate)) continue;
      if (/^(?:(?:ja|yes|oui|ok|okay|please|graag|volontiers|celle|celui|ca|that|this|one|die|dat|deze|maar)\s*)+$/.test(candidate)) continue;
      const rankings = rankProductCandidatesForPhrase(candidate, menu, options);
      for (const ranking of rankings) {
        if (normalizeSpoken(ranking.matchedAlias) === candidate) continue;
        const matchingContainedExact = containsExact.find((span) => span.value.id === ranking.product.id);
        if (overlapping.length > 0 && !matchingContainedExact) continue;
        const addedText = matchingContainedExact
          ? normalizeSpoken(`${normalized.slice(windowStart, matchingContainedExact.start)} ${normalized.slice(matchingContainedExact.end, windowEnd)}`)
          : "";
        if (addedText && /\b(?:\d+|de|het|een|eentje|twee|drie|vier|vijf|zes|zeven|acht|negen|tien|one|two|three|four|five|un|une|deux|trois|quatre|cinq|le|la|the|is|was|zijn|heeft|hebben|en|of|and|et|nog|ook|extra|met|with|avec|zonder|sans|voor|pour|doe|geef|neem|bestel|voeg|zet|breng|graag)\b/.test(addedText)) continue;
        matches.push({
          start: windowStart,
          end: windowEnd,
          alias: candidate,
          sourceAlias: ranking.matchedAlias,
          value: ranking.product,
          confidence: ranking.score,
          expandedExact: Boolean(matchingContainedExact),
        });
      }
    }
  }
  return matches;
}

export function findProductMentions(
  text: string,
  menu: TenantMenu,
  options: ProductMatchingOptions = {},
): ProductMention[] {
  const exact = collectMatches(
    text,
    menu.products
      .filter(isOrderableProduct)
      .map((product) => ({
        aliases: semanticProductAliases(product),
        value: product,
      })),
  );
  const fuzzy = collectFuzzyProductMatches(text, menu, options, exact).filter(
    (candidate) => !exact.some((match) => candidate.start >= match.start && candidate.end <= match.end),
  );
  const raw = [...exact, ...fuzzy].sort(
    (a, b) => Number(Boolean(b.expandedExact)) - Number(Boolean(a.expandedExact)) ||
      b.confidence - a.confidence ||
      (b.end - b.start) - (a.end - a.start) ||
      a.start - b.start,
  );

  const selectedSpans: Array<{ start: number; end: number; alias: string }> = [];
  for (const match of raw) {
    const overlapsLonger = selectedSpans.some(
      (span) =>
        match.start < span.end &&
        match.end > span.start &&
        (match.start !== span.start || match.end !== span.end),
    );
    if (!overlapsLonger) {
      selectedSpans.push({ start: match.start, end: match.end, alias: match.alias });
    }
  }

  const uniqueSpans = new Map<string, ProductMention>();
  for (const span of selectedSpans) {
    const key = `${span.start}:${span.end}`;
    if (uniqueSpans.has(key)) continue;
    const sameSpan = raw.filter((match) => match.start === span.start && match.end === span.end);
    const scoreByProduct = new Map<string, ProductCandidateScore>();
    for (const match of sameSpan) {
      const ranked = rankProductCandidatesForPhrase(match.alias, menu, options)
        .find((candidate) => candidate.product.id === match.value.id);
      const score = ranked ?? {
        product: match.value,
        score: match.confidence,
        acousticScore: match.confidence,
        contextBonus: 0,
        categoryBonus: 0,
        existingOrderBonus: 0,
        matchedAlias: match.sourceAlias ?? match.alias,
        evidence: match.confidence === 1 ? ["exact-alias"] : ["phonetic-alias"],
      };
      const existing = scoreByProduct.get(match.value.id);
      if (!existing || score.score > existing.score) scoreByProduct.set(match.value.id, score);
    }
    const allScores = [...scoreByProduct.values()].sort((left, right) => right.score - left.score || left.product.id.localeCompare(right.product.id));
    const bestScore = allScores[0]?.score ?? 0;
    const candidateScores = allScores.filter((candidate, index) => index === 0 || candidate.score >= bestScore - 0.055).slice(0, options.maxCandidates ?? 5);
    const candidates = candidateScores.map((candidate) => candidate.product);
    const margin = candidateScores.length > 1 ? bestScore - candidateScores[1].score : bestScore;
    uniqueSpans.set(key, {
      ...span,
      candidates,
      candidateScores,
      confidence: bestScore,
      margin: Number(margin.toFixed(4)),
      requiresConfirmation: !candidateScores[0]?.evidence.includes("exact-alias") ||
        (candidateScores[0]?.acousticScore ?? bestScore) < 0.9 ||
        candidateScores.length > 1 ||
        margin < 0.08,
    });
  }

  return [...uniqueSpans.values()].sort((a, b) => a.start - b.start).slice(0, 20);
}

export function findModifierMentions(text: string, groups: ModifierGroup[]): ModifierMention[] {
  const entries = groups.flatMap((group) =>
    group.options.map((option) => ({
      aliases: [option.canonicalName, option.posName, ...option.aliases],
      value: { group, option },
    })),
  );

  const raw = collectMatches(text, entries).sort(
    (a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start,
  );
  const selected: ModifierMention[] = [];
  for (const match of raw) {
    if (
      selected.some(
        (existing) =>
          match.start >= existing.start &&
          match.end <= existing.end &&
          (match.start !== existing.start || match.end !== existing.end),
      )
    ) {
      continue;
    }
    if (
      selected.some(
        (existing) =>
          existing.start === match.start &&
          existing.end === match.end &&
          existing.option.id === match.value.option.id,
      )
    ) {
      continue;
    }
    selected.push({ ...match, ...match.value });
  }
  return selected.sort((a, b) => a.start - b.start);
}

export function productCandidatesForPhrase(phrase: string, menu: TenantMenu): MenuProduct[] {
  const normalized = normalizeSpoken(phrase);
  const exact = menu.products.filter(
    (product) =>
      isOrderableProduct(product) &&
      semanticProductAliases(product).some(
        (alias) => normalizeSpoken(alias) === normalized,
      ),
  );
  if (exact.length) return exact.slice(0, 5);

  const partial = menu.products
    .filter(isOrderableProduct)
    .map((product) => ({
      product,
      score: semanticProductAliases(product).reduce(
        (best, alias) => {
          const candidate = normalizeSpoken(alias);
          const score = candidate.includes(normalized) || normalized.includes(candidate) ? candidate.length : 0;
          return Math.max(best, score);
        },
        0,
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .map(({ product }) => product);
  if (partial.length) return partial.slice(0, 5);

  const fuzzy = menu.products
    .filter(isOrderableProduct)
    .map((product) => ({
      product,
      score: Math.max(
        ...semanticProductAliases(product)
          .map((alias) => fuzzyAliasConfidence(normalized, alias)),
      ),
    }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);
  const bestScore = fuzzy[0]?.score ?? 0;
  return fuzzy.filter(({ score }) => score >= bestScore - 0.02).map(({ product }) => product).slice(0, 5);
}

export function rankProductCandidatesForPhrase(
  phrase: string,
  menu: TenantMenu,
  options: ProductMatchingOptions = {},
): ProductCandidateScore[] {
  const preferred = new Set(options.preferredProductIds ?? []);
  const existing = new Set(options.existingProductIds ?? []);
  const categoryHints = new Set((options.categoryHints ?? []).map(normalizeSpoken));
  const normalizedPhrase = normalizeSpoken(phrase);
  const compactPhraseLength = normalizedPhrase.replace(/\s/g, "").length;
  const phraseWordCount = normalizedPhrase.split(/\s+/).filter(Boolean).length;
  const phrasePhoneticKey = phoneticKey(normalizedPhrase);

  return menu.products
    .filter(isOrderableProduct)
    .flatMap((product): ProductCandidateScore[] => {
      const aliases = productSourceAliases(product).filter((alias) => {
        const normalizedAlias = normalizeSpoken(alias);
        const compactAliasLength = normalizedAlias.replace(/\s/g, "").length;
        const aliasWordCount = normalizedAlias.split(/\s+/).filter(Boolean).length;
        const aliasPhoneticKey = phoneticKey(normalizedAlias);
        const lengthTolerance = Math.max(3, Math.ceil(Math.max(compactPhraseLength, compactAliasLength) * 0.34));
        return Math.abs(compactPhraseLength - compactAliasLength) <= lengthTolerance &&
          Math.abs(phraseWordCount - aliasWordCount) <= 1 &&
          (compactPhraseLength <= 3 || aliasPhoneticKey[0] === phrasePhoneticKey[0]);
      });
      const similarities = aliases.map((alias) => ({ alias, similarity: spokenSimilarity(normalizedPhrase, alias) }))
        .sort((left, right) => right.similarity.score - left.similarity.score);
      const best = similarities[0];
      if (!best || best.similarity.score < minimumSimilarityForAlias(best.alias)) return [];
      const contextBonus = preferred.has(product.id) ? 0.055 : 0;
      const existingOrderBonus = existing.has(product.id) ? 0.025 : 0;
      const normalizedCategory = normalizeSpoken(`${product.category} ${product.productType ?? ""}`);
      const categoryBonus = [...categoryHints].some((hint) => hint && normalizedCategory.includes(hint)) ? 0.035 : 0;
      const score = Math.min(1, best.similarity.score + contextBonus + existingOrderBonus + categoryBonus);
      return [{
        product,
        score: Number(score.toFixed(4)),
        acousticScore: best.similarity.score,
        contextBonus,
        categoryBonus,
        existingOrderBonus,
        matchedAlias: best.alias,
        evidence: [
          best.similarity.exact ? "exact-alias" : "phonetic-alias",
          contextBonus ? "table-context" : "",
          existingOrderBonus ? "existing-order" : "",
          categoryBonus ? "category-context" : "",
        ].filter(Boolean),
      }];
    })
    .sort((left, right) => right.score - left.score || right.acousticScore - left.acousticScore || left.product.id.localeCompare(right.product.id))
    .slice(0, options.maxCandidates ?? 5);
}

export function speechTranscriptMenuScore(
  text: string,
  menu: TenantMenu,
  preferredProductIds: string[] = [],
): number {
  const normalized = normalizeSpoken(text);
  const preferred = new Set(preferredProductIds);
  const categoryScore = [
    /\b(bier|bieren|beer|beers|biere|bieres)\b/,
    /\b(wijn|wijnen|wine|wines|vin|vins)\b/,
    /\b(frisdrank|frisdranken|soft drink|soft drinks)\b/,
    /\b(voorgerecht|voorgerechten|starter|starters)\b/,
    /\b(hoofdgerecht|hoofdgerechten|main|mains)\b/,
    /\b(dessert|desserts|nagerecht|nagerechten)\b/,
  ].reduce((score, pattern) => score + (pattern.test(normalized) ? 4 : 0), 0);
  const questionScore = /^(?:wat|welke|heb je|hebben jullie|is er|zijn er|hoeveel|hoe duur|what|which|do you|avez vous|combien)\b/.test(normalized) ? 2 : 0;
  const contextualSelectionScore = preferred.size > 0 &&
    /\b(?:doe maar|geef maar|neem maar|pak maar|die maar|dat maar|die graag|dat graag|ja graag|yes please|that one|this one|je prends|celui la|celle la|oui volontiers|eerste|tweede|derde|laatste)\b/.test(normalized)
    ? preferred.size === 1 ? 9 : 4
    : 0;
  const artifactPenalty = /(\b\w+\b)(?:\s+\1){3,}/.test(normalized) ? 8 : 0;
  return Math.max(0, categoryScore + questionScore + contextualSelectionScore + findProductMentions(text, menu).reduce(
    (score, mention) => score +
      (mention.end - mention.start) * mention.confidence +
      (mention.candidates.some((product) => preferred.has(product.id)) ? 8 : 0) +
      Math.min(2, mention.margin * 4) -
      (mention.candidates.length > 1 ? 1.5 : 0),
    0,
  ) - artifactPenalty);
}
