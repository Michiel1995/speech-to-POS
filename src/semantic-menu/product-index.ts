import type { MenuProduct, TenantMenu } from "@/src/domain/schemas";

function simpleNormalize(value: string): string {
  return value.toLocaleLowerCase("nl-BE").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
}

const productAliasCache = new WeakMap<MenuProduct, string[]>();
const productSourceAliasCache = new WeakMap<MenuProduct, string[]>();

export function automaticPronunciationVariants(value: string): string[] {
  const normalized = simpleNormalize(value);
  if (!normalized) return [];
  const baseVariants = [
    normalized,
    normalized.replace(/v/g, "f"),
    normalized.replace(/f/g, "v"),
    normalized.replace(/b/g, "p"),
    normalized.replace(/d\b/g, "t"),
    normalized.replace(/z/g, "s"),
    normalized.replace(/g/g, "ch"),
    normalized.replace(/ch/g, "g"),
    normalized.replace(/ij/g, "ei"),
    normalized.replace(/c/g, "k"),
    normalized.replace(/qu/g, "k"),
    normalized.replace(/ou/g, "au"),
    normalized.replace(/au/g, "ou"),
    normalized.replace(/([aeiou])n\b/g, "$1"),
    normalized.replace(/e\b/g, ""),
    normalized.replace(/\b([a-z]{5,})e\b/g, "$1"),
    normalized.replace(/\s+/g, ""),
  ];
  return [...new Set(baseVariants)].filter((variant) => variant.length >= 3).slice(0, 12);
}

export function productSourceAliases(product: MenuProduct): string[] {
  const cached = productSourceAliasCache.get(product);
  if (cached) return cached;
  const sources = [
    product.canonicalName,
    product.posName,
    product.sku,
    product.brand,
    product.productType,
    product.variant,
    product.sizeLabel,
    ...product.aliases,
    ...(product.regionalAliases ?? []),
    ...(product.phoneticAliases ?? []),
  ].filter((value): value is string => Boolean(value));
  const aliases = [...new Set(sources)].slice(0, 40);
  productSourceAliasCache.set(product, aliases);
  return aliases;
}

export function semanticProductAliases(product: MenuProduct): string[] {
  const cached = productAliasCache.get(product);
  if (cached) return cached;
  const sources = productSourceAliases(product);
  const aliases = [...new Set([
    ...sources,
    ...sources.slice(0, 12).flatMap(automaticPronunciationVariants),
  ])].slice(0, 96);
  productAliasCache.set(product, aliases);
  return aliases;
}

export function isOrderableProduct(product: MenuProduct): boolean {
  return product.active && (product.availability ?? "available") === "available";
}

export interface ProductAliasCollision {
  alias: string;
  productIds: string[];
}

export function detectProductAliasCollisions(menu: TenantMenu): ProductAliasCollision[] {
  const byAlias = new Map<string, Set<string>>();
  for (const product of menu.products.filter(isOrderableProduct)) {
    for (const alias of semanticProductAliases(product)) {
      const normalized = simpleNormalize(alias);
      byAlias.set(normalized, (byAlias.get(normalized) ?? new Set()).add(product.id));
    }
  }
  return [...byAlias.entries()].filter(([, productIds]) => productIds.size > 1).map(([alias, productIds]) => ({ alias, productIds: [...productIds] }));
}
