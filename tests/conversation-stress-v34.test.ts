import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import { InterpretRequestSchema } from "@/src/domain/schemas";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";
import { buildMenuAnswer } from "@/src/order-understanding/menu-question";
import { routeIntent } from "@/src/order-understanding/intent-router";

function interpretWithContext(text: string, contextProductIds: string[]) {
  return interpretDeterministically(InterpretRequestSchema.parse({
    tenantId: demoMenu.tenantId,
    tableId: "TABLE-12",
    tableLabel: "Table 12",
    waiterId: "stress-test",
    source: "audio",
    engine: "deterministic",
    turns: [{ speaker: "customer", text }],
    contextProductIds,
  }), demoMenu);
}

describe("natural multilingual follow-up stress corpus", () => {
  const acceptancePhrases = [
    "Doe mij die dan maar",
    "Dan pak ik die",
    "Vooruit, geef die maar",
    "Oké, die is goed",
    "Ik zal die nemen",
    "Dat klinkt goed, doe maar",
    "Ja, geef me dat",
    "Die mag je brengen",
    "We zullen die proberen",
    "Eentje daarvan graag",
    "Doe mij dieje maar",
    "Paktem maar",
    "Schrijf da maar op",
    "Kzal die pakken",
    "Doe ma",
    "I'll take that one",
    "That sounds good, I'll have it",
    "Yes, bring me that",
    "I'll go with that",
    "One of those please",
    "Je vais prendre ça",
    "Donnez-moi celui-là",
    "D'accord, celui-là",
    "Oui, je le prends",
    "On va prendre ça",
  ];

  for (const text of acceptancePhrases) {
    it(`orders the sole offered product from: ${text}`, () => {
      const draft = interpretWithContext(text, ["POS-2001"]);
      expect(draft.lines).toMatchObject([{ productId: "POS-2001", quantity: 1 }]);
      expect(draft.issues).toHaveLength(0);
    });
  }

  const questionPhrases = [
    "Welke voorgerechten hebben jullie?",
    "Zeg eens, wa hemme jullie als voorgerecht?",
    "Wat kan nen mens hier drinken?",
    "Waaruit kan ik kiezen voor een voorgerecht?",
    "Hebt ge iets om te starten?",
    "Wat staat er van vooraf op de kaart?",
    "Could you tell me the starters?",
    "What can we have as a starter?",
    "What drinks are available?",
    "Qu'est-ce que vous avez comme entrée?",
    "Vous avez quoi comme entrées?",
    "Que proposez-vous comme entrée?",
  ];

  for (const text of questionPhrases) {
    it(`recognizes and answers the menu question: ${text}`, () => {
      expect(routeIntent(text, { menu: demoMenu }).intent).toMatch(/question/);
      const answer = buildMenuAnswer(text, demoMenu);
      expect(answer?.message).toBeTruthy();
      expect(answer?.productIds.length).toBeGreaterThan(0);
    });
  }

  const storyPhrases = [
    "Mijn nonkel heeft gisteren drie Duvel gedronken",
    "Leffe doet me denken aan onze vakantie",
    "We maakten vroeger grappen over Stella",
    "Hij heet toevallig Duvel, grappige naam",
    "I told my friend a story about Belgian beer",
    "On parlait de Duvel hier soir",
  ];

  for (const text of storyPhrases) {
    it(`does not mutate the order for conversational background: ${text}`, () => {
      const draft = interpretWithContext(text, []);
      expect(draft.lines).toHaveLength(0);
    });
  }
});
