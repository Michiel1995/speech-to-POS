import { describe, expect, it } from "vitest";

import { calculateQualityMetrics } from "@/src/analytics/quality-metrics";
import { CorrectionLearningStore } from "@/src/learning/correction-store";
import { customer, interpret } from "@/tests/helpers";

describe("correction learning", () => {
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
});
