import type { Course, DraftLine } from "@/src/domain/schemas";

export interface ExpectedLine {
  productId: string;
  quantity: number;
  modifierIds: string[];
  course: Course;
  notes: string[];
}

export interface QualityMetrics {
  expectedLines: number;
  strictlyCorrectLines: number;
  strictLineAccuracy: number;
  productAccuracy: number;
  quantityAccuracy: number;
  modifierAccuracy: number;
}

function sameSet(left: string[], right: string[]) {
  return [...left].sort().join("|") === [...right].sort().join("|");
}

export function calculateQualityMetrics(expected: ExpectedLine[], actual: DraftLine[]): QualityMetrics {
  let strict = 0;
  let products = 0;
  let quantities = 0;
  let modifiers = 0;

  for (const expectedLine of expected) {
    const actualLine = actual.find((line) => line.productId === expectedLine.productId);
    if (!actualLine) continue;
    products += 1;
    if (actualLine.quantity === expectedLine.quantity) quantities += 1;
    const actualModifiers = actualLine.modifiers.map((modifier) => modifier.optionId);
    if (sameSet(actualModifiers, expectedLine.modifierIds)) modifiers += 1;
    if (
      actualLine.quantity === expectedLine.quantity &&
      sameSet(actualModifiers, expectedLine.modifierIds) &&
      actualLine.course === expectedLine.course &&
      sameSet(actualLine.notes, expectedLine.notes)
    ) {
      strict += 1;
    }
  }

  const denominator = expected.length || 1;
  return {
    expectedLines: expected.length,
    strictlyCorrectLines: strict,
    strictLineAccuracy: strict / denominator,
    productAccuracy: products / denominator,
    quantityAccuracy: quantities / denominator,
    modifierAccuracy: modifiers / denominator,
  };
}
