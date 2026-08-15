import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import { normalizeFlemish } from "@/src/language/flemish-dialect";
import { routeIntent, routeUtterance, type ConversationIntent } from "@/src/order-understanding/intent-router";

interface IntentCase {
  text: string;
  expected: ConversationIntent;
  hasOrder?: boolean;
  hasContext?: boolean;
}

const baseCases: IntentCase[] = [
  { text: "Ik neem een Duvel", expected: "order" }, { text: "Voor mij een steak", expected: "order" }, { text: "Doe mij een pintje", expected: "order" }, { text: "Twee Stella graag", expected: "order" },
  { text: "Doe er nog een Stella bij", expected: "addition", hasOrder: true }, { text: "Nog een Duvel", expected: "addition", hasOrder: true }, { text: "Voor mij ook een cola", expected: "addition", hasOrder: true }, { text: "Voeg een koffie toe", expected: "addition", hasOrder: true },
  { text: "Ik hoef de Duvel niet", expected: "removal", hasOrder: true }, { text: "Laat dat pintje maar zitten", expected: "removal", hasOrder: true }, { text: "Verwijder de koffie", expected: "removal", hasOrder: true }, { text: "Geen Stella meer", expected: "removal", hasOrder: true },
  { text: "Vervang cola door cola zero", expected: "replacement", hasOrder: true }, { text: "Doe cola zero in plaats van cola", expected: "replacement", hasOrder: true }, { text: "Verander de Duvel naar Stella", expected: "replacement", hasOrder: true }, { text: "Replace Coke with Coke Zero", expected: "replacement", hasOrder: true },
  { text: "Nee wacht, één Stella", expected: "correction", hasOrder: true }, { text: "Ik bedoel twee Duvel", expected: "correction", hasOrder: true }, { text: "Sorry, maak er drie van", expected: "correction", hasOrder: true }, { text: "Eigenlijk toch liever Stella", expected: "correction", hasOrder: true },
  { text: "Welke bieren hebben jullie", expected: "menu_question" }, { text: "Wat hebben jullie van bier", expected: "menu_question" }, { text: "En welke voorgerechten", expected: "menu_question" }, { text: "Welke daarvan is alcoholvrij", expected: "menu_question", hasContext: true },
  { text: "Zijn er nog Duvels", expected: "availability_question" }, { text: "Hebben jullie Leffe Blond", expected: "availability_question" }, { text: "Is er nog cola zero", expected: "availability_question" }, { text: "Wa hedde van bier", expected: "menu_question" },
  { text: "Hoeveel kost die", expected: "price_question", hasContext: true }, { text: "Wat kost een Duvel", expected: "price_question" }, { text: "Welke prijs heeft de steak", expected: "price_question" }, { text: "How much is the Stella", expected: "price_question" },
  { text: "Wat zit daarin", expected: "ingredient_question", hasContext: true }, { text: "Welke allergenen zitten in de steak", expected: "ingredient_question" }, { text: "Bevat de vol-au-vent gluten?", expected: "ingredient_question" }, { text: "What is in the shrimp croquettes?", expected: "ingredient_question" },
  { text: "Welke raad je aan", expected: "recommendation_question" }, { text: "Wat kun je aanbevelen", expected: "recommendation_question" }, { text: "Wat is het populairste bier", expected: "recommendation_question" }, { text: "Recommend a dessert", expected: "recommendation_question" },
  { text: "Ja", expected: "answer" }, { text: "Jazeker", expected: "answer" }, { text: "Ok graag", expected: "answer" }, { text: "Oui", expected: "answer" },
  { text: "Nee", expected: "refusal" }, { text: "Neen liever niet", expected: "refusal" }, { text: "Non merci", expected: "refusal" }, { text: "Laat maar", expected: "refusal" },
  { text: "Mijn nonkel drinkt altijd Duvel", expected: "non_order" }, { text: "Gisteren droomde ik van Stella", expected: "non_order" }, { text: "Dat was maar een mop over cola", expected: "non_order" }, { text: "Mijn zus heet Stella", expected: "non_order" },
  { text: "Misschien later", expected: "unclear" }, { text: "Dat ding daar", expected: "unclear" }, { text: "We zien wel", expected: "unclear" }, { text: "Hmm misschien", expected: "unclear" },
];

const cases = baseCases.flatMap((entry, index) => [entry, { ...entry, text: `${entry.text}${index % 2 ? "." : "!"}` }]);

describe("Service Ears 2.0 intent router corpus", () => {
  it.each(cases)("routes '$text' as $expected", ({ text, expected, hasOrder, hasContext }) => {
    expect(routeIntent(text, { menu: demoMenu, hasOrder, hasContext }).intent).toBe(expected);
  });

  it("splits a question and an order into distinct intentions", () => {
    const routes = routeUtterance("Welke bieren hebben jullie? Doe mij daarna een Duvel.", { menu: demoMenu });
    expect(routes.map((route) => route.intent)).toEqual(["menu_question", "order"]);
  });

  it("normalizes required Flemish contractions without changing product names", () => {
    expect(normalizeFlemish("Awel, wa hedde? Khem goesting in ne Duvel.", "auto")).toContain("wat heb je");
    expect(normalizeFlemish("Awel, wa hedde? Khem goesting in ne Duvel.", "auto")).toContain("duvel");
  });
});
