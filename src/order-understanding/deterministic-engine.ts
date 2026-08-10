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
  findModifierMentions,
  findProductMentions,
  normalizeSpoken,
  productCandidatesForPhrase,
  type ModifierMention,
} from "@/src/semantic-menu/matcher";

const NUMBER_WORDS: Record<string, number> = {
  een: 1,
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
};

function parseNumberToken(token: string | undefined): number | undefined {
  if (!token) return undefined;
  if (/^\d+$/.test(token)) return Number(token);
  return NUMBER_WORDS[token];
}

function quantityNearMention(text: string, start: number, end: number, correction: boolean): number {
  const normalized = normalizeSpoken(text);
  if (/voor ons allebei|for both of us|pour nous deux/.test(normalized)) return 2;

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
  const orderCue = /\b(neem|nemen|wil|wilt|doe dan|bestel|pour moi|je prends|i'll have|i will have)\b/.test(normalized);
  const questionCue = /^(hebben|welke|wat hebben|is er|do you have|which|what|avez vous|quels|est ce)/.test(normalized);
  return questionCue && !orderCue;
}

function isAffirmation(text: string): boolean {
  return /^(ja|yes|oui|ok|okay|graag|dat is goed|c'est bon)[.! ]*$/.test(normalizeSpoken(text));
}

function isWaiterSuggestion(text: string): boolean {
  return /\b(ik zet|zal ik|doe ik|mag ik|i'll add|shall i add|je vous mets)\b/.test(normalizeSpoken(text));
}

function isCorrection(text: string): boolean {
  return /\b(nee wacht|maak daar|maak die|verander|in plaats van|non attends|no wait|change)\b/.test(normalizeSpoken(text));
}

function isCancellation(text: string): boolean {
  return /\b(laat .* vallen|annuleer|haal .* weg|cancel|remove|laisse tomber)\b/.test(normalizeSpoken(text));
}

function looksLikeOrderWithoutMatch(text: string): boolean {
  return /\b(neem|nemen|wil|doe dan|voor mij|pour moi|je prends|i'll have|bestel)\b/.test(normalizeSpoken(text));
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

export function interpretDeterministically(request: InterpretRequest, menu: TenantMenu): DraftOrder {
  const started = performance.now();
  const now = new Date().toISOString();
  const lines: DraftLine[] = request.priorLines ? request.priorLines.map((line) => ({ ...line })) : [];
  const issues: DraftIssue[] = [];
  const warnings: DraftWarning[] = [];
  let sequence = 0;
  let pendingWaiterSuggestion: ConversationTurn | undefined;

  const nextId = (prefix: string) => `${prefix}-${++sequence}`;

  const removeMatchingProduct = (phrase: string) => {
    const candidates = productCandidatesForPhrase(phrase, menu);
    for (const candidate of candidates) {
      const index = lines.findIndex((line) => line.productId === candidate.id);
      if (index >= 0) lines.splice(index, 1);
    }
  };

  const addOrUpdateLine = (
    product: MenuProduct,
    quantity: number,
    modifiers: SelectedModifier[],
    correction: boolean,
    notes: string[] = [],
  ) => {
    const existing = lines.find((line) => line.productId === product.id);
    if (existing) {
      existing.quantity = correction ? quantity : existing.quantity + quantity;
      for (const modifier of modifiers) {
        existing.modifiers = existing.modifiers.filter((item) => item.groupId !== modifier.groupId);
        existing.modifiers.push(modifier);
      }
      existing.notes.push(...notes.filter((note) => !existing.notes.includes(note)));
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
      confidence: 0.94,
    };
    lines.push(line);
    return line;
  };

  const processCustomerText = (text: string) => {
    if (isQuestion(text)) return;
    const normalized = normalizeSpoken(text);
    const correction = isCorrection(text);

    const replaceMatch = normalized.match(/(?:verander|change) (?:die|de|the)?\s*(.+?) (?:naar|in|to) (.+)$/);
    if (replaceMatch) {
      removeMatchingProduct(replaceMatch[1]);
      processCustomerText(replaceMatch[2]);
      return;
    }

    if (isCancellation(text)) {
      const cancelMatch = normalized.match(/(?:laat|annuleer|haal|cancel|remove|laisse)\s+(?:die|de|the)?\s*(.+?)(?:\s+toch)?\s*(?:maar)?\s*(?:vallen|weg|$)/);
      if (cancelMatch) removeMatchingProduct(cancelMatch[1]);
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

    const productMentions = findProductMentions(text, menu);
    const modifierMentions = findModifierMentions(text, menu.modifierGroups);
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

      if (filteredCandidates.length > 1) {
        processedProductCount += 1;
        issues.push({
          id: nextId("issue"),
          type: "ambiguous_product",
          blocking: true,
          message: `“${mention.alias}” matches more than one active POS product.`,
          rawText: mention.alias,
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
      latestLine = addOrUpdateLine(product, quantity, uniqueModifiers, correction, notes);

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
      issues.push({
        id: nextId("issue"),
        type: "unresolved_product",
        blocking: true,
        message: `No active POS product matches “${rawText}”.`,
        rawText,
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

  for (const turn of request.turns) {
    if (turn.speaker === "waiter") {
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
