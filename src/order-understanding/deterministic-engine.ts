import { randomUUID } from "node:crypto";

import type {
  ConversationTurn,
  DraftIssue,
  DraftLine,
  DraftOrder,
  DraftWarning,
  InterpretRequest,
  MenuProduct,
  SelectedModifier,
  TenantMenu,
} from "@/src/domain/schemas";
import {
  categoryHintsForSpokenText,
  findModifierMentions,
  findProductMentions,
  normalizeSpoken,
  productCandidatesForPhrase,
  type ModifierMention,
} from "@/src/semantic-menu/matcher";
import { productsForMenuQuestion } from "@/src/order-understanding/menu-question";
import { normalizeFlemish } from "@/src/language/flemish-dialect";
import { culinaryAdviceForText } from "@/src/knowledge/culinary-knowledge";
import { finalDecisionClause, isUndecidedDeliberation, routeIntent } from "@/src/order-understanding/intent-router";
import { isOrderableProduct, semanticProductAliases } from "@/src/semantic-menu/product-index";

const NUMBER_WORDS: Record<string, number> = {
  een: 1,
  eentje: 1,
  one: 1,
  un: 1,
  une: 1,
  twee: 2,
  two: 2,
  deux: 2,
  beide: 2,
  allebei: 2,
  drie: 3,
  three: 3,
  trois: 3,
  vier: 4,
  four: 4,
  quatre: 4,
  vijf: 5,
  five: 5,
  cinq: 5,
  zes: 6,
  six: 6,
  sept: 7,
  zeven: 7,
  huit: 8,
  acht: 8,
  negen: 9,
  neuf: 9,
  tien: 10,
  ten: 10,
  dix: 10,
  elf: 11,
  eleven: 11,
  onze: 11,
  twaalf: 12,
  twelve: 12,
  douze: 12,
  dozijn: 12,
  dertien: 13,
  thirteen: 13,
  treize: 13,
  veertien: 14,
  fourteen: 14,
  quatorze: 14,
  vijftien: 15,
  fifteen: 15,
  quinze: 15,
  zestien: 16,
  sixteen: 16,
  seize: 16,
  zeventien: 17,
  seventeen: 17,
  dixsept: 17,
  achttien: 18,
  eighteen: 18,
  dixhuit: 18,
  negentien: 19,
  nineteen: 19,
  dixneuf: 19,
  twintig: 20,
  twenty: 20,
  vingt: 20,
};

function parseNumberToken(token: string | undefined): number | undefined {
  if (!token) return undefined;
  const normalized = token.replace(/[^a-z0-9]/g, "");
  if (/^\d+$/.test(normalized)) {
    const quantity = Number(normalized);
    return quantity > 0 && quantity <= 100 ? quantity : undefined;
  }
  return NUMBER_WORDS[normalized];
}

function quantityNearMention(text: string, start: number, end: number, correction: boolean): number {
  const normalized = normalizeSpoken(text);
  if (/voor ons allebei|for both of us|pour nous deux/.test(normalized)) return 2;
  const groupMatch = normalized.match(/voor ons (\d{1,2})en\b/);
  if (groupMatch) return Math.max(1, Math.min(100, Number(groupMatch[1])));

  if (correction) {
    const prefix = normalized.slice(Math.max(0, start - 40), start);
    const immediateAfter = normalized.slice(end).trim().split(/\s+/)[0];
    const replacementQuantity = parseNumberToken(immediateAfter);
    if (/\bmaak\b/.test(prefix) && replacementQuantity) return replacementQuantity;
  }

  const before = normalized.slice(Math.max(0, start - 28), start).trim().split(/\s+/).slice(-4).reverse();
  for (const token of before) {
    const parsed = parseNumberToken(token);
    if (parsed) return parsed;
  }
  return 1;
}

function isQuestion(text: string): boolean {
  const normalized = normalizeSpoken(text);
  if (/\b(wil weten|willen weten|kan je zeggen|kun je zeggen|zeg eens welke|i want to know|je veux savoir)\b/.test(normalized)) {
    return true;
  }
  const orderCue = /\b(neem|nemen|wil|wilt|doe dan|doe maar|bestel|voor mij|voor ons|pour moi|je prends|i'll have|i will have)\b/.test(normalized);
  const questionCue = /^(hebben|heb je|hebben jullie|welke|wat|is er|zijn er|do you have|which|what|avez vous|quels|est ce)/.test(normalized);
  return questionCue && !orderCue;
}

function isAffirmation(text: string): boolean {
  return /^(ja|yes|oui|ok|okay|graag|dat is goed|c'est bon)[.! ]*$/.test(normalizeSpoken(text));
}

function isWaiterSuggestion(text: string): boolean {
  return /\b(ik zet|zal ik|doe ik|mag ik|i'll add|shall i add|je vous mets)\b/.test(normalizeSpoken(text));
}

function isWaiterConfirmation(text: string): boolean {
  const normalized = normalizeSpoken(text);
  return /^(?:dus|als ik het goed heb|u neemt|je neemt|jullie nemen|so you|donc)|\b(?:klopt dat|is dat juist|correct)\b/.test(normalized);
}

function isCorrection(text: string): boolean {
  return /\b(nee wacht|maak daar|maak die|verander|in plaats van|non attends|no wait|change)\b/.test(normalizeSpoken(text));
}

function isCancellation(text: string): boolean {
  const normalized = normalizeSpoken(text);
  return [
    /\bgeen\b/,
    /\bhoef(?:t|ven)?\b.*\b(?:niet|geen)\b/,
    /\blaat\b.*\b(?:zitten|vallen)\b/,
    /\b(?:annuleer|schrap|verwijder|cancel|remove|supprime|annule)\b/,
    /\bhaal\b.*\b(?:weg|eraf|er uit|uit de bestelling)\b/,
    /\bdoe\b.*\b(?:toch\s+)?maar\s+niet\b/,
    /\b(?:toch|maar)\s+niet\b/,
    /\b(?:minder|niet meer)\b/,
    /\b(?:don't need|do not need|leave .* out|laisse tomber)\b/,
    /\bskip\b/,
  ].some((pattern) => pattern.test(normalized));
}

function explicitRemovalQuantity(text: string, mentionStart: number, mentionAlias: string): number | undefined {
  const normalized = normalizeSpoken(text);
  const aliasQuantity = parseNumberToken(normalizeSpoken(mentionAlias).split(/\s+/)[0]);
  if (aliasQuantity) return aliasQuantity;
  const immediateToken = normalized
    .slice(Math.max(0, mentionStart - 24), mentionStart)
    .trim()
    .split(/\s+/)
    .at(-1);
  return parseNumberToken(immediateToken);
}

function cancellationAppliesToMention(text: string, start: number, end: number, localStart: number): boolean {
  const normalized = normalizeSpoken(text);
  const localPrefix = normalized.slice(Math.max(0, localStart), start).trim();
  const spokenMention = normalized.slice(start, end).trim();
  const suffix = normalized.slice(end, Math.min(normalized.length, end + 55)).trim();
  if (/^(?:geen|zonder)\b/.test(spokenMention)) return true;
  if (/\b(?:geen|zonder)\s*$/.test(localPrefix)) return true;
  if (
    /\b(?:laat|haal|annuleer|schrap|verwijder|cancel|remove|supprime|annule)\b(?:(?!\b(?:voeg|neem|bestel)\b).)*$/.test(localPrefix)
  ) return true;
  if (
    /^(?:(?:misschien|toch|maar|er|eruit|er uit)\s+)*(?:zitten|vallen|weg|eraf|er uit|niet|niet meer|minder)\b/.test(suffix)
  ) return true;
  return /\bhoef(?:t|ven)?\b.*\b(?:niet|geen)\b/.test(`${localPrefix} ${suffix}`);
}

function isContextualOrderReference(text: string): boolean {
  const normalized = normalizeSpoken(text);
  return (
    /\b(?:geef|doe|neem|bestel|zet|wil|pak|breng)\b.*\b(?:die|dat|deze|daarvan)\b/.test(normalized) ||
    /\b(?:die|dat|deze)\b.*\b(?:neem|wil|bestel)\b/.test(normalized) ||
    /\b(?:doe maar|geef maar|neem maar|pak maar|breng maar|die maar|dat maar|deze maar|dees maar|den die|geef het maar|doe het maar|dat wordt het|dat is goed|die is goed|deze is goed|dat is prima|die is prima|dat mag|die mag|deze mag|ik ga daarvoor|ik kies die|ik kies dat|laat maar komen|voor mij ook|zelfde voor mij|eentje daarvan|iets daarvan|klinkt goed|klinkt lekker|klinkt prima|lijkt goed|lijkt lekker|ziet er goed uit)\b/.test(normalized) ||
    /\b(?:ik|wij|we)\b.*\b(?:die|dat|deze|daarvoor)\b.*\b(?:neem|nemen|pak|pakken|probeer|proberen|kies|kiezen)\b/.test(normalized) ||
    /\b(?:ik|wij|we)\b.*\b(?:neem|nemen|pak|pakken|probeer|proberen|kies|kiezen)\b.*\b(?:die|dat|deze|daarvoor)\b/.test(normalized) ||
    /\b(?:dezelfde|hetzelfde|nog zo eentje|nog eentje|nog een keer|nog eens|de vorige nog eens)\b/.test(normalized) ||
    /\b(?:i'll take that|i will take that|i want that|that one|this one|yes please|give me that|go with that|one of those|je prends celui|je prends celle|celui la|celle la|oui volontiers|ca me va)\b/.test(normalized) ||
    /\b(?:i|we)\b.*\b(?:take|have|try|go with|choose)\b.*\b(?:that|this|it|one)\b/.test(normalized) ||
    /\b(?:je|on|nous)\b.*\b(?:prends|prendre|prenons|choisis|choisir|vais|va)\b.*\b(?:ca|cela|celui|celle|le|la)\b/.test(normalized) ||
    /\b(?:je|on|nous)\b.*\b(?:ca|cela|celui|celle|le|la)\b.*\b(?:prends|prendre|prenons|choisis|choisir)\b/.test(normalized) ||
    /^(?:ja|jazeker|zeker|ok|oke|okay|yes|oui)(?:\s+(?:graag|please|volontiers))?$/.test(normalized) ||
    /^(?:ja|ok|oke|okay)?\s*(?:die|dat|deze)(?:\s+(?:is\s+goed|maar|graag))?$/.test(normalized) ||
    /^(?:de|het|nummer)?\s*(?:eerste|tweede|derde|laatste)(?:\s+(?:graag|maar|please))?$/.test(normalized) ||
    /\b(?:eerste|tweede|derde|laatste|goedkoopste|duurste|alcoholvrije|blonde|bruine)\b.*\b(?:graag|neem|doe|geef)\b/.test(normalized)
  );
}

function isSafeSoleContextSelection(text: string): boolean {
  const normalized = normalizeSpoken(text);
  if (!normalized || normalized.split(/\s+/).length > 14) return false;
  if (/\?|\b(?:welke|wat|hoeveel|waarom|niet|geen|laat maar|twijfel|weet het niet|misschien toch niet|no|non|pas|don't|do not)\b/.test(normalized)) return false;
  return isContextualOrderReference(normalized) ||
    /\b(?:ja|jazeker|zeker|akkoord|graag|neem|nemen|doe|geef|pak|pakken|breng|kies|proberen|please|yes|okay|oke|ok|take|have|oui|volontiers|prends|prendre|donnez)\b/.test(normalized);
}

function contextualQuantity(text: string): number {
  for (const token of normalizeSpoken(text).split(/\s+/)) {
    const quantity = parseNumberToken(token);
    if (quantity) return quantity;
  }
  return 1;
}

function contextualProductCandidates(text: string, products: MenuProduct[]): MenuProduct[] {
  if (products.length <= 1) return products;
  const normalized = normalizeSpoken(text);
  if (/\b(?:eerste|nummer een)\b/.test(normalized)) return products.slice(0, 1);
  if (/\b(?:tweede|nummer twee)\b/.test(normalized)) return products.slice(1, 2);
  if (/\b(?:derde|nummer drie)\b/.test(normalized)) return products.slice(2, 3);
  if (/\blaatste\b/.test(normalized)) return products.slice(-1);
  if (/\bgoedkoopste\b/.test(normalized)) {
    const lowestPrice = Math.min(...products.map((product) => product.priceCents));
    return products.filter((product) => product.priceCents === lowestPrice);
  }
  if (/\bduurste\b/.test(normalized)) {
    const highestPrice = Math.max(...products.map((product) => product.priceCents));
    return products.filter((product) => product.priceCents === highestPrice);
  }
  if (/\b(?:alcoholvrij|alcoholvrije|zonder alcohol|zero|0\.0)\b/.test(normalized)) {
    const alcoholFree = products.filter((product) =>
      /alcohol free|0\.0/.test(normalizeSpoken(`${product.category} ${product.canonicalName} ${product.aliases.join(" ")}`)),
    );
    if (alcoholFree.length > 0) return alcoholFree;
  }

  const descriptorTokens = normalized
    .split(/\s+/)
    .filter((token) => token.length >= 4 && ![
      "daarvan", "deze", "graag", "geef", "neem", "bestel", "voor", "maar", "doe", "klinkt", "lijkt", "goed", "lekker",
    ].includes(token));
  const scored = products.map((product) => {
    const searchable = normalizeSpoken(
      `${product.canonicalName} ${product.posName} ${product.category} ${product.aliases.join(" ")}`,
    );
    return {
      product,
      score: descriptorTokens.filter((token) => searchable.split(/\s+/).includes(token)).length,
    };
  });
  const bestScore = Math.max(...scored.map(({ score }) => score));
  return bestScore > 0 ? scored.filter(({ score }) => score === bestScore).map(({ product }) => product) : products;
}

function conversationSegments(text: string): string[] {
  return text
    .split(/\r?\n|[!?;]+|\.(?=\s|$)|,\s*(?=(?:maar\s+)?(?:voor mij|ik neem|ik wil|doe|geef|bestel|vandaag neem))|\bmaar\b(?=\s+(?:voor mij|ik neem|ik wil|doe|geef|bestel))/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

function compoundOrderReplacementSegments(text: string): [string, string] | undefined {
  const normalized = normalizeSpoken(text);
  const marker = /\b(?:of|maar)\s+(?=in plaats van|in de plaats van|instead of|a la place de)/g;
  const matches = [...normalized.matchAll(marker)];
  const latest = matches.at(-1);
  if (!latest?.index) return undefined;
  const first = normalized.slice(0, latest.index).trim();
  const second = normalized.slice(latest.index + latest[0].length).trim();
  return first && second ? [first, second] : undefined;
}

function looksLikeOrderWithoutMatch(text: string): boolean {
  return /\b(neem|nemen|wil|doe dan|voor mij|pour moi|je prends|i'll have|bestel)\b/.test(normalizeSpoken(text));
}

function hasOrderingContext(
  text: string,
  productMentions: ReturnType<typeof findProductMentions>,
  modifierCount: number,
): boolean {
  const normalized = normalizeSpoken(text);
  if (productMentions.length === 0) return false;
  if (
    /\b(geen|nooit|wil weten|willen weten|vraag stellen|is lekker|zijn lekker|smaakt|smaken|heet|heten|ik vind|wat vind|bedoel je|we hebben|jullie hebben|zij hebben|praat over|praten over|vertel over|grap|grapje|mop|verhaal|als voorbeeld|bij wijze van|droomde|gisteren|vroeger|niet mee|niet hier)\b/.test(normalized)
  ) {
    return false;
  }
  if (
    /\b(neem|nemen|wil graag|wilt graag|bestel|voor mij|voor ons|doe er|doe dan|doe maar|voeg|toevoegen|ik zet|zet erbij|mag ik|graag|nog een|nog eentje|nog ene|ook een|extra|please|pour moi|je prends|i'll have|i will have|is voor|zijn voor)\b/.test(normalized) ||
    /\b(?:geef|breng|pak|zet|doe)\s+(?:me|mij|ons)\b/.test(normalized) ||
    /\b(?:ik|wij|we)\s+(?:neem|nemen|wil|willen|pak|pakken|kies|kiezen)\b/.test(normalized)
  ) {
    return true;
  }

  const quantityCue = /(?:\d+|een|eentje|twee|beide|allebei|drie|vier|vijf|zes|zeven|acht|negen|tien|a|an|one|two|three|four|five|un|une|deux|trois|quatre|cinq)\s*$/;
  if (productMentions.some((mention) => quantityCue.test(normalized.slice(Math.max(0, mention.start - 18), mention.start)))) {
    return true;
  }
  if (
    modifierCount > 0 &&
    (productMentions.some((mention) => mention.start <= 4) || /^(?:\d+|een|un|une|one|twee|two|deux)\b/.test(normalized))
  ) return true;

  let residue = normalized;
  for (const mention of [...productMentions].sort((left, right) => right.start - left.start)) {
    residue = `${residue.slice(0, mention.start)} ${residue.slice(mention.end)}`;
  }
  residue = normalizeSpoken(residue)
    .replace(/\b(een|eentje|twee|tweede|beide|allebei|drie|vier|vijf|zes|zeven|acht|negen|tien|a|an|one|two|three|four|five|un|une|deux|trois|quatre|cinq|en|of|and|et|extra|graag|aub|alstublieft|please)\b/g, "")
    .replace(/\d+/g, "")
    .replace(/[.']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return residue.length === 0;
}

function issueCandidate(product: MenuProduct) {
  return {
    productId: product.id,
    sku: product.sku,
    posName: product.posName,
    canonicalName: product.canonicalName,
    priceCents: product.priceCents,
  };
}

function selectedModifier(mention: ModifierMention): SelectedModifier {
  return {
    groupId: mention.group.id,
    optionId: mention.option.id,
    posName: mention.option.posName,
    canonicalName: mention.option.canonicalName,
    priceCents: mention.option.priceCents,
  };
}

function unresolvedPhrase(text: string): string {
  return normalizeSpoken(text)
    .replace(/^(nee wacht|dan|ok|okay)\s+/, "")
    .replace(/\b(voor mij|ik neem|ik wil|doe dan maar|pour moi|je prends|i'll have)\b/g, "")
    .replace(/^\s*(een|one|un|une|1)\s+/, "")
    .trim()
    .slice(0, 120);
}

interface ReplacementInstruction {
  target: string;
  replacement: string;
}

function cleanReplacementPhrase(value: string): string {
  return normalizeSpoken(value)
    .replace(/^(?:wil ik|wou ik|neem ik|pak ik|bestel ik|doe mij|geef mij|i want|i will have|i'll have|je prends|je veux|donnez moi)\s+/, "")
    .replace(/\s+(?:bestellen|nemen|pakken|graag|alsjeblieft|alstublieft|please|svp)$/, "")
    .trim();
}

function parseReplacementInstruction(value: string): ReplacementInstruction | undefined {
  const text = normalizeSpoken(value).replace(/[,.?!;:]+/g, " ").replace(/\s+/g, " ").trim();
  const connectorPatterns = [
    /^(?:vervang|verander)\s+(.+?)\s+(?:door|naar|voor)\s+(.+)$/,
    /^(?:wissel|ruil)\s+(.+?)\s+(?:voor|met)\s+(.+)$/,
    /^replace\s+(.+?)\s+with\s+(.+)$/,
    /^swap\s+(.+?)\s+(?:for|with)\s+(.+)$/,
    /^remplace(?:z)?\s+(.+?)\s+par\s+(.+)$/,
    /^(?:echange|change)\s+(.+?)\s+(?:contre|pour)\s+(.+)$/,
    /^maak\s+van\s+(.+?)\s+(.+)$/,
  ];
  for (const pattern of connectorPatterns) {
    const match = text.match(pattern);
    if (match) return { target: match[1].trim(), replacement: cleanReplacementPhrase(match[2]) };
  }

  const targetFirstWithVerb = text.match(
    /^(?:in plaats van|in de plaats van|instead of|a la place de)\s+(.+?)\s+(?:wil ik|wou ik|neem ik|pak ik|bestel ik|doe mij|geef mij|doe maar|neem maar|pak maar|geef maar|i want|i will have|i'll have|je prends|je veux|donnez moi)\s+(.+)$/,
  );
  if (targetFirstWithVerb) {
    return { target: targetFirstWithVerb[1].trim(), replacement: cleanReplacementPhrase(targetFirstWithVerb[2]) };
  }

  const courseFirst = text.match(
    /^(?:in plaats van|in de plaats van|instead of|a la place de)\s+((?:(?:het|de|een|the|le|la|l)\s+)?(?:voorgerecht(?:en)?|starter(?:s)?|entree(?:s)?|hoofdgerecht(?:en)?|main course|plat principal|dessert(?:s)?|nagerecht(?:en)?|drank(?:en)?))\s+(.+)$/,
  );
  if (courseFirst) {
    return { target: courseFirst[1].trim(), replacement: cleanReplacementPhrase(courseFirst[2]) };
  }

  const removeAndAdd = text.match(
    /^(?:doe|haal|laat)\s+(.+?)\s+(?:weg|vallen|zitten)\s+(?:en|maar)\s+(?:doe|geef|neem|breng|bestel)\s+(?:me|mij|ons)?\s*(.+)$/,
  );
  if (removeAndAdd) {
    return { target: removeAndAdd[1].trim(), replacement: cleanReplacementPhrase(removeAndAdd[2]) };
  }

  const deicticChange = text.match(/^maak\s+(?:van\s+)?(?:die|dat|daar|deze)\s+(.+?)\s+van$/);
  if (deicticChange) return { target: "daar", replacement: cleanReplacementPhrase(deicticChange[1]) };

  const noLongerWanted = text.match(
    /^(.+?)\s+hoef(?:t|ven)\s+(?:toch\s+)?niet(?:\s+meer)?\s+(?:en|maar)?\s*(?:doe|geef|neem|breng|bestel)\s+(?:me|mij|ons)?\s*(.+)$/,
  );
  if (noLongerWanted) {
    return { target: noLongerWanted[1].trim(), replacement: cleanReplacementPhrase(noLongerWanted[2]) };
  }

  const contrastReplacement = text.match(/^(?:geen|niet langer)\s+(.+?)(?:\s+meer)?\s+(?:maar\s+)?wel\s+(.+)$/);
  if (contrastReplacement) {
    return { target: contrastReplacement[1].trim(), replacement: cleanReplacementPhrase(contrastReplacement[2]) };
  }

  const englishSkip = text.match(/^skip\s+(.+?)\s+(?:i(?:'ll| will) take|give me|bring me)\s+(.+?)(?:\s+instead)?$/);
  if (englishSkip) return { target: englishSkip[1].trim(), replacement: cleanReplacementPhrase(englishSkip[2]) };

  const frenchContrast = text.match(/^(?:pas|plus)\s+(.+?)\s+(?:je prends|donnez moi)\s+(.+?)(?:\s+plutot)?$/);
  if (frenchContrast) return { target: frenchContrast[1].trim(), replacement: cleanReplacementPhrase(frenchContrast[2]) };

  const preferOver = text.match(/^(?:ik\s+)?(?:wil\s+)?toch\s+liever\s+(.+?)\s+dan\s+(.+)$/);
  if (preferOver) return { target: preferOver[2].trim(), replacement: cleanReplacementPhrase(preferOver[1]) };

  const replacementFirst = text.match(
    /^(?:doe|neem|geef|zet|pak|bestel)?(?:\s+toch)?(?:\s+maar)?\s*(.+?)\s+(?:in plaats van|in de plaats van|instead of|a la place de)\s+(.+)$/,
  );
  if (replacementFirst) {
    return { target: replacementFirst[2].trim(), replacement: cleanReplacementPhrase(replacementFirst[1]) };
  }
  return undefined;
}

function referencedCourse(value: string): DraftLine["course"] | undefined {
  const text = normalizeSpoken(value);
  if (/\b(?:voorgerecht(?:en)?|starter(?:s)?|entree(?:s)?)\b/.test(text)) return "starter";
  if (/\b(?:hoofdgerecht(?:en)?|main course|plat principal)\b/.test(text)) return "main";
  if (/\b(?:dessert(?:s)?|nagerecht(?:en)?)\b/.test(text)) return "dessert";
  if (/\b(?:drank(?:en)?|drink(?:s)?)\b/.test(text)) return "drinks";
  return undefined;
}

function shouldTreatAsModifierOnly(
  text: string,
  mentionStart: number,
  product: MenuProduct,
  earlierProducts: MenuProduct[],
): boolean {
  if (product.id !== "POS-3101" || earlierProducts.length === 0) return false;
  const normalized = normalizeSpoken(text);
  const prefix = normalized.slice(Math.max(0, mentionStart - 18), mentionStart);
  return /\b(met|with|avec)\s*$/.test(prefix);
}

export function interpretDeterministically(
  request: InterpretRequest,
  menu: TenantMenu,
  options: { ignoreTurns?: boolean } = {},
): DraftOrder {
  const started = performance.now();
  const now = new Date().toISOString();
  const lines: DraftLine[] = request.priorLines ? request.priorLines.map((line) => ({ ...line })) : [];
  const issues: DraftIssue[] = [];
  const warnings: DraftWarning[] = [];
  let sequence = Math.max(0, ...lines.map((line) => Number(line.lineId.match(/-(\d+)$/)?.[1] ?? 0)));
  let pendingWaiterSuggestion: ConversationTurn | undefined;
  let recentOfferedProducts = (request.contextProductIds ?? [])
    .map((productId) => menu.products.find((product) => isOrderableProduct(product) && product.id === productId))
    .filter((product): product is MenuProduct => Boolean(product));

  const nextId = (prefix: string) => `${prefix}-${++sequence}`;

  const removeCandidateProducts = (
    candidates: MenuProduct[],
    rawText: string,
    quantity?: number,
    confidence = 1,
  ) => {
    const existingCandidates = [...new Map(
      candidates
        .filter((candidate) => lines.some((line) => line.productId === candidate.id))
        .map((candidate) => [candidate.id, candidate]),
    ).values()];
    if (existingCandidates.length > 1) {
      issues.push({
        id: nextId("issue"),
        type: "ambiguous_removal",
        blocking: true,
        message: `Welke ${rawText} wil je uit de bestelling verwijderen?`,
        rawText,
        productCandidates: existingCandidates.slice(0, 5).map(issueCandidate),
      });
      return false;
    }
    const product = existingCandidates[0];
    if (!product) return false;
    const index = lines.findIndex((line) => line.productId === product.id);
    const line = lines[index];
    if (quantity && quantity < line.quantity) line.quantity -= quantity;
    else lines.splice(index, 1);
    if (confidence < 1) {
      warnings.push({
        id: nextId("warning"),
        type: "free_text_note",
        message: `Controleer verwijdering: “${rawText}” werd geïnterpreteerd als ${product.canonicalName}.`,
      });
    }
    return true;
  };

  const removeMatchingProduct = (phrase: string) =>
    removeCandidateProducts(productCandidatesForPhrase(phrase, menu), phrase);

  const removeMatchingCourse = (phrase: string): boolean | undefined => {
    const course = referencedCourse(phrase);
    if (!course) return undefined;
    const matchingLines = lines.filter((line) => line.course === course);
    if (matchingLines.length === 1) {
      lines.splice(lines.findIndex((line) => line.lineId === matchingLines[0].lineId), 1);
      return true;
    }
    const matchingProducts = matchingLines
      .map((line) => menu.products.find((product) => product.id === line.productId))
      .filter((product): product is MenuProduct => Boolean(product));
    issues.push({
      id: nextId("issue"),
      type: matchingProducts.length > 1 ? "ambiguous_removal" : "unresolved_product",
      blocking: true,
      message: matchingProducts.length > 1
        ? `Welk ${phrase} wil je vervangen?`
        : `Er staat momenteel geen ${phrase} in deze bestelling.`,
      rawText: phrase,
      productCandidates: matchingProducts.slice(0, 5).map(issueCandidate),
    });
    return false;
  };

  const removeMatchingReference = (phrase: string): boolean | undefined => {
    if (!/^(?:(?:de|het|the|le|la)\s+)?(?:die|dat|daar|deze|this|that|it|celle|celui|ca)$/.test(normalizeSpoken(phrase))) {
      return undefined;
    }
    if (lines.length === 1) {
      lines.splice(0, 1);
      return true;
    }
    const matchingProducts = lines
      .map((line) => menu.products.find((product) => product.id === line.productId))
      .filter((product): product is MenuProduct => Boolean(product));
    issues.push({
      id: nextId("issue"),
      type: matchingProducts.length > 1 ? "ambiguous_removal" : "unresolved_product",
      blocking: true,
      message: matchingProducts.length > 1
        ? "Welk besteld product wil je vervangen?"
        : "Er is geen besteld product waar deze verwijzing naar kan wijzen.",
      rawText: phrase,
      productCandidates: matchingProducts.slice(0, 5).map(issueCandidate),
    });
    return false;
  };

  const addOrUpdateLine = (
    product: MenuProduct,
    quantity: number,
    modifiers: SelectedModifier[],
    correction: boolean,
    notes: string[] = [],
    confidence = 0.94,
  ) => {
    const existing = lines.find((line) => line.productId === product.id);
    if (existing) {
      existing.quantity = correction ? quantity : existing.quantity + quantity;
      for (const modifier of modifiers) {
        existing.modifiers = existing.modifiers.filter((item) => item.groupId !== modifier.groupId);
        existing.modifiers.push(modifier);
      }
      existing.notes.push(...notes.filter((note) => !existing.notes.includes(note)));
      existing.confidence = Math.min(existing.confidence, confidence);
      return existing;
    }
    const line: DraftLine = {
      lineId: nextId("line"),
      productId: product.id,
      sku: product.sku,
      posName: product.posName,
      canonicalName: product.canonicalName,
      category: product.category,
      quantity,
      course: product.defaultCourse,
      modifiers,
      notes,
      confidence,
    };
    lines.push(line);
    return line;
  };

  const processCustomerText = (spokenText: string) => {
    const text = normalizeFlemish(spokenText, request.dialectProfile);
    const compoundReplacement = compoundOrderReplacementSegments(text);
    if (compoundReplacement) {
      for (const segment of compoundReplacement) processCustomerText(segment);
      return;
    }
    const finalChoice = finalDecisionClause(text);
    if (finalChoice) {
      processCustomerText(finalChoice);
      return;
    }
    const undecidedDeliberation = isUndecidedDeliberation(text);
    const matchOptions = {
      preferredProductIds: recentOfferedProducts.map((product) => product.id),
      existingProductIds: lines.map((line) => line.productId),
      categoryHints: categoryHintsForSpokenText(text),
    };
    const spokenProductMentions = findProductMentions(text, menu, matchOptions);
    const normalizedExplicitText = ` ${normalizeSpoken(text)} `;
    const hasReliableExplicitProduct = spokenProductMentions.some((mention) =>
      mention.candidateScores.some((candidate) =>
        candidate.evidence.includes("exact-alias") && candidate.acousticScore >= 0.9,
      ) || mention.candidates.some((product) => semanticProductAliases(product)
        .some((alias) => normalizedExplicitText.includes(` ${normalizeSpoken(alias)} `))),
    );
    const contextualWithoutProduct = !hasReliableExplicitProduct && (
      isContextualOrderReference(text) ||
      (recentOfferedProducts.length === 1 && isSafeSoleContextSelection(text))
    );
    // Keep a complete replacement utterance together. Splitting on a pause or
    // comma could otherwise turn "the starter is no longer needed, give me a
    // burger" into an ignored cancellation plus a separate addition.
    const replacementInstruction = parseReplacementInstruction(text);
    const segments = contextualWithoutProduct || replacementInstruction ? [spokenText] : conversationSegments(spokenText);
    if (segments.length > 1) {
      for (const segment of segments) processCustomerText(segment);
      return;
    }
    const routed = routeIntent(text, {
      menu,
      dialectProfile: request.dialectProfile,
      hasOrder: lines.length > 0,
      hasContext: recentOfferedProducts.length > 0,
      contextProductIds: matchOptions.preferredProductIds,
      existingProductIds: matchOptions.existingProductIds,
    });
    if (["menu_question", "availability_question", "price_question", "ingredient_question", "recommendation_question"].includes(routed.intent) || isQuestion(text)) {
      const questionProducts = productsForMenuQuestion(text, menu);
      if (questionProducts.length > 0) recentOfferedProducts = questionProducts.slice(0, 12);
      return;
    }
    const openAlternativeChoice = !replacementInstruction
      && /\b(?:of|or|ou)\b/.test(text)
      && spokenProductMentions.length > 1
      && routed.requiresOrderMutation;
    if (undecidedDeliberation || openAlternativeChoice) {
      const candidates = [...new Map(spokenProductMentions
        .flatMap((mention) => mention.candidates)
        .map((product) => [product.id, product])).values()];
      issues.push({
        id: nextId("issue"),
        type: "ambiguous_product",
        blocking: true,
        message: "Er werd nog geen definitieve keuze gehoord. Kies één van de genoemde opties.",
        rawText: text,
        productCandidates: candidates.slice(0, 5).map(issueCandidate),
      });
      return;
    }
    if (routed.intent === "non_order") return;
    const normalized = normalizeSpoken(text);
    const correction = isCorrection(text);

    const absoluteQuantityMatch = normalized.match(/\b(?:maak|doe|zet)\s+(?:er|het|die|dat)\s+(\w+)\s+(?:van|in totaal)\b/);
    const incrementQuantityMatch = normalized.match(/\b(?:doe|zet|tel)?\s*(?:er\s+)?nog\s+(\w+)\s+(?:bij|extra)?\b/);
    const decrementQuantityMatch = normalized.match(/\b(\w+)\s+minder\b/);
    const quantityOnly = parseNumberToken(absoluteQuantityMatch?.[1] ?? incrementQuantityMatch?.[1] ?? decrementQuantityMatch?.[1]);
    if (quantityOnly && findProductMentions(text, menu, matchOptions).length === 0 && (absoluteQuantityMatch || incrementQuantityMatch || decrementQuantityMatch)) {
      if (lines.length === 1) {
        if (absoluteQuantityMatch) lines[0].quantity = quantityOnly;
        else if (incrementQuantityMatch) lines[0].quantity += quantityOnly;
        else lines[0].quantity = Math.max(1, lines[0].quantity - quantityOnly);
      } else if (lines.length > 1) {
        const existingProducts = lines
          .map((line) => menu.products.find((product) => product.id === line.productId))
          .filter((product): product is MenuProduct => Boolean(product));
        issues.push({
          id: nextId("issue"),
          type: "ambiguous_product",
          blocking: true,
          message: "Voor welk product wil je de hoeveelheid aanpassen?",
          rawText: text,
          productCandidates: existingProducts.slice(0, 5).map(issueCandidate),
        });
      }
      return;
    }

    const replacement = replacementInstruction ?? parseReplacementInstruction(normalized);
    if (replacement) {
      const originalLines = lines.map((line) => ({
        ...line,
        modifiers: line.modifiers.map((modifier) => ({ ...modifier })),
        notes: [...line.notes],
      }));
      const removedByCourse = removeMatchingCourse(replacement.target);
      const removedByReference = removedByCourse === undefined ? removeMatchingReference(replacement.target) : undefined;
      const removed = removedByCourse ?? removedByReference ?? removeMatchingProduct(replacement.target);
      if (removed && replacement.replacement) {
        const stateAfterRemoval = JSON.stringify(lines);
        const issuesBeforeReplacement = issues.length;
        processCustomerText(replacement.replacement);
        if (JSON.stringify(lines) === stateAfterRemoval) {
          // A replacement is atomic: an unknown or ambiguous new product may
          // raise a review issue, but may never silently delete the old line.
          lines.splice(0, lines.length, ...originalLines);
          if (issues.length === issuesBeforeReplacement) {
            const culinaryAdvice = culinaryAdviceForText(`ik wil ${replacement.replacement}`, menu);
            issues.push({
              id: nextId("issue"),
              type: "unresolved_product",
              blocking: true,
              message: culinaryAdvice?.message
                ?? `Geen actief POS-product komt overeen met “${replacement.replacement}”. De bestaande bestelling bleef behouden.`,
              rawText: culinaryAdvice?.requested.names.nl ?? replacement.replacement,
              productCandidates: culinaryAdvice?.alternatives.map(issueCandidate),
            });
          }
        }
      }
      return;
    }

    if (isCancellation(text)) {
      if (/\b(?:annuleer|schrap|verwijder|cancel|remove)\s+(?:de hele bestelling|alles)\b|\bhaal\s+alles\s+weg\b|\blaat\s+alles\s+maar\s+zitten\b/.test(normalized)) {
        lines.splice(0, lines.length);
        return;
      }

      const cancellationMentions = findProductMentions(text, menu, matchOptions);
      if (cancellationMentions.length === 0) {
        const removedByCourse = removeMatchingCourse(text);
        if (removedByCourse !== undefined) return;
        if (/\b(?:vorige|laatste)\b/.test(normalized) && lines.length > 0) {
          const latestLine = lines.at(-1)!;
          const latestProduct = menu.products.find((product) => product.id === latestLine.productId);
          if (latestProduct) removeCandidateProducts([latestProduct], "de vorige");
          return;
        }
        if (/\b(?:laat|haal|annuleer|schrap|verwijder)\s+(?:dat|die|deze)\b/.test(normalized)) {
          const existingProducts = lines
            .map((line) => menu.products.find((product) => product.id === line.productId))
            .filter((product): product is MenuProduct => Boolean(product));
          if (existingProducts.length === 1) removeCandidateProducts(existingProducts, "dat");
          else if (existingProducts.length > 1) {
            issues.push({
              id: nextId("issue"),
              type: "ambiguous_removal",
              blocking: true,
              message: "Welk product wil je uit de bestelling verwijderen?",
              rawText: text,
              productCandidates: existingProducts.slice(0, 5).map(issueCandidate),
            });
          }
        }
        return;
      }

      let previousMentionEnd = 0;
      for (const mention of cancellationMentions) {
        const applies = cancellationMentions.length === 1 || cancellationAppliesToMention(
          text,
          mention.start,
          mention.end,
          previousMentionEnd,
        );
        previousMentionEnd = mention.end;
        if (!applies) continue;
        removeCandidateProducts(
          mention.candidates,
          mention.alias,
          explicitRemovalQuantity(text, mention.start, mention.alias),
          mention.confidence,
        );
      }
      return;
    }

    if (contextualWithoutProduct) {
      const repeatsPrevious = /\b(?:dezelfde|hetzelfde|nog zo eentje|nog eentje|nog een keer|nog eens|de vorige nog eens)\b/.test(normalized);
      const previousProduct = repeatsPrevious
        ? menu.products.find((product) => product.id === lines.at(-1)?.productId)
        : undefined;
      const contextPool = previousProduct ? [previousProduct] : recentOfferedProducts;
      const contextualCandidates = contextualProductCandidates(text, contextPool);
      if (contextualCandidates.length === 1) {
        addOrUpdateLine(contextualCandidates[0], contextualQuantity(text), [], false);
        recentOfferedProducts = [];
      } else if (contextualCandidates.length > 1) {
        issues.push({
          id: nextId("issue"),
          type: "ambiguous_product",
          blocking: true,
          message: "Naar welk aangeboden product verwijst ‘die’?",
          rawText: text,
          productCandidates: contextualCandidates.slice(0, 5).map(issueCandidate),
        });
      } else {
        issues.push({
          id: nextId("issue"),
          type: "unresolved_product",
          blocking: true,
          message: "Ik weet niet naar welk product ‘die’ verwijst. Noem het product nog eens.",
          rawText: text,
        });
      }
      return;
    }

    if (/nog hetzelfde als daarnet|same as before|la meme chose/.test(normalized)) {
      const prior = request.priorLines ?? [];
      if (prior.length === 1) {
        const product = menu.products.find((candidate) => candidate.id === prior[0].productId);
        if (product) addOrUpdateLine(product, prior[0].quantity, prior[0].modifiers, false, prior[0].notes);
      } else {
        const candidates = [...new Map(prior.map((line) => [line.productId, line])).values()]
          .map((line) => menu.products.find((product) => product.id === line.productId))
          .filter((product): product is MenuProduct => Boolean(product))
          .slice(0, 5);
        issues.push({
          id: nextId("issue"),
          type: candidates.length ? "ambiguous_product" : "unresolved_product",
          blocking: true,
          message: candidates.length ? "‘Same as before’ has multiple possible referents." : "No previous table item is available.",
          rawText: text,
          productCandidates: candidates.map(issueCandidate),
        });
      }
      return;
    }

    const productMentions = findProductMentions(text, menu, matchOptions);
    const modifierMentions = findModifierMentions(text, menu.modifierGroups);
    if (productMentions.length > 0 && !hasOrderingContext(text, productMentions, modifierMentions.length)) return;
    const earlierProducts: MenuProduct[] = [];
    let latestLine: DraftLine | undefined;
    let processedProductCount = 0;

    for (const mention of productMentions) {
      const filteredCandidates = mention.candidates.filter(
        (candidate) =>
          !shouldTreatAsModifierOnly(text, mention.start, candidate, earlierProducts) &&
          !(
            candidate.id === "POS-3101" &&
            isWaiterSuggestion(text) &&
            lines.some((line) =>
              menu.products
                .find((product) => product.id === line.productId)
                ?.modifierGroupIds.includes("MG-SIDE"),
            )
          ),
      );
      if (filteredCandidates.length === 0) continue;

      const ambiguousAudioMatch = filteredCandidates.length > 1 && request.source === "audio";
      if (filteredCandidates.length > 1 && !ambiguousAudioMatch) {
        processedProductCount += 1;
        issues.push({
          id: nextId("issue"),
          type: "ambiguous_product",
          blocking: true,
          message: `“${mention.alias}” matches more than one active POS product.`,
          rawText: mention.alias,
          matchConfidence: mention.confidence,
          matchMargin: mention.margin,
          matchEvidence: mention.candidateScores.flatMap((candidate) => candidate.evidence)
            .filter((value, index, values) => values.indexOf(value) === index)
            .slice(0, 10),
          productCandidates: filteredCandidates.slice(0, 5).map(issueCandidate),
        });
        continue;
      }

      const product = filteredCandidates[0];
      processedProductCount += 1;
      earlierProducts.push(product);
      const compatibleModifiers = modifierMentions
        .filter((modifier) => product.modifierGroupIds.includes(modifier.group.id))
        .map(selectedModifier);
      const uniqueModifiers = [...new Map(compatibleModifiers.map((modifier) => [modifier.optionId, modifier])).values()];
      const quantity = quantityNearMention(text, mention.start, mention.end, correction);
      const notes = /apart|on the side|a part/.test(normalized) ? ["Serve specified sauce/side separately"] : [];
      const confidence = mention.confidence >= 1 ? 0.96 : Math.min(0.9, mention.confidence);
      latestLine = addOrUpdateLine(product, quantity, uniqueModifiers, correction, notes, confidence);
      if (mention.requiresConfirmation || ambiguousAudioMatch) {
        if (request.source === "audio") {
          issues.push({
            id: nextId("issue"),
            type: "speech_confirmation",
            blocking: true,
            message: ambiguousAudioMatch
              ? `Ik heb voorlopig ${product.canonicalName} toegevoegd voor “${mention.alias}”. Klopt dat?`
              : `Bedoelde je ${product.canonicalName} toen je “${mention.alias}” zei?`,
            rawText: mention.alias,
            lineId: latestLine.lineId,
            quantityDelta: quantity,
            matchConfidence: mention.candidateScores[0]?.acousticScore ?? mention.confidence,
            matchMargin: mention.margin,
            matchEvidence: mention.candidateScores[0]?.evidence,
            productCandidates: ambiguousAudioMatch
              ? filteredCandidates.slice(0, 5).map(issueCandidate)
              : [issueCandidate(product)],
          });
        } else {
          warnings.push({
            id: nextId("warning"),
            type: "free_text_note",
            message: `Controleer spraakmatch: “${mention.alias}” werd geïnterpreteerd als ${product.canonicalName}.`,
            lineId: latestLine.lineId,
          });
        }
      }

      if (
        product.defaultCourse === "starter" &&
        /samen met (?:mijn )?(?:steak|hoofdgerecht)|together with (?:my )?main/.test(normalized)
      ) {
        latestLine.course = "main";
        issues.push({
          id: nextId("issue"),
          type: "course_exception",
          blocking: true,
          message: `${product.canonicalName} was requested with the main course. Confirm unusual timing.`,
          lineId: latestLine.lineId,
          rawText: text,
        });
      }
    }

    if (processedProductCount === 0 && modifierMentions.length > 0) {
      for (const modifier of modifierMentions) {
        const target = [...lines]
          .reverse()
          .find((line) => menu.products.find((product) => product.id === line.productId)?.modifierGroupIds.includes(modifier.group.id));
        if (target) {
          target.modifiers = target.modifiers.filter((item) => item.groupId !== modifier.group.id);
          target.modifiers.push(selectedModifier(modifier));
          latestLine = target;
        }
      }
    }

    if (processedProductCount === 0 && modifierMentions.length === 0 && looksLikeOrderWithoutMatch(text)) {
      const rawText = unresolvedPhrase(text) || text;
      const culinaryAdvice = culinaryAdviceForText(text, menu);
      issues.push({
        id: nextId("issue"),
        type: "unresolved_product",
        blocking: true,
        message: culinaryAdvice?.message ?? `No active POS product matches “${rawText}”.`,
        rawText: culinaryAdvice?.requested.names.nl ?? rawText,
        productCandidates: culinaryAdvice?.alternatives.map(issueCandidate),
      });
    }

    if (/allerg|noten|nuts|glutenvrij|sans gluten/.test(normalized)) {
      warnings.push({
        id: nextId("warning"),
        type: "allergy_manual_check",
        message: `ALLERGY — manual check required. Spoken statement: “${text}”`,
        lineId: latestLine?.lineId ?? lines.at(-1)?.lineId,
      });
    }
  };

  for (const turn of options.ignoreTurns ? [] : request.turns) {
    if (turn.speaker === "waiter") {
      const offeredProducts = findProductMentions(turn.text, menu)
        .flatMap((mention) => mention.candidates)
        .filter((product, index, products) => products.findIndex((candidate) => candidate.id === product.id) === index);
      if (offeredProducts.length > 0 && !isWaiterConfirmation(turn.text)) {
        recentOfferedProducts = offeredProducts.slice(0, 12);
      }
      pendingWaiterSuggestion = isWaiterSuggestion(turn.text) ? turn : undefined;
      continue;
    }
    if (turn.speaker === "customer" && isAffirmation(turn.text) && pendingWaiterSuggestion) {
      processCustomerText(pendingWaiterSuggestion.text);
      pendingWaiterSuggestion = undefined;
      continue;
    }
    processCustomerText(turn.text);
    pendingWaiterSuggestion = undefined;
  }

  for (const line of lines) {
    const product = menu.products.find((candidate) => candidate.id === line.productId);
    if (!product) continue;
    for (const groupId of product.modifierGroupIds) {
      const group = menu.modifierGroups.find((candidate) => candidate.id === groupId);
      if (!group || !group.required) continue;
      const count = line.modifiers.filter((modifier) => modifier.groupId === groupId).length;
      if (count < group.min) {
        issues.push({
          id: nextId("issue"),
          type: "missing_modifier",
          blocking: true,
          message: `${line.canonicalName} needs ${group.name.toLowerCase()}.`,
          lineId: line.lineId,
          modifierGroupId: group.id,
          modifierOptions: group.options,
        });
      }
    }
  }

  return {
    id: randomUUID(),
    tenantId: request.tenantId,
    tableId: request.tableId,
    tableLabel: request.tableLabel,
    createdBy: request.waiterId,
    lastEditedBy: request.waiterId,
    status: "NOT_SENT",
    source: request.source,
    lines,
    issues,
    warnings,
    createdAt: now,
    updatedAt: now,
    interpretationLatencyMs: Math.round(performance.now() - started),
  };
}
