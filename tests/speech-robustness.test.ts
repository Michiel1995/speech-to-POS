import { describe, expect, it } from "vitest";

import { demoMenu } from "@/src/data/demo-menu";
import { InterpretRequestSchema } from "@/src/domain/schemas";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";
import { speechTranscriptMenuScore } from "@/src/semantic-menu/matcher";
import { buildSpeechVocabulary } from "@/src/speech/menu-vocabulary";
import { confirmSpeechProduct, rejectSpeechProduct } from "@/src/ui/draft-actions";
import { validateDraft } from "@/src/validation/order-validator";

function audioOrder(text: string, priorLines?: ReturnType<typeof interpretDeterministically>["lines"]) {
  return interpretDeterministically(InterpretRequestSchema.parse({
    tenantId: demoMenu.tenantId,
    tableId: "TABLE-12",
    tableLabel: "Table 12",
    waiterId: "waiter-test",
    source: "audio",
    engine: "deterministic",
    turns: [{ speaker: "customer", text }],
    priorLines,
  }), demoMenu);
}

describe("speech robustness", () => {
  it("prioritizes the pronunciation variants from table context within the prompt budget", () => {
    const vocabulary = buildSpeechVocabulary(demoMenu, {
      contextProductIds: ["POS-1003"],
      priorProductIds: ["POS-1102"],
      maxPromptChars: 420,
    });

    expect(vocabulary.primaryPrompt.length).toBeLessThanOrEqual(420);
    expect(vocabulary.retryPrompt.length).toBeLessThanOrEqual(420);
    expect(vocabulary.primaryPrompt.toLocaleLowerCase("nl-BE")).toContain("leven blond");
    expect(vocabulary.retryPrompt.toLocaleLowerCase("nl-BE")).toContain("coca colla zero");
    expect(vocabulary.preferredProductIds).toEqual(["POS-1003", "POS-1102"]);
  });

  it("keeps ASR-oriented menu aliases ahead of POS codes and broad food knowledge", () => {
    const vocabulary = buildSpeechVocabulary(demoMenu, { maxPromptChars: 900, dialectProfile: "standard" });
    const prompt = vocabulary.primaryPrompt.toLocaleLowerCase("nl-BE");
    expect(prompt.length).toBeLessThanOrEqual(900);
    expect(prompt).toContain("frieten");
    expect(prompt).toContain("pepersaus");
    expect(prompt).toContain("leven blond");
    expect(prompt).toMatch(/vol (?:au van|over vent)/);
    expect(prompt.indexOf("leven blond")).toBeLessThan(prompt.indexOf("stk std") === -1 ? Number.POSITIVE_INFINITY : prompt.indexOf("stk std"));
  });

  it("ranks a transcript higher when it matches the active conversation context", () => {
    const ordinary = speechTranscriptMenuScore("Doe mij de Leffe Blond.", demoMenu);
    const contextual = speechTranscriptMenuScore("Doe mij de Leffe Blond.", demoMenu, ["POS-1003"]);
    expect(contextual).toBe(ordinary + 8);
  });

  it("gives a sole-context acceptance enough evidence to avoid a costly blind retry", () => {
    expect(speechTranscriptMenuScore("Doe die maar", demoMenu, ["POS-2001"])).toBeGreaterThanOrEqual(5);
    expect(speechTranscriptMenuScore("Yes please", demoMenu, ["POS-2001"])).toBeGreaterThanOrEqual(5);
  });

  it("requires an explicit confirmation for an unlisted fuzzy audio match", () => {
    const draft = audioOrder("Doe er een coka cola zero bij.");
    expect(draft.lines).toMatchObject([{ productId: "POS-1102", quantity: 1 }]);
    expect(draft.issues).toMatchObject([{
      type: "speech_confirmation",
      blocking: true,
      quantityDelta: 1,
      productCandidates: [{ productId: "POS-1102" }],
    }]);

    const confirmed = confirmSpeechProduct(draft, draft.issues[0].id);
    expect(confirmed.issues).toHaveLength(0);
    expect(confirmed.lines[0].confidence).toBe(1);

    const rejected = rejectSpeechProduct(draft, draft.issues[0].id);
    expect(rejected.lines).toHaveLength(0);
    expect(rejected.issues).toHaveLength(0);
    expect(validateDraft(rejected, demoMenu)).toMatchObject({ valid: false });
  });

  it("rejects only the uncertain quantity when the product was already ordered", () => {
    const initial = audioOrder("Een Coca-Cola Zero.");
    const addition = audioOrder("Nog een coka cola zero.", initial.lines);
    const issue = addition.issues.find((candidate) => candidate.type === "speech_confirmation");
    expect(issue).toBeDefined();

    const rejected = rejectSpeechProduct(addition, issue!.id);
    expect(rejected.lines).toMatchObject([{ productId: "POS-1102", quantity: 1 }]);
  });

  it("keeps line IDs unique when uncertain speech adds a different product", () => {
    const initial = audioOrder("Een Duvel.");
    const addition = audioOrder("Doe een coka cola zero erbij.", initial.lines);
    expect(new Set(addition.lines.map((line) => line.lineId)).size).toBe(addition.lines.length);
    const issue = addition.issues.find((candidate) => candidate.type === "speech_confirmation");
    expect(issue?.lineId).toBe(addition.lines.find((line) => line.productId === "POS-1102")?.lineId);
  });
});
