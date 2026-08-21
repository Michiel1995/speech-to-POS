import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import { DraftOrderSchema } from "@/src/domain/schemas";
import { MockPOSAdapter } from "@/src/pos/mock-adapter";
import { answerMenuQuestion } from "@/src/order-understanding/menu-question";
import { findProductMentions } from "@/src/semantic-menu/matcher";
import { validateDraft } from "@/src/validation/order-validator";
import { customer, interpret, interpretAudio, waiter } from "@/tests/helpers";

describe("deterministic hospitality order engine", () => {
  it("produces the complete core demo without duplicating waiter confirmation", () => {
    const draft = interpret([
      customer("Voor mij de steak saignant met frieten en pepersaus."),
      waiter("Dus steak saignant, frieten en pepersaus?"),
      customer("Ja."),
      customer("Voor mij de vol-au-vent met kroketten en twee Duvel."),
      customer("Nee wacht, één Duvel en doe er een Stella bij."),
    ]);

    expect(draft.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["POS-3001", 1],
      ["POS-3002", 1],
      ["POS-1001", 1],
      ["POS-1002", 1],
    ]);
    expect(draft.lines[0].modifiers.map((modifier) => modifier.optionId).sort()).toEqual([
      "MOD-FRIES",
      "MOD-PEPPER",
      "MOD-SAIGN",
    ]);
    expect(draft.lines[1].modifiers.map((modifier) => modifier.optionId)).toEqual(["MOD-CROQ"]);
    expect(draft.issues).toHaveLength(0);
  });

  it("returns unbiased Leffe choices and no guessed order line", () => {
    const draft = interpret([customer("Een Leffe.")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues[0].type).toBe("ambiguous_product");
    expect(draft.issues[0].productCandidates?.map((candidate) => candidate.productId)).toEqual([
      "POS-1003",
      "POS-1004",
      "POS-1005",
    ]);
  });

  it("never invents an unknown product", () => {
    const draft = interpret([customer("Voor mij een truffelpasta.")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{ type: "unresolved_product", blocking: true }]);
  });

  it("does not convert a product question into an order", () => {
    const draft = interpret([customer("Hebben jullie alcoholvrij bier?")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toHaveLength(0);
  });

  it("answers a beer catalog question from the active POS menu", () => {
    const answer = answerMenuQuestion("Welke bieren hebben jullie?", demoMenu);
    expect(answer).toContain("Duvel");
    expect(answer).toContain("Stella Artois");
    expect(answer).toContain("Leffe Blond");
    expect(answer).toContain("Leffe 0.0");
  });

  it("keeps prior order lines when a guest adds another item", () => {
    const first = interpret([customer("Een Duvel.")]);
    const second = interpret([customer("Doe er een Stella bij.")], first.lines);
    expect(second.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["POS-1001", 1],
      ["POS-1002", 1],
    ]);
  });

  it("keeps prior order lines while answering a menu question", () => {
    const first = interpret([customer("Een Duvel.")]);
    const second = interpret([customer("Welke bieren hebben jullie?")], first.lines);
    expect(second.lines).toMatchObject([{ productId: "POS-1001", quantity: 1 }]);
  });

  it.each([
    "Een voorgerecht is niet meer nodig.",
    "Het voorgerecht hoeft niet meer.",
    "Laat de starter maar vallen.",
    "Skip the starter.",
  ])("removes the sole existing starter through a natural course reference: %s", (spoken) => {
    const first = interpret([customer("Een garnaalkroket en een hamburger.")]);
    const corrected = interpret([customer(spoken)], first.lines);

    expect(corrected.lines.map((line) => line.productId)).toEqual(["POS-3006"]);
    expect(corrected.issues).toHaveLength(0);
  });

  it("treats 'heb je voor mij' with named products as an order, not an availability question", () => {
    const draft = interpret([customer("Heb je voor mij een pintje, een Duvel en een cola?")]);

    expect(draft.lines.map((line) => line.productId).sort()).toEqual(["POS-1001", "POS-1002", "POS-1101"]);
    expect(draft.issues).toHaveLength(0);
  });

  it("keeps a genuine 'heb je' availability question non-mutating", () => {
    const draft = interpret([customer("Heb je nog Duvel beschikbaar?")]);

    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toHaveLength(0);
  });

  it("applies an acoustic self-correction inside a compound spoken order", () => {
    const draft = interpret([customer(
      "Heb je voor mij een pinch, een duvel, een cola of in plaats van een pintje doen maar een tweede dubbele.",
    )]);

    expect(draft.lines.map((line) => [line.productId, line.quantity]).sort()).toEqual([
      ["POS-1001", 2],
      ["POS-1101", 1],
    ]);
    expect(draft.issues).toHaveLength(0);
  });

  it("adds only the final choice after spoken deliberation and keeps ambiguous wine visible", () => {
    const first = interpret([customer("Een garnaalkroket en een hamburger.")]);
    const corrected = interpretAudio([customer(
      "Wat zou ik erbij drinken? Misschien een cola of beter een pintje of een duvel goh of doe maar een glaasje witte wijn anders.",
    )], first.lines);

    expect(corrected.lines.map((line) => line.productId)).toEqual(["POS-2001", "POS-3006", "POS-1301"]);
    expect(corrected.lines.map((line) => line.productId)).not.toEqual(expect.arrayContaining(["POS-1101", "POS-1002", "POS-1001"]));
    expect(corrected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "speech_confirmation",
        blocking: true,
        productCandidates: expect.arrayContaining([
          expect.objectContaining({ productId: "POS-1301" }),
          expect.objectContaining({ productId: "POS-1302" }),
        ]),
      }),
    ]));
  });

  it.each([
    ["Misschien een cola, nee, doe maar een Duvel.", "POS-1001"],
    ["Ik twijfel tussen cola en Duvel. Uiteindelijk neem ik een Stella.", "POS-1002"],
    ["Maybe a Coke or a beer, actually I'll have a Duvel.", "POS-1001"],
    ["Peut etre un Coca ou une biere, finalement je prends un Duvel.", "POS-1001"],
  ])("keeps only the explicit final decision after deliberation: %s", (spoken, expectedProductId) => {
    const draft = interpret([customer(spoken)]);

    expect(draft.lines.map((line) => line.productId)).toEqual([expectedProductId]);
    expect(draft.issues).toHaveLength(0);
  });

  it.each([
    "Misschien een cola of een Duvel, ik weet het nog niet.",
    "Ik twijfel nog tussen een pintje en een Duvel.",
    "Maybe a Coke or a Duvel, I have not decided yet.",
  ])("does not order brainstormed alternatives without a final decision: %s", (spoken) => {
    const draft = interpret([customer(spoken)]);

    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{ type: "ambiguous_product", blocking: true }]);
  });

  it.each([
    "Een cola of een Duvel.",
    "Ik wil een cola of een Duvel.",
    "Doe maar een cola of een Duvel.",
  ])("asks for one choice instead of ordering every alternative: %s", (spoken) => {
    const draft = interpret([customer(spoken)]);

    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{
      type: "ambiguous_product",
      blocking: true,
      productCandidates: expect.arrayContaining([
        expect.objectContaining({ productId: "POS-1101" }),
        expect.objectContaining({ productId: "POS-1001" }),
      ]),
    }]);
  });

  it("maps common speech recognition variants to safe Leffe choices", () => {
    const generic = interpret([customer("Een leven.")]);
    expect(generic.lines).toHaveLength(0);
    expect(generic.issues[0]).toMatchObject({ type: "ambiguous_product" });
    expect(generic.issues[0].productCandidates?.map((candidate) => candidate.productId)).toEqual([
      "POS-1003",
      "POS-1004",
      "POS-1005",
    ]);

    const specific = interpret([customer("Een leven blond.")]);
    expect(specific.lines).toMatchObject([{ productId: "POS-1003", quantity: 1 }]);
  });

  it("does not turn an ordinary fuzzy word into a product", () => {
    const draft = interpret([customer("Ik wil een vraag stellen.")]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toHaveLength(0);
  });

  it("recovers the fries modifier from a joined local Whisper transcript", () => {
    const draft = interpret([customer("Ikneemene steak metfriaten en pepper sauce en twee duvel.")]);
    const steak = draft.lines.find((line) => line.productId === "POS-3001");
    expect(steak?.modifiers.map((modifier) => modifier.optionId)).toEqual(expect.arrayContaining(["MOD-FRIES", "MOD-PEPPER"]));
    expect(draft.lines).toEqual(expect.arrayContaining([expect.objectContaining({ productId: "POS-1001", quantity: 2 })]));
  });

  it.each([
    ["Een duivel graag.", "POS-1001"],
    ["Een stelle graag.", "POS-1002"],
    ["Een leven bruin.", "POS-1004"],
    ["Een coca colla zero.", "POS-1102"],
    ["Een koffi.", "POS-4001"],
    ["Een vol au van met frieten.", "POS-3002"],
  ])("maps curated restaurant speech variant %s to %s", (spoken, productId) => {
    const draft = interpret([customer(spoken)]);
    expect(draft.lines).toMatchObject([{ productId, quantity: 1 }]);
  });

  it.each([
    ["Een stela graag.", "POS-1002"],
    ["Een lefe bruin.", "POS-1004"],
    ["Een coka cola zero.", "POS-1102"],
    ["Een kofie.", "POS-4001"],
    ["Een vol au fen met frieten.", "POS-3002"],
  ])("maps unlisted fuzzy variant %s to %s with a review warning", (spoken, productId) => {
    const draft = interpret([customer(spoken)]);
    expect(draft.lines).toMatchObject([{ productId, quantity: 1 }]);
    expect(draft.warnings).toMatchObject([{ type: "free_text_note" }]);
  });

  it.each([
    "Duvel is lekker.",
    "Mijn zus heet Stella.",
    "Ik neem geen Duvel.",
    "We hebben Leffe Blond.",
    "Ik wil een vraag stellen.",
  ])("does not order a product from non-order statement: %s", (spoken) => {
    const draft = interpret([customer(spoken)]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toHaveLength(0);
  });

  it("answers a misrecognized beer-category question without ordering anything", () => {
    const draft = interpret([customer("Welke dieren hebben jullie?")]);
    expect(draft.lines).toHaveLength(0);
    expect(answerMenuQuestion("Welke dieren hebben jullie?", demoMenu)).toContain("Leffe Blond");
  });

  it("orders a specific product after a question", () => {
    const draft = interpret([
      customer("Hebben jullie alcoholvrij bier?"),
      waiter("We hebben Leffe 0.0."),
      customer("Dan neem ik de alcoholvrije Leffe."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1005", quantity: 1 }]);
  });

  it.each([
    "Geef me de Duvel maar.",
    "Breng mij een Duvel.",
    "Ik wil de Duvel.",
    "Wij kiezen de Duvel.",
  ])("adds an explicitly named product from a natural request: %s", (spoken) => {
    const draft = interpret([customer(spoken)], undefined, ["POS-1001", "POS-1002", "POS-1003"]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1001", quantity: 1 }]);
    expect(draft.issues).toHaveLength(0);
  });

  it("resolves ‘die’ to the single product just offered by the waiter", () => {
    const draft = interpret([
      customer("Welke voorgerechten hebben jullie?"),
      waiter("Momenteel enkel garnaalkroketten."),
      customer("Geef me die maar."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-2001", quantity: 1 }]);
    expect(draft.issues).toHaveLength(0);
  });

  it("keeps product-only context between separate voice turns", () => {
    const draft = interpret(
      [customer("Geef me die maar.")],
      undefined,
      ["POS-2001"],
    );
    expect(draft.lines).toMatchObject([{ productId: "POS-2001", quantity: 1 }]);
  });

  it.each([
    "Doe het maar.",
    "Pak maar.",
    "Ja graag.",
    "Dat is prima.",
    "Geef het maar.",
    "Yes please.",
    "Je prends celle-là.",
    "Oui volontiers.",
    // Typical short-ASR wording in a noisy room: context makes this safe
    // because exactly one starter was offered.
    "Ja die mag.",
    "Goed doe maar.",
  ])("turns a short selection into the sole offered starter: %s", (spoken) => {
    const draft = interpret([customer(spoken)], undefined, ["POS-2001"]);
    expect(draft.lines).toMatchObject([{ productId: "POS-2001", quantity: 1 }]);
    expect(draft.issues).toHaveLength(0);
  });

  it.each([
    "Misschien toch niet.",
    "Welke is dat?",
    "Nee laat maar.",
    "Ik weet het nog niet.",
  ])("does not turn a negative or questioning follow-up into an order: %s", (spoken) => {
    const draft = interpret([customer(spoken)], undefined, ["POS-2001"]);
    expect(draft.lines).toHaveLength(0);
  });

  it("asks for clarification when ‘die’ can refer to several offered products", () => {
    const draft = interpret(
      [customer("Doe die maar.")],
      undefined,
      ["POS-1001", "POS-1002"],
    );
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{
      type: "ambiguous_product",
      blocking: true,
      productCandidates: [{ productId: "POS-1001" }, { productId: "POS-1002" }],
    }]);
  });

  it("can infer the sole starter directly from a question and vague follow-up", () => {
    const draft = interpret([
      customer("Welke voorgerechten hebben jullie?"),
      customer("Dat klinkt goed, doe maar."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-2001", quantity: 1 }]);
  });

  it("uses a descriptor to select one product from broader question context", () => {
    const draft = interpret([
      customer("Welke bieren hebben jullie?"),
      customer("De alcoholvrije graag."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1005", quantity: 1 }]);
  });

  it("does not guess from a vague follow-up when several context products remain", () => {
    const draft = interpret([
      customer("Welke bieren hebben jullie?"),
      customer("Doe maar."),
    ]);
    expect(draft.lines).toHaveLength(0);
    expect(draft.issues).toMatchObject([{ type: "ambiguous_product", blocking: true }]);
  });

  it("keeps jokes and stories separate from the actual order clause", () => {
    const draft = interpret([
      customer("Mijn nonkel vertelt altijd een mop over Duvel. Voor mij een Stella."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1002", quantity: 1 }]);
  });

  it("does not order products merely mentioned inside a story", () => {
    const draft = interpret([
      customer("Een Duvel en een Stella zitten samen op café in een lang verhaal."),
    ]);
    expect(draft.lines).toHaveLength(0);
  });

  it("retains safe menu context while ignoring an interleaved joke", () => {
    const draft = interpret(
      [
        customer("Mijn nonkel maakt altijd een mop over Duvel."),
        customer("Dat ziet er goed uit, geef me die maar."),
      ],
      undefined,
      ["POS-2001"],
    );
    expect(draft.lines).toMatchObject([{ productId: "POS-2001", quantity: 1 }]);
  });

  it("understands ‘dezelfde’ as another of the most recently ordered product", () => {
    const first = interpret([customer("Een Duvel en een Stella.")]);
    expect(findProductMentions("Een Duvel.", demoMenu).map((mention) => [mention.alias, mention.candidates.map((candidate) => candidate.id)])).toEqual([
      ["een duvel", ["POS-1001"]],
    ]);
    expect(findProductMentions("Een Duvel en een Stella.", demoMenu).map((mention) => [
      mention.alias,
      mention.candidates.map((candidate) => candidate.id),
    ])).toEqual([
      ["een duvel", ["POS-1001"]],
      ["stella", ["POS-1002"]],
    ]);
    expect(first.lines.map((line) => [line.productId, line.quantity])).toEqual([
      ["POS-1001", 1],
      ["POS-1002", 1],
    ]);
    const repeated = interpret(
      [customer("Voor mij nog dezelfde.")],
      first.lines,
      ["POS-1001", "POS-1002", "POS-1003"],
    );
    expect(repeated.lines).toMatchObject([
      { productId: "POS-1001", quantity: 1 },
      { productId: "POS-1002", quantity: 2 },
    ]);
  });

  it("can cancel the most recently ordered line as ‘de vorige’", () => {
    const first = interpret([customer("Een Duvel en een Stella.")]);
    const corrected = interpret([customer("De vorige toch niet.")], first.lines);
    expect(corrected.lines).toMatchObject([{ productId: "POS-1001", quantity: 1 }]);
  });

  it("handles mixed-language modifiers", () => {
    const draft = interpret([customer("Voor mij de steak medium rare with fries en béarnaise.")]);
    expect(draft.lines[0].modifiers.map((modifier) => modifier.optionId).sort()).toEqual([
      "MOD-BEARN",
      "MOD-FRIES",
      "MOD-MRARE",
    ]);
    expect(draft.issues).toHaveLength(0);
  });

  it("surfaces required modifiers instead of filling defaults", () => {
    const draft = interpret([customer("Een steak.")]);
    expect(draft.issues.filter((issue) => issue.type === "missing_modifier")).toHaveLength(2);
  });

  it("applies an accepted waiter suggestion once", () => {
    const draft = interpret([
      customer("Voor mij een steak saignant."),
      waiter("Ik zet daar frieten bij, goed?"),
      customer("Ja"),
    ]);
    expect(draft.lines).toHaveLength(1);
    expect(draft.lines[0].modifiers.map((modifier) => modifier.optionId)).toContain("MOD-FRIES");
  });

  it("replaces a spoken correction rather than adding a second line", () => {
    const draft = interpret([
      customer("Een cola."),
      customer("Verander die cola naar cola zero."),
    ]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1102", quantity: 1 }]);
  });

  it.each([
    "In plaats van het voorgerecht een hamburger bestellen.",
    "Vervang het voorgerecht door een hamburger.",
    "In plaats van de garnaalkroketten wil ik een burger.",
    "Doe de garnaalkroketten weg en geef mij een hamburger.",
    "Ik wil toch liever een hamburger dan de garnaalkroketten.",
    "Wissel het voorgerecht voor een hamburger.",
    "Maak daar een hamburger van.",
    "Het voorgerecht hoeft toch niet meer, doe mij een hamburger.",
    "Geen voorgerecht meer, wel een hamburger.",
    "Replace the starter with a hamburger.",
    "Instead of the starter I will have a hamburger.",
    "Swap the starter for a hamburger.",
    "Skip the starter, I'll take a hamburger instead.",
    "Remplacez l'entree par un hamburger.",
    "A la place de l'entree je prends un hamburger.",
    "Pas l'entree, je prends un hamburger plutot.",
  ])("replaces the existing starter with a hamburger in a natural conversation: %s", (spoken) => {
    const first = interpret([customer("Een garnaalkroket graag.")]);
    const corrected = interpret([customer(spoken)], first.lines);

    expect(corrected.lines).toMatchObject([{ productId: "POS-3006", quantity: 1 }]);
    expect(corrected.lines).toHaveLength(1);
    expect(corrected.issues).toHaveLength(0);
  });

  it("does not add a replacement when the referenced course is absent", () => {
    const first = interpret([customer("Een Duvel graag.")]);
    const corrected = interpret([customer("Vervang het voorgerecht door een hamburger.")], first.lines);

    expect(corrected.lines.map((line) => line.productId)).toEqual(["POS-1001"]);
    expect(corrected.issues).toMatchObject([{ type: "unresolved_product", blocking: true }]);
  });

  it("keeps the old line when the requested replacement is not on the active menu", () => {
    const first = interpret([customer("Een garnaalkroket graag.")]);
    const corrected = interpret([customer("Vervang het voorgerecht door een kreeftenpasta.")], first.lines);

    expect(corrected.lines.map((line) => line.productId)).toEqual(["POS-2001"]);
    expect(corrected.issues).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "unresolved_product", blocking: true }),
    ]));
  });

  it("asks which line to replace when several lines occupy the referenced course", () => {
    const first = interpret([customer("Een garnaalkroket en een hamburger graag.")]);
    const priorLines = first.lines.map((line) => ({ ...line, course: "starter" as const }));
    const corrected = interpret([customer("Vervang het voorgerecht door een koffie.")], priorLines);

    expect(corrected.lines.map((line) => line.productId).sort()).toEqual(["POS-2001", "POS-3006"]);
    expect(corrected.issues).toMatchObject([{ type: "ambiguous_removal", blocking: true }]);
  });

  it("removes a cancelled item before submission", () => {
    const draft = interpret([
      customer("Een koffie."),
      customer("Laat die koffie toch maar vallen."),
    ]);
    expect(draft.lines).toHaveLength(0);
  });

  it.each([
    "Ik hoef misschien toch geen Duvel.",
    "Toch geen Duvel meer.",
    "Doe de Duvel toch maar niet.",
    "De Duvel hoef ik niet meer.",
  ])("removes an existing product from a natural cancellation: %s", (spoken) => {
    const first = interpret([customer("Een Duvel.")]);
    const corrected = interpret([customer(spoken)], first.lines);
    expect(corrected.lines).toHaveLength(0);
    expect(corrected.issues).toHaveLength(0);
  });

  it("understands a speech variant when cancelling a pint", () => {
    const first = interpret([customer("Een pintje.")]);
    const corrected = interpret([customer("Laat dat pinte maar zitten.")], first.lines);
    expect(corrected.lines).toHaveLength(0);
  });

  it("decrements an explicit quantity instead of removing the whole line", () => {
    const first = interpret([customer("Drie Duvel.")]);
    const corrected = interpret([customer("Haal één Duvel weg.")], first.lines);
    expect(corrected.lines).toMatchObject([{ productId: "POS-1001", quantity: 2 }]);
  });

  it("changes a sole contextual line with a quantity-only correction", () => {
    const first = interpret([customer("Een Duvel.")]);
    expect(interpret([customer("Maak er drie van.")], first.lines).lines).toMatchObject([{ productId: "POS-1001", quantity: 3 }]);
    expect(interpret([customer("Doe er nog twee bij.")], first.lines).lines).toMatchObject([{ productId: "POS-1001", quantity: 3 }]);
  });

  it("can remove multiple explicitly cancelled products in one turn", () => {
    const first = interpret([customer("Een Duvel en een pintje.")]);
    const corrected = interpret([customer("Haal de Duvel en de pinte weg.")], first.lines);
    expect(corrected.lines).toHaveLength(0);
  });

  it("asks which existing product to remove when the spoken name is ambiguous", () => {
    const blond = interpret([customer("Een Leffe Blond.")]);
    const both = interpret([customer("Doe er een Leffe Bruin bij.")], blond.lines);
    const corrected = interpret([customer("Laat de Leffe maar zitten.")], both.lines);
    expect(corrected.lines).toHaveLength(2);
    expect(corrected.issues).toMatchObject([{
      type: "ambiguous_removal",
      blocking: true,
      productCandidates: [{ productId: "POS-1003" }, { productId: "POS-1004" }],
    }]);
  });

  it("does not remove a later addition merely because an earlier product was negated", () => {
    const first = interpret([customer("Een Duvel en een Stella.")]);
    const corrected = interpret([customer("Geen Duvel, doe maar een Stella.")], first.lines);
    expect(corrected.lines).toMatchObject([{ productId: "POS-1002", quantity: 2 }]);
  });

  it("understands implicit contextual quantity", () => {
    const draft = interpret([customer("Voor ons allebei frieten.")]);
    expect(draft.lines).toMatchObject([{ productId: "POS-3101", quantity: 2 }]);
  });

  it("flags duplicate POS aliases as ambiguous", () => {
    const draft = interpret([customer("Twee witte huiswijn.")]);
    expect(draft.issues[0].productCandidates).toHaveLength(2);
  });

  it("captures allergy statements as manual checks", () => {
    const draft = interpret([customer("De vol-au-vent is voor iemand met een notenallergie, met frieten.")]);
    expect(draft.warnings).toMatchObject([{ type: "allergy_manual_check" }]);
    expect(draft.warnings[0].message).toContain("manual check required");
  });

  it("requires confirmation for unusual course timing", () => {
    const draft = interpret([customer("Ik neem de garnaalkroketten maar breng die samen met mijn steak.")]);
    expect(draft.issues.map((issue) => issue.type)).toContain("course_exception");
    expect(draft.lines.find((line) => line.productId === "POS-2001")?.course).toBe("main");
  });

  it("maps a POS-native composite drink as one product", () => {
    const draft = interpret([customer("Een gin tonic.")]);
    expect(draft.lines).toMatchObject([{ productId: "POS-1201", quantity: 1 }]);
  });

  it("rejects invalid POS IDs in deterministic validation", () => {
    const draft = interpret([customer("Een Duvel.")]);
    const invalid = DraftOrderSchema.parse({ ...draft, lines: [{ ...draft.lines[0], productId: "MADE-UP" }] });
    expect(validateDraft(invalid, demoMenu)).toMatchObject({ valid: false });
  });
});

describe("mock POS adapter", () => {
  it("creates an idempotent draft that still requires waiter confirmation", async () => {
    const adapter = new MockPOSAdapter();
    const draft = interpret([customer("Een Duvel.")]);
    const first = await adapter.createDraftOrder({ draft, idempotencyKey: "test-idempotency-001", sentBy: "waiter-test" });
    const second = await adapter.createDraftOrder({ draft, idempotencyKey: "test-idempotency-001", sentBy: "waiter-test" });
    expect(second.posSubmission?.externalOrderId).toBe(first.posSubmission?.externalOrderId);
    expect(first.status).toBe("SENT");
    expect(first.posSubmission?.confirmedByWaiter).toBe(false);
  });

  it("blocks a draft that still has human-resolution issues", async () => {
    const adapter = new MockPOSAdapter();
    const draft = interpret([customer("Een Leffe.")]);
    await expect(adapter.createDraftOrder({ draft, idempotencyKey: "test-idempotency-002", sentBy: "waiter-test" })).rejects.toMatchObject({ code: "INVALID_DRAFT" });
  });
});
