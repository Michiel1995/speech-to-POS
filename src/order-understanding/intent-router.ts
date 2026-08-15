import type { TenantMenu } from "@/src/domain/schemas";
import { normalizeFlemish, type DialectProfile } from "@/src/language/flemish-dialect";
import { findProductMentions } from "@/src/semantic-menu/matcher";

export const CONVERSATION_INTENTS = [
  "order",
  "addition",
  "removal",
  "replacement",
  "correction",
  "menu_question",
  "availability_question",
  "price_question",
  "ingredient_question",
  "recommendation_question",
  "answer",
  "refusal",
  "non_order",
  "unclear",
] as const;
export type ConversationIntent = (typeof CONVERSATION_INTENTS)[number];

export interface RoutedIntent {
  intent: ConversationIntent;
  confidence: number;
  normalizedText: string;
  evidence: string[];
  productIds: string[];
  requiresOrderMutation: boolean;
}

const QUESTION_START = /^(?:(?:en|awel|allee|zeg)\s+)?(?:zeg eens |vertel eens |weet je |kan je |kun je |zou je |ik vroeg me af |ik vraag me af |ik wou eens weten |mag ik vragen |could you tell me |can you tell me |tell me )?(?:wat|welke|welk|hoeveel|hoe duur|waartussen|waaruit|heb je|hebben jullie|is er|zijn er|kan ik|kunnen we|do you|which|what|how much|avez vous|quels|quel|combien|qu est ce que|vous avez quoi|que proposez vous|on peut choisir)/;
const DIRECT_QUESTION_START = /^(?:could you tell me|can you tell me|tell me|qu[' ]est ce que|vous avez quoi|que proposez vous|on peut choisir)\b/;
const MENU_SUBJECT = /\b(?:bier|bieren|wijn|wijnen|drank|dranken|drinken|boire|boisson|boissons|frisdrank|cocktail|koffie|voorgerecht|starter|starten|vooraf|entree|entrees|hoofdgerecht|gerecht|dessert|menu|kaart|eten|alcoholvrij|vegetarisch|vegan)\b/;
const ORDER_CUE = /\b(?:ik neem|ik pak|ik ga voor|ik kies|ik wil|ik wou graag|wij nemen|we nemen|voor mij|voor ons|geef|doe|zet|breng|bestel|schrijf|voeg|mag ik|zou ik mogen|graag|laat maar komen|laat komen|je prends|pour moi|i'll have|i will have)\b/;
const ADDITION_CUE = /\b(?:erbij|daarbij|nog een|nog eentje|nog ene|ook een|voeg toe|doe er|zet er|schrijf er|extra|bijbestellen|voor mij ook|dezelfde nog|maak er nog|eentje meer)\b/;
const REMOVAL_CUE = /\b(?:geen|gene|niet meer|toch niet|toch geen|hoef.*niet|moet.*niet hebben|laat.*zitten|laat.*vallen|laat.*steken|haal.*weg|doe.*weg|eruit|er uit|verwijder|schrap|annuleer|cancel|remove|supprime)\b/;
const REPLACEMENT_CUE = /\b(?:in plaats van|vervang|verander .* naar|maak daar|wissel .* voor|change .* to|replace .* with)\b/;
const CORRECTION_CUE = /\b(?:nee wacht|ik bedoel|correctie|dat klopt niet|sorry|maak er|eigenlijk|toch liever)\b/;
const STORY_CUE = /\b(?:grap|grapje|mop|mopje|zwanzen|verhaal|gisteren|vorige week|vorig jaar|mijn nonkel|mijn zus|mijn vriend|droomde|herinner me|praat over|vertelde|heet|noemt|zoals die keer)\b/;
const CONTEXT_ACCEPTANCE = /\b(?:doe maar|geef maar|die graag|dat graag|die mag|dat mag|klinkt goed|lijkt lekker|laat maar komen|ik ga daarvoor|eentje daarvan)\b/;

export function segmentUtterance(text: string): string[] {
  return text
    .split(/\r?\n|[!?;]+|\.(?=\s|$)|,\s*(?=(?:maar\s+)?(?:ik|wij|we|voor mij|doe|geef|haal|laat|welke|wat|hoeveel|heb))/i)
    .map((segment) => segment.trim())
    .filter(Boolean);
}

export function routeIntent(
  text: string,
  options: {
    menu?: TenantMenu;
    dialectProfile?: DialectProfile;
    hasOrder?: boolean;
    hasContext?: boolean;
    contextProductIds?: string[];
    existingProductIds?: string[];
  } = {},
): RoutedIntent {
  const normalizedText = normalizeFlemish(text, options.dialectProfile ?? "auto");
  const startsAsQuestion = QUESTION_START.test(normalizedText) || DIRECT_QUESTION_START.test(normalizedText);
  const productIds = options.menu
    ? [...new Set(findProductMentions(normalizedText, options.menu, {
      preferredProductIds: options.contextProductIds,
      existingProductIds: options.existingProductIds,
    }).flatMap((mention) => mention.candidates.map((product) => product.id)))]
    : [];
  const result = (intent: ConversationIntent, confidence: number, evidence: string[]): RoutedIntent => ({
    intent,
    confidence,
    normalizedText,
    evidence,
    productIds,
    requiresOrderMutation: ["order", "addition", "removal", "replacement", "correction"].includes(intent),
  });
  const politeOrderQuestion = /^(?:kan ik|mag ik|zou ik|kunnen we|could i|can i|may i|est ce que je peux)\b.*\b(?:krijgen|hebben|nemen|bestellen|pakken|have|get|prendre)\b/.test(normalizedText);

  if (!normalizedText) return result("unclear", 0.2, ["empty"]);
  if (/\b(?:wat kost|hoeveel kost|prijs|prijzen|how much|combien coute)\b/.test(normalizedText)) {
    return result("price_question", 0.98, ["price-question"]);
  }
  if (/\b(?:wat zit|ingredient|ingrediënten|allergeen|allergenen|gluten|noten|bevat|what is in|contains)\b/.test(normalizedText) && (startsAsQuestion || /\?[!.]*$/.test(text.trim()))) {
    return result("ingredient_question", 0.96, ["ingredient-question"]);
  }
  if (/\b(?:wat raad|welke raad|aanraden|aanbevelen|suggestie|lekkerste|populair(?:ste)?|recommend|conseil)\b/.test(normalizedText)) {
    return result("recommendation_question", 0.96, ["recommendation-question"]);
  }
  if ((/^(?:hebben jullie|heb je|is er|zijn er|do you have|avez vous)\b/.test(normalizedText) || /\b(?:beschikbaar|op voorraad|nog over)\b/.test(normalizedText)) && (MENU_SUBJECT.test(normalizedText) || productIds.length > 0)) {
    return result("availability_question", 0.97, ["availability-question"]);
  }
  if (!politeOrderQuestion && (startsAsQuestion || /\b(?:wil weten|zeg eens welke|toon me|kan ik kiezen uit)\b/.test(normalizedText)) && (MENU_SUBJECT.test(normalizedText) || productIds.length > 0)) {
    return result("menu_question", 0.96, ["menu-question"]);
  }
  if (REPLACEMENT_CUE.test(normalizedText)) return result("replacement", 0.98, ["replacement-cue"]);
  if (REMOVAL_CUE.test(normalizedText) && (productIds.length > 0 || options.hasOrder)) return result("removal", 0.97, ["removal-cue"]);
  if (CORRECTION_CUE.test(normalizedText) && (productIds.length > 0 || options.hasOrder)) return result("correction", 0.92, ["correction-cue"]);
  if (ADDITION_CUE.test(normalizedText) && (productIds.length > 0 || options.hasContext)) return result("addition", 0.96, ["addition-cue"]);
  if (CONTEXT_ACCEPTANCE.test(normalizedText) && options.hasContext) return result("order", 0.9, ["context-acceptance"]);
  if (/^(?:ja|jazeker|zeker|inderdaad|ok|okay|graag|correct|oui|yes)\b/.test(normalizedText)) return result("answer", 0.9, ["affirmation"]);
  if (/^(?:nee|neen|no|non|liever niet|laat maar)\b/.test(normalizedText)) return result("refusal", 0.9, ["refusal"]);
  if (STORY_CUE.test(normalizedText) && !ORDER_CUE.test(normalizedText)) return result("non_order", 0.94, ["story-or-joke"]);
  if (ORDER_CUE.test(normalizedText) && (productIds.length > 0 || normalizedText.split(" ").length <= 12)) {
    return result(options.hasOrder ? "addition" : "order", productIds.length > 0 ? 0.96 : 0.66, ["order-cue"]);
  }
  if (productIds.length > 0 && normalizedText.split(" ").length <= 7) {
    return result(options.hasOrder ? "addition" : "order", 0.82, ["short-product-utterance"]);
  }
  if (startsAsQuestion) return result("menu_question", 0.62, ["generic-question"]);
  if (/\b(?:haha|allee|amai|zeg|euh|uhm)\b/.test(normalizedText) || normalizedText.split(" ").length > 14) {
    return result("non_order", 0.72, ["conversation-without-action"]);
  }
  return result("unclear", 0.45, ["no-decisive-cue"]);
}

export function routeUtterance(
  text: string,
  options: Parameters<typeof routeIntent>[1] = {},
): RoutedIntent[] {
  const segments = segmentUtterance(text);
  return (segments.length ? segments : [text]).map((segment) => routeIntent(segment, options));
}
