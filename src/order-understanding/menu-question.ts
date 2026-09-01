import type { MenuProduct, TenantMenu } from "@/src/domain/schemas";
import { routeIntent, type ConversationIntent } from "@/src/order-understanding/intent-router";
import { findProductMentions, normalizeSpoken } from "@/src/semantic-menu/matcher";
import { isOrderableProduct } from "@/src/semantic-menu/product-index";

function euro(cents: number): string {
  return `€${(cents / 100).toFixed(2).replace(".", ",")}`;
}

function listProducts(products: MenuProduct[]): string {
  return products.map((product) => `${product.canonicalName} (${euro(product.priceCents)})`).join(", ");
}

function uniqueProducts(products: MenuProduct[]): MenuProduct[] {
  return [...new Map(products.map((product) => [product.id, product])).values()];
}

function mentionedProducts(text: string, menu: TenantMenu): MenuProduct[] {
  return uniqueProducts(findProductMentions(text, menu).flatMap((mention) => mention.candidates));
}

function productsForSubject(text: string, menu: TenantMenu): { subject: string; products: MenuProduct[] } {
  const normalized = normalizeSpoken(text);
  const active = menu.products.filter(isOrderableProduct);
  if (/alcoholvrij|alcohol free|sans alcool|0\.0|zero/.test(normalized) && /bier|beer|biere/.test(normalized)) return { subject: "alcoholvrije bieren", products: active.filter((product) => product.category === "Alcohol-free beer") };
  if (/\b(bier|bieren|beer|beers|biere|bieres|dieren)\b/.test(normalized)) return { subject: "bieren", products: active.filter((product) => product.category.toLowerCase().includes("beer")) };
  if (/\b(wijn|wijnen|wine|wines|vin|vins)\b/.test(normalized)) return { subject: "wijnen", products: active.filter((product) => product.category === "Wine") };
  if (/\b(frisdrank|frisdranken|soft drink|soft drinks|cola)\b/.test(normalized)) return { subject: "frisdranken", products: active.filter((product) => product.category === "Soft drinks") };
  if (/\b(cocktail|cocktails|gin tonic)\b/.test(normalized)) return { subject: "cocktails", products: active.filter((product) => product.category === "Cocktails") };
  if (/\b(koffie|coffee|cafe|warme dranken|hot drinks)\b/.test(normalized)) return { subject: "warme dranken", products: active.filter((product) => product.category === "Hot drinks") };
  if (/\b(dessert|desserts|nagerecht|nagerechten)\b/.test(normalized)) return { subject: "desserts", products: active.filter((product) => product.category === "Desserts") };
  if (/\b(voorgerecht|voorgerechten|starter|starters|starten|vooraf|entree|entrees)\b/.test(normalized)) return { subject: "voorgerechten", products: active.filter((product) => product.category === "Starters") };
  if (/\b(hoofdgerecht|hoofdgerechten|gerecht|gerechten|main|mains)\b/.test(normalized)) return { subject: "hoofdgerechten", products: active.filter((product) => product.category === "Mains") };
  if (/\b(drink|drinks|drank|dranken|drinken|boire|boisson|boissons)\b/.test(normalized)) return { subject: "dranken", products: active.filter((product) => product.defaultCourse === "drinks") };
  return { subject: "producten", products: mentionedProducts(text, menu) };
}

export interface MenuAnswer {
  intent: ConversationIntent;
  message: string;
  productIds: string[];
}

export function productsForMenuQuestion(text: string, menu: TenantMenu): MenuProduct[] {
  const route = routeIntent(text, { menu });
  if (!["menu_question", "availability_question", "price_question", "ingredient_question", "recommendation_question"].includes(route.intent)) return [];
  return uniqueProducts(productsForSubject(text, menu).products);
}

export function buildMenuAnswer(text: string, menu: TenantMenu, contextProductIds: string[] = []): MenuAnswer | undefined {
  const route = routeIntent(text, { menu });
  if (!["menu_question", "availability_question", "price_question", "ingredient_question", "recommendation_question"].includes(route.intent)) return undefined;
  const normalized = normalizeSpoken(text);
  const active = menu.products.filter(isOrderableProduct);
  const mentioned = mentionedProducts(text, menu);
  const contextual = contextProductIds
    .map((productId) => active.find((product) => product.id === productId))
    .filter((product): product is MenuProduct => Boolean(product));
  const refersToContext = /\b(?:die|dat|deze|daarvan|daarin|erin|de blonde|de tweede|de eerste)\b/.test(normalized);
  const referenced = mentioned.length ? mentioned : refersToContext ? contextual : [];
  const subject = productsForSubject(text, menu);
  let products = subject.products;
  let message: string;

  if (route.intent === "price_question") {
    products = referenced.length ? referenced : subject.products;
    message = products.length ? products.map((product) => `${product.canonicalName} kost ${euro(product.priceCents)}`).join(". ") + "." : "Van welk product wil je de prijs weten?";
  } else if (route.intent === "ingredient_question") {
    products = referenced;
    message = products.length
      ? products.map((product) => `${product.canonicalName}: ${product.allergenCodes.length ? product.allergenCodes.join(", ") : "geen geregistreerde allergenen"}. Controleer allergieën altijd bij de keuken`).join(". ") + "."
      : "Voor welk gerecht wil je ingrediënten of allergenen controleren?";
  } else if (route.intent === "recommendation_question") {
    products = [...(contextual.length ? contextual : products.length ? products : active)].sort((left, right) => left.priceCents - right.priceCents).slice(0, 3);
    message = products.length ? `Als suggestie kan ik ${products.map((product) => product.canonicalName).join(", ")} tonen. Jij kiest zelf wat passend is.` : "Ik vond geen actief product om aan te raden.";
  } else if (route.intent === "availability_question" && referenced.length) {
    products = referenced;
    message = products.map((product) => `${product.canonicalName} is beschikbaar voor ${euro(product.priceCents)}`).join(". ") + ".";
  } else if (products.length) {
    message = `Onze ${subject.subject}: ${listProducts(products)}.`;
  } else if (/wat (hebben|heb je|hebben jullie)|what do you have/.test(normalized)) {
    message = `Je kunt kiezen uit: ${[...new Set(active.map((product) => product.category))].join(", ")}. Vraag gerust naar een categorie.`;
  } else {
    message = "Ik vond voor die vraag geen actief product in het kassamenu.";
  }
  return { intent: route.intent, message, productIds: products.slice(0, 12).map((product) => product.id) };
}

export function answerMenuQuestion(text: string, menu: TenantMenu): string | undefined {
  return buildMenuAnswer(text, menu)?.message;
}
