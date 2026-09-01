import { describe, expect, it } from "vitest";

import {
  SYNTHETIC_CORPUS_SEED,
  generateSyntheticCorpus,
  validateSyntheticCorpus,
} from "@/evals/synthetic-corpus";

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

});