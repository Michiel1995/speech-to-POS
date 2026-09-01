import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { generateSyntheticCorpus, validateSyntheticCorpus } from "@/evals/synthetic-corpus";

describe("synthetic corpus artifact writer", () => {
  it("writes reproducible JSONL splits and a coverage report", async () => {
    if (process.env.WRITE_SYNTHETIC_CORPUS !== "1") return;
    const cases = generateSyntheticCorpus(5_000);
    expect(validateSyntheticCorpus(cases)).toEqual([]);
    const outputDirectory = path.resolve("evals/generated");
    await mkdir(outputDirectory, { recursive: true });
    for (const split of ["development", "validation", "test"] as const) {
      const rows = cases.filter((item) => item.split === split).map((item) => JSON.stringify(item)).join("\n");
      await writeFile(path.join(outputDirectory, `${split}.jsonl`), `${rows}\n`, "utf8");
    }
    const byCategory = Object.groupBy(cases, (item) => item.category);
    const byLanguage = Object.groupBy(cases, (item) => item.language);
    const report = {
      generatorVersion: cases[0]?.generatorVersion,
      seed: cases[0]?.seed,
      total: cases.length,
      splits: Object.fromEntries(["development", "validation", "test"].map((split) => [split, cases.filter((item) => item.split === split).length])),
      categories: Object.fromEntries(Object.entries(byCategory).map(([key, value]) => [key, value.length])),
      languages: Object.fromEntries(Object.entries(byLanguage).map(([key, value]) => [key, value.length])),
      validationErrors: [],
      audio: "not generated; audio remains outside Git",
    };
    await writeFile(path.join(outputDirectory, "REPORT.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  });
});