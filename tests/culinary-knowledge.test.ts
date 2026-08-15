import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import {
  CULINARY_SPEECH_FORMS,
  culinaryAdviceForText,
  culinaryKnowledgeStats,
  recognizeCulinaryConcepts,
} from "@/src/knowledge/culinary-knowledge";
import { customer, interpret } from "@/tests/helpers";
import { rankSpeechHypotheses } from "@/src/speech/recognition-ranker";

const SPREAD_REGRESSION_CASES = Array.from({ length: 600 }, (_, index) =>
  CULINARY_SPEECH_FORMS[Math.floor(index * CULINARY_SPEECH_FORMS.length / 600)],
);

describe("multilingual culinary knowledge", () => {
  it("contains more than one thousand acoustic aliases and speech forms", () => {
    expect(culinaryKnowledgeStats.concepts).toBeGreaterThanOrEqual(120);
    expect(culinaryKnowledgeStats.acousticAliases).toBeGreaterThanOrEqual(1_000);
    expect(culinaryKnowledgeStats.speechForms).toBeGreaterThanOrEqual(3_000);
  });

  it.each(SPREAD_REGRESSION_CASES)("recognizes $conceptId from $language speech: $text", ({ conceptId, text }) => {
    expect(recognizeCulinaryConcepts(text).map((mention) => mention.concept.id)).toContain(conceptId);
  });

  it.each([
    ["Ik wil kabeljauw", "cod"],
    ["Can I have cod?", "cod"],
    ["Je voudrais du cabillaud", "cod"],
    ["Voor mij een zeeduivel", "monkfish"],
    ["I would like mushroom risotto", "mushroom-risotto"],
    ["Pour moi une tarte au citron", "lemon-tart"],
  ])("understands a requested concept outside the POS: %s", (spoken, conceptId) => {
    expect(recognizeCulinaryConcepts(spoken)[0]?.concept.id).toBe(conceptId);
  });

  it("suggests only active same-family POS alternatives without ordering one", () => {
    const advice = culinaryAdviceForText("Ik neem graag kabeljauw", demoMenu);
    expect(advice?.requested.id).toBe("cod");
    expect(advice?.alternatives.map((product) => product.id)).toEqual(expect.arrayContaining(["POS-3003", "POS-3005"]));
    expect(advice?.alternatives.map((product) => product.id)).not.toContain("POS-3101");
    expect(advice?.message).toContain("deze week: zalm");

    const draft = interpret([customer("Ik neem graag kabeljauw")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{
      type: "unresolved_product",
      blocking: true,
      productCandidates: expect.arrayContaining([
        expect.objectContaining({ productId: "POS-3003" }),
        expect.objectContaining({ productId: "POS-3005" }),
      ]),
    }]);
  });

  it("does not call an active weekly salmon product unavailable", () => {
    expect(culinaryAdviceForText("Ik wil graag zalm", demoMenu)).toBeUndefined();
  });

  it("does not turn an unrelated story into waiter advice", () => {
    expect(culinaryAdviceForText("Mijn nonkel vertelde gisteren een verhaal over kabeljauw", demoMenu)).toBeUndefined();
  });

  it("does not prefer a menu hallucination over a clearer out-of-menu dish", () => {
    const ranked = rankSpeechHypotheses([
      { text: "Ik neem kabeljauw", acousticConfidence: 0.9 },
      { text: "Ik neem zalm", acousticConfidence: 0.62 },
    ], demoMenu);
    expect(ranked[0].text).toBe("Ik neem kabeljauw");
    expect(ranked[0].knowledgeScore).toBeGreaterThan(0);
  });
});
