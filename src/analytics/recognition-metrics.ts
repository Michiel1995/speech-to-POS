import { normalizeSpoken } from "@/src/semantic-menu/matcher";

export interface RecognitionObservation {
  expectedText: string;
  actualText: string;
  expectedProductIds: string[];
  candidateProductIds: string[];
  selectedProductIds: string[];
  confidence: number;
  requiredConfirmation: boolean;
}

export interface RecognitionMetrics {
  cases: number;
  wordErrorRate: number;
  productRecall: number;
  productPrecision: number;
  topCandidateCoverage: number;
  falseProductRate: number;
  confirmationRate: number;
  highConfidenceErrorRate: number;
}

function tokenDistance(left: string[], right: string[]): number {
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current.push(Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1),
      ));
    }
    previous = current;
  }
  return previous[right.length];
}

function unique(values: string[]): Set<string> {
  return new Set(values);
}

export function calculateRecognitionMetrics(observations: RecognitionObservation[]): RecognitionMetrics {
  let expectedWords = 0;
  let wordErrors = 0;
  let expectedProducts = 0;
  let selectedProducts = 0;
  let matchedProducts = 0;
  let candidateHits = 0;
  let falseProductCases = 0;
  let highConfidenceErrors = 0;

  for (const observation of observations) {
    const expectedTokens = normalizeSpoken(observation.expectedText).split(/\s+/).filter(Boolean);
    const actualTokens = normalizeSpoken(observation.actualText).split(/\s+/).filter(Boolean);
    expectedWords += expectedTokens.length;
    wordErrors += tokenDistance(expectedTokens, actualTokens);

    const expected = unique(observation.expectedProductIds);
    const candidates = unique(observation.candidateProductIds);
    const selected = unique(observation.selectedProductIds);
    expectedProducts += expected.size;
    selectedProducts += selected.size;
    matchedProducts += [...expected].filter((productId) => selected.has(productId)).length;
    candidateHits += [...expected].filter((productId) => candidates.has(productId)).length;
    const isFalseProduct = [...selected].some((productId) => !expected.has(productId));
    if (isFalseProduct) falseProductCases += 1;
    if (isFalseProduct && observation.confidence >= 0.85) highConfidenceErrors += 1;
  }

  const cases = Math.max(1, observations.length);
  return {
    cases: observations.length,
    wordErrorRate: wordErrors / Math.max(1, expectedWords),
    productRecall: matchedProducts / Math.max(1, expectedProducts),
    productPrecision: matchedProducts / Math.max(1, selectedProducts),
    topCandidateCoverage: candidateHits / Math.max(1, expectedProducts),
    falseProductRate: falseProductCases / cases,
    confirmationRate: observations.filter((observation) => observation.requiredConfirmation).length / cases,
    highConfidenceErrorRate: highConfidenceErrors / cases,
  };
}
