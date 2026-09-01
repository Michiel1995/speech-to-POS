import { describe, expect, it } from "vitest";

import { calculateQualityMetrics } from "@/src/analytics/quality-metrics";
import { calculateRecognitionMetrics } from "@/src/analytics/recognition-metrics";
import { CorrectionLearningStore } from "@/src/learning/correction-store";
import { customer, interpret } from "@/tests/helpers";
import { EMPTY_LANGUAGE_LEARNING, recordCorrection, recordExplicitCorrection } from "@/src/learning/local-language-learning";

describe("correction learning", () => {
  it("automatically approves three consistent local corrections without storing audio", () => {
    const once = recordCorrection(EMPTY_LANGUAGE_LEARNING, "leven blond", "POS-1003");
    const twice = recordCorrection(once, "leven blond", "POS-1003");
    const threeTimes = recordCorrection(twice, "leven blond", "POS-1003");
    expect(threeTimes.mappings).toMatchObject([{ evidenceCount: 3, status: "APPROVED" }]);
  });

  it("keeps conflicting corrections pending for human review", () => {
    const first = recordCorrection(EMPTY_LANGUAGE_LEARNING, "leffe", "POS-1003");
    const conflict = recordCorrection(first, "leffe", "POS-1004");
    const repeated = recordCorrection(recordCorrection(conflict, "leffe", "POS-1004"), "leffe", "POS-1004");
    expect(repeated.mappings.find((mapping) => mapping.productId === "POS-1004")?.status).toBe("PENDING");
  });

  it("learns an explicit waiter correction immediately when it has no conflict", () => {
    const learned = recordExplicitCorrection(EMPTY_LANGUAGE_LEARNING, "kanaal kroketten", "POS-2001");
    expect(learned.mappings).toMatchObject([{
      spokenFragment: "kanaal kroketten",
      productId: "POS-2001",
      evidenceCount: 1,
      status: "APPROVED",
    }]);
  });

  it("keeps a conflicting explicit correction pending", () => {
    const prior = recordExplicitCorrection(EMPTY_LANGUAGE_LEARNING, "leven", "POS-1003");
    const conflict = recordExplicitCorrection(prior, "leven", "POS-1004");
    expect(conflict.mappings.find((mapping) => mapping.productId === "POS-1004")?.status).toBe("PENDING");
  });

  it("requires repeated evidence and manager approval", () => {
    const store = new CorrectionLearningStore(3);
    const base = {
      tenantId: "tenant-demo-brussels",
      waiterId: "waiter-1",
      spokenFragment: "ne zero",
      previousProductId: "POS-1101",
      correctedProductId: "POS-1102",
      errorCategory: "product" as const,
      confidence: 0.7,
      createdAt: new Date().toISOString(),
    };
    expect(store.record({ ...base, id: "one" })).toBeNull();
    expect(store.record({ ...base, id: "two" })).toBeNull();
    const proposal = store.record({ ...base, id: "three" });
    expect(proposal?.status).toBe("PENDING_MANAGER_APPROVAL");
    expect(store.approve(proposal!.id).status).toBe("APPROVED");
  });

  it("decays personal language weight over time", () => {
    const store = new CorrectionLearningStore();
    store.record({
      id: "old",
      tenantId: "tenant-demo-brussels",
      waiterId: "waiter-1",
      spokenFragment: "sauske apart",
      previousProductId: null,
      correctedProductId: "POS-3001",
      errorCategory: "note",
      confidence: 0.6,
      createdAt: "2026-01-01T00:00:00.000Z",
    });
    expect(store.personalPatternWeight("waiter-1", "sauske apart", new Date("2026-01-02T00:00:00.000Z")))
      .toBeGreaterThan(store.personalPatternWeight("waiter-1", "sauske apart", new Date("2026-06-01T00:00:00.000Z")));
  });
});

describe("strict quality metrics", () => {
  it("counts a line only when every operational field is correct", () => {
    const actual = interpret([customer("Een steak saignant met frieten.")]).lines;
    const metrics = calculateQualityMetrics(
      [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-SAIGN", "MOD-FRIES"], course: "main", notes: [] }],
      actual,
    );
    expect(metrics.strictLineAccuracy).toBe(1);

    const wrongCourse = calculateQualityMetrics(
      [{ productId: "POS-3001", quantity: 1, modifierIds: ["MOD-SAIGN", "MOD-FRIES"], course: "starter", notes: [] }],
      actual,
    );
    expect(wrongCourse.strictLineAccuracy).toBe(0);
  });

  it("reports word errors separately from safety-critical product errors", () => {
    const metrics = calculateRecognitionMetrics([
      {
        expectedText: "ik neem een Leffe Blond",
        actualText: "ik neem een leven blond",
        expectedProductIds: ["POS-1003"],
        candidateProductIds: ["POS-1003"],
        selectedProductIds: ["POS-1003"],
        confidence: 0.82,
        requiredConfirmation: true,
      },
      {
        expectedText: "dat was een verhaal",
        actualText: "dat was een verhaal",
        expectedProductIds: [],
        candidateProductIds: [],
        selectedProductIds: [],
        confidence: 0.94,
        requiredConfirmation: false,
      },
    ]);
    expect(metrics.wordErrorRate).toBeGreaterThan(0);
    expect(metrics.productRecall).toBe(1);
    expect(metrics.falseProductRate).toBe(0);
    expect(metrics.confirmationRate).toBe(0.5);
  });
});
