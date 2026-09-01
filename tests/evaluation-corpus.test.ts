import { describe, expect, it } from "vitest";

import { evaluationCases } from "@/evals/conversations";
import { interpret } from "@/tests/helpers";

describe("hospitality evaluation corpus", () => {
  it("contains at least 50 realistic, categorized conversations", () => {
    expect(evaluationCases.length).toBeGreaterThanOrEqual(50);
    const categories = new Set(evaluationCases.map((item) => item.category));
    for (const required of [
      "simple drinks",
      "modifiers",
      "questions",
      "quantity correction",
      "cancellation",
      "multiple speakers",
      "mixed language",
      "ambiguous products",
      "duplicate POS products",
      "required modifiers",
      "allergies",
      "free-text notes",
      "course changes",
      "historical reference",
      "composite items",
      "dialect",
    ]) {
      expect(categories.has(required), `missing category: ${required}`).toBe(true);
    }
  });

  for (const evaluation of evaluationCases.filter((item) => item.deterministic)) {
    it(`matches deterministic expectation: ${evaluation.id}`, () => {
      const draft = interpret(evaluation.turns);
      const actualLines = draft.lines
        .map((line) => ({
          productId: line.productId,
          quantity: line.quantity,
          ...(line.modifiers.length
            ? { modifierIds: line.modifiers.map((modifier) => modifier.optionId).sort() }
            : {}),
        }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
      const expectedLines = evaluation.expected.lines
        .map((line) => ({ ...line, ...(line.modifierIds ? { modifierIds: [...line.modifierIds].sort() } : {}) }))
        .sort((a, b) => a.productId.localeCompare(b.productId));
      expect(actualLines).toEqual(expectedLines);

      if (evaluation.expected.issueTypes) {
        expect([...new Set(draft.issues.map((issue) => issue.type))].sort()).toEqual(
          [...evaluation.expected.issueTypes].sort(),
        );
      } else {
        expect(draft.issues).toHaveLength(0);
      }
      if (evaluation.expected.warningTypes) {
        expect([...new Set(draft.warnings.map((warning) => warning.type))].sort()).toEqual(
          [...evaluation.expected.warningTypes].sort(),
        );
      }
    });
  }
});
