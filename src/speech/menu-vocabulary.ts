import type { MenuProduct, TenantMenu } from "@/src/domain/schemas";
import type { DialectProfile } from "@/src/language/flemish-dialect";
import { isOrderableProduct, semanticProductAliases } from "@/src/semantic-menu/product-index";
import { culinaryPromptPhrases } from "@/src/knowledge/culinary-knowledge";

const DEFAULT_PROMPT_LIMIT = 900;

export interface SpeechVocabularyOptions {
  contextProductIds?: string[];
  priorProductIds?: string[];
  maxPromptChars?: number;
  dialectProfile?: DialectProfile;
  approvedAliases?: Array<{ spokenFragment: string; productId: string }>;
}

export interface SpeechVocabulary {
  primaryPrompt: string;
  retryPrompt: string;
  preferredProductIds: string[];
}

function unique(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter((value) => {
    const normalized = value.trim().toLocaleLowerCase("nl-BE");
    if (!normalized || seen.has(normalized)) return false;
    seen.add(normalized);
    return true;
  });
}

function fitPrompt(introduction: string, phrases: string[], maximumLength: number): string {
  const selected: string[] = [];
  let length = introduction.length;
  for (const phrase of unique(phrases)) {
    const additionLength = phrase.length + (selected.length ? 2 : 1);
    if (length + additionLength > maximumLength) continue;
    selected.push(phrase);
    length += additionLength;
  }
  return `${introduction} ${selected.join(", ")}`.trim();
}

function productPhrases(product: MenuProduct): string[] {
  return unique(semanticProductAliases(product));
}

function pronunciationAlias(product: MenuProduct): string | undefined {
  const canonicalTokens = product.canonicalName.toLocaleLowerCase("nl-BE").split(/[^a-z0-9]+/).filter(Boolean);
  const canonicalNormalized = canonicalTokens.join(" ");
  return product.aliases
    .filter((alias) => alias.toLocaleLowerCase("nl-BE").split(/[^a-z0-9]+/).filter(Boolean).join(" ") !== canonicalNormalized)
    .map((alias, index) => {
      const tokens = alias.toLocaleLowerCase("nl-BE").split(/[^a-z0-9]+/).filter(Boolean);
      const samePositions = tokens.filter((token, tokenIndex) => token === canonicalTokens[tokenIndex]).length;
      const sameWordCount = tokens.length === canonicalTokens.length ? 4 : 0;
      const specificity = tokens.length > 1 || alias.length >= 5 ? 1 : -4;
      return { alias, index, score: sameWordCount + samePositions * 3 + specificity };
    })
    .sort((left, right) => right.score - left.score || right.index - left.index)[0]?.alias;
}

export function buildSpeechVocabulary(
  menu: TenantMenu,
  options: SpeechVocabularyOptions = {},
): SpeechVocabulary {
  const activeProducts = menu.products.filter(isOrderableProduct);
  const learnedAliases = new Map<string, string[]>();
  for (const mapping of options.approvedAliases ?? []) {
    learnedAliases.set(mapping.productId, [...(learnedAliases.get(mapping.productId) ?? []), mapping.spokenFragment]);
  }
  const activeById = new Map(activeProducts.map((product) => [product.id, product]));
  const preferredProductIds = unique([
    ...(options.contextProductIds ?? []),
    ...[...(options.priorProductIds ?? [])].reverse(),
  ]).filter((productId) => activeById.has(productId)).slice(0, 12);
  const preferredProducts = preferredProductIds
    .map((productId) => activeById.get(productId))
    .filter((product): product is MenuProduct => Boolean(product));
  const remainingProducts = activeProducts.filter((product) => !preferredProductIds.includes(product.id));
  const orderedProducts = [...preferredProducts, ...remainingProducts];
  const menuCorePhrases = orderedProducts.flatMap((product) => [product.canonicalName, pronunciationAlias(product)].filter((value): value is string => Boolean(value)));
  const posNames = orderedProducts.map((product) => product.posName);
  const preferredPhraseLists = preferredProducts.map((product) => [...productPhrases(product), ...(learnedAliases.get(product.id) ?? [])]);
  const preferredPronunciations = Array.from(
    { length: Math.max(0, ...preferredPhraseLists.map((phrases) => phrases.length)) },
    (_, phraseIndex) => preferredPhraseLists.map((phrases) => phrases[phraseIndex]).filter(Boolean),
  ).flat();
  const aliasesRoundRobin = Array.from(
    { length: Math.max(0, ...orderedProducts.map((product) => product.aliases.length)) },
    (_, aliasIndex) => orderedProducts.map((product) => product.aliases[aliasIndex]).filter(Boolean),
  ).flat();
  const modifierPhrases = menu.modifierGroups.flatMap((group) =>
    group.options.flatMap((option) => [option.canonicalName, option.aliases[0]].filter((value): value is string => Boolean(value))),
  );
  const promptLimit = Math.max(300, options.maxPromptChars ?? DEFAULT_PROMPT_LIMIT);

  const dialectProfile = options.dialectProfile ?? "auto";
  const dialectHints = dialectProfile === "standard"
    ? "Standaardspraak."
    : dialectProfile === "auto"
      ? "Vlaamse dialectspraak mogelijk: wa, hedde, kunde, ne, nie, pintje, patatjes."
      : `${dialectProfile.replaceAll("_", " ")} dialect; ingeslikte eindklanken en Vlaamse spreektaal zijn mogelijk.`;
  const learnedPronunciations = activeProducts.flatMap((product) => learnedAliases.get(product.id) ?? []);
  const broadCulinaryPhrases = culinaryPromptPhrases();
  const primaryPrompt = fitPrompt(
    `Horeca-gesprek in het Nederlands, Frans of Engels. ${dialectHints} Schrijf letterlijk wat gezegd wordt, ook als een gerecht niet op de kaart staat. Actieve kaart en mogelijk horecawoorden:`,
    // Menu pronunciations must precede broad culinary knowledge. The prompt
    // has a strict token budget; putting general dishes first used to evict
    // variants such as "leven blond" and "vol over vent" from busy menus.
    [...preferredPronunciations, ...learnedPronunciations, ...modifierPhrases, ...menuCorePhrases, ...aliasesRoundRobin, ...posNames, ...broadCulinaryPhrases],
    promptLimit,
  );
  const retryPrompt = fitPrompt(
    "Luister opnieuw en transcribeer letterlijk; een gevraagd gerecht kan buiten het POS-menu vallen. Mogelijke kaartnamen, algemene gerechten en uitspraakvarianten zijn:",
    [...preferredPronunciations, ...learnedPronunciations, ...modifierPhrases, ...menuCorePhrases, ...aliasesRoundRobin, ...posNames, ...broadCulinaryPhrases],
    promptLimit,
  );

  return { primaryPrompt, retryPrompt, preferredProductIds };
}
