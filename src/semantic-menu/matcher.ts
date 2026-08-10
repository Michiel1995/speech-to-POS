import type {
  MenuProduct,
  ModifierGroup,
  ModifierOption,
  TenantMenu,
} from "@/src/domain/schemas";

export function normalizeSpoken(value: string): string {
  return value
    .toLocaleLowerCase("nl-BE")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[’']/g, "'")
    .replace(/[-–—/]/g, " ")
    .replace(/[^a-z0-9\s'.]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

interface RawMatch<T> {
  start: number;
  end: number;
  alias: string;
  value: T;
}

export interface ProductMention {
  start: number;
  end: number;
  alias: string;
  candidates: MenuProduct[];
}

export interface ModifierMention {
  start: number;
  end: number;
  alias: string;
  group: ModifierGroup;
  option: ModifierOption;
}

function isBoundary(text: string, index: number): boolean {
  if (index <= 0 || index >= text.length) return true;
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
          matches.push({ start, end, alias, value: entry.value });
        }
        fromIndex = start + 1;
      }
    }
  }

  return matches;
}

export function findProductMentions(text: string, menu: TenantMenu): ProductMention[] {
  const raw = collectMatches(
    text,
    menu.products
      .filter((product) => product.active)
      .map((product) => ({
        aliases: [product.canonicalName, product.posName, ...product.aliases],
        value: product,
      })),
  ).sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);

  const selectedSpans: Array<{ start: number; end: number; alias: string }> = [];
  for (const match of raw) {
    const overlapsLonger = selectedSpans.some(
      (span) =>
        match.start >= span.start &&
        match.end <= span.end &&
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
    const candidates = [...new Map(sameSpan.map((match) => [match.value.id, match.value])).values()];
    uniqueSpans.set(key, { ...span, candidates });
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
      product.active &&
      [product.canonicalName, product.posName, ...product.aliases].some(
        (alias) => normalizeSpoken(alias) === normalized,
      ),
  );
  if (exact.length) return exact.slice(0, 5);

  const partial = menu.products
    .filter((product) => product.active)
    .map((product) => ({
      product,
      score: [product.canonicalName, product.posName, ...product.aliases].reduce(
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
  return partial.slice(0, 5);
}
