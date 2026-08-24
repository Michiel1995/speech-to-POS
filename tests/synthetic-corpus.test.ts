import { describe, expect, it } from "vitest";

import {
  SYNTHETIC_CORPUS_SEED,
  generateSyntheticCorpus,
  validateSyntheticCorpus,
} from "@/evals/synthetic-corpus";
import { interpret } from "@/tests/helpers";

function comparableExpected(item: ReturnType<typeof generateSyntheticCorpus>[number]) {
  return {
    lines: item.expected.lines
      .map((line) => ({ productId: line.productId, quantity: line.quantity, modifierIds: [...(line.modifierIds ?? [])].sort() }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    issueTypes: [...(item.expected.issueTypes ?? [])].sort(),
    warningTypes: [...(item.expected.warningTypes ?? [])].sort(),
  };
}

function actualExpected(item: ReturnType<typeof generateSyntheticCorpus>[number]) {
  const draft = interpret(item.turns);
  return {
    lines: draft.lines
      .map((line) => ({ productId: line.productId, quantity: line.quantity, modifierIds: line.modifiers.map((modifier) => modifier.optionId).sort() }))
      .sort((left, right) => left.productId.localeCompare(right.productId)),
    issueTypes: [...new Set(draft.issues.map((issue) => issue.type))].sort(),
    warningTypes: [...new Set(draft.warnings.map((warning) => warning.type))].sort(),
  };
}

describe("synthetic evaluation corpus", () => {
  it("generates a reproducible, validated 5,000-case corpus", () => {
    const first = generateSyntheticCorpus(5_000, SYNTHETIC_CORPUS_SEED);
    const second = generateSyntheticCorpus(5_000, SYNTHETIC_CORPUS_SEED);

    expect(first).toEqual(second);
    expect(first).toHaveLength(5_000);
    expect(validateSyntheticCorpus(first)).toEqual([]);
  });

  it("keeps development, validation and hidden test splits populated", () => {
    const cases = generateSyntheticCorpus(5_000);
    const counts = Object.groupBy(cases, (item) => item.split);

    expect(counts.development?.length).toBeGreaterThanOrEqual(3_000);
    expect(counts.validation?.length).toBeGreaterThanOrEqual(500);
    expect(counts.test?.length).toBeGreaterThanOrEqual(500);
  });

  it("runs a representative generated development sample through the order engine", () => {
    const cases = generateSyntheticCorpus(500).filter((item) => item.split === "development");
    const failures = cases.filter((item) => JSON.stringify(actualExpected(item)) !== JSON.stringify(comparableExpected(item)));
    expect(failures.slice(0, 5).map((item) => ({ id: item.id, sourceCaseId: item.sourceCaseId, turns: item.turns }))).toEqual([]);
  });
});