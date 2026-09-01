const VOWEL_GROUPS = ["a", "e", "i", "o", "u"] as const;

const CHARACTER_GROUPS = [
  new Set(["b", "p"]),
  new Set(["d", "t"]),
  new Set(["f", "v", "w"]),
  new Set(["g", "h", "x"]),
  new Set(["s", "z"]),
  new Set(["c", "k", "q"]),
  new Set(["i", "j", "y"]),
];

const PHONETIC_CACHE = new Map<string, string>();
const SIMILARITY_CACHE = new Map<string, SpokenSimilarity>();

function plain(value: string): string {
  return value
    .toLocaleLowerCase("nl-BE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function sameCharacterFamily(left: string, right: string): boolean {
  return CHARACTER_GROUPS.some((group) => group.has(left) && group.has(right));
}

function vowelFamily(value: string): string | undefined {
  return VOWEL_GROUPS.find((vowel) => vowel === value);
}

function substitutionCost(left: string, right: string): number {
  if (left === right) return 0;
  if (sameCharacterFamily(left, right)) return 0.28;
  if (vowelFamily(left) && vowelFamily(right)) return 0.52;
  return 1;
}

export function weightedPhoneticDistance(left: string, right: string): number {
  if (left === right) return 0;
  if (!left.length) return right.length;
  if (!right.length) return left.length;

  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const insertion = current[rightIndex - 1] + 0.9;
      const deletion = previous[rightIndex] + 0.9;
      const substitution = previous[rightIndex - 1] + substitutionCost(left[leftIndex - 1], right[rightIndex - 1]);
      let transposition = Number.POSITIVE_INFINITY;
      if (
        leftIndex > 1 &&
        rightIndex > 1 &&
        left[leftIndex - 1] === right[rightIndex - 2] &&
        left[leftIndex - 2] === right[rightIndex - 1]
      ) {
        transposition = previous[rightIndex - 2] + 0.55;
      }
      current.push(Math.min(insertion, deletion, substitution, transposition));
    }
    previous = current;
  }
  return previous[right.length];
}

/**
 * Produces a deliberately lossy key for Belgian-Dutch, French and English
 * product pronunciations. It is only used as a secondary signal: a phonetic
 * key can suggest a candidate, but can never mutate an order by itself.
 */
export function phoneticKey(value: string): string {
  const normalized = plain(value);
  const cached = PHONETIC_CACHE.get(normalized);
  if (cached !== undefined) return cached;
  const key = normalized
    .replace(/\b(?:een|ne|nen|un|une|one|the|de|het)\b/g, " ")
    .replace(/eaux|eau/g, "o")
    .replace(/ough/g, "o")
    .replace(/sch/g, "s")
    .replace(/tch|ch|sh/g, "s")
    .replace(/ph/g, "f")
    .replace(/th/g, "t")
    .replace(/qu|ck/g, "k")
    .replace(/c(?=[aou])/g, "k")
    .replace(/c/g, "s")
    .replace(/x/g, "ks")
    .replace(/ij|ei|ey|y/g, "i")
    .replace(/ou|au|ow/g, "o")
    .replace(/ai|ay/g, "e")
    .replace(/oe|oo/g, "u")
    .replace(/ie|ee/g, "i")
    .replace(/v|w/g, "f")
    .replace(/z/g, "s")
    .replace(/b/g, "p")
    .replace(/d(?=\b|\s)/g, "t")
    .replace(/g|h/g, "x")
    .replace(/n(?=\b|\s)/g, "")
    .replace(/([a-z])\1+/g, "$1")
    .replace(/\s+/g, "")
    .trim();
  if (PHONETIC_CACHE.size >= 5_000) PHONETIC_CACHE.delete(PHONETIC_CACHE.keys().next().value!);
  PHONETIC_CACHE.set(normalized, key);
  return key;
}

function directSimilarity(left: string, right: string): number {
  const maximum = Math.max(left.length, right.length, 1);
  return Math.max(0, 1 - weightedPhoneticDistance(left, right) / maximum);
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = plain(left).split(" ").filter(Boolean);
  const rightTokens = plain(right).split(" ").filter(Boolean);
  if (!leftTokens.length || !rightTokens.length) return 0;
  const scoreDirection = (source: string[], target: string[]) => source.reduce((sum, token) => {
    const key = phoneticKey(token);
    const best = Math.max(...target.map((candidate) => directSimilarity(key, phoneticKey(candidate))));
    return sum + best;
  }, 0) / source.length;
  return Math.min(scoreDirection(leftTokens, rightTokens), scoreDirection(rightTokens, leftTokens));
}

export interface SpokenSimilarity {
  score: number;
  direct: number;
  phonetic: number;
  token: number;
  exact: boolean;
}

export function spokenSimilarity(spoken: string, expected: string): SpokenSimilarity {
  const normalizedSpoken = plain(spoken);
  const normalizedExpected = plain(expected);
  const cacheKey = `${normalizedSpoken}\u0000${normalizedExpected}`;
  const cached = SIMILARITY_CACHE.get(cacheKey);
  if (cached) return cached;
  if (!normalizedSpoken || !normalizedExpected) {
    return { score: 0, direct: 0, phonetic: 0, token: 0, exact: false };
  }
  if (normalizedSpoken === normalizedExpected) {
    const exact = { score: 1, direct: 1, phonetic: 1, token: 1, exact: true };
    SIMILARITY_CACHE.set(cacheKey, exact);
    return exact;
  }

  const direct = directSimilarity(normalizedSpoken, normalizedExpected);
  const phonetic = directSimilarity(phoneticKey(normalizedSpoken), phoneticKey(normalizedExpected));
  const token = tokenSimilarity(normalizedSpoken, normalizedExpected);
  const containment = normalizedSpoken.length >= 4 && normalizedExpected.length >= 4 &&
    (normalizedSpoken.includes(normalizedExpected) || normalizedExpected.includes(normalizedSpoken)) ? 0.82 : 0;
  const score = Math.max(
    direct * 0.58 + phonetic * 0.42,
    token * 0.55 + phonetic * 0.45,
    containment,
  );
  const result = {
    score: Number(Math.max(0, Math.min(1, score)).toFixed(4)),
    direct: Number(direct.toFixed(4)),
    phonetic: Number(phonetic.toFixed(4)),
    token: Number(token.toFixed(4)),
    exact: false,
  };
  if (SIMILARITY_CACHE.size >= 20_000) SIMILARITY_CACHE.delete(SIMILARITY_CACHE.keys().next().value!);
  SIMILARITY_CACHE.set(cacheKey, result);
  return result;
}

export function minimumSimilarityForAlias(alias: string): number {
  const compactLength = plain(alias).replace(/\s/g, "").length;
  if (compactLength <= 3) return 0.93;
  if (compactLength <= 5) return 0.82;
  if (compactLength <= 8) return 0.76;
  return 0.71;
}
