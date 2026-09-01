import type { ConversationIntent } from "@/src/order-understanding/intent-router";

export interface EvaluationObservation {
  expectedIntent: ConversationIntent;
  actualIntent: ConversationIntent;
  expectedProductIds: string[];
  actualProductIds: string[];
  exactOrder: boolean;
  orderMutated: boolean;
  removalApplied: boolean;
  clarificationRequested: boolean;
  latencyMs: number;
  dialectProfile: string;
}

export interface EvaluationReport {
  cases: number;
  questionIntentAccuracy: number;
  productRecall: number;
  productPrecision: number;
  exactOrderMatch: number;
  falseOrderRate: number;
  falseRemovalRate: number;
  clarificationRate: number;
  averageLatencyMs: number;
  accuracyPerDialect: Record<string, number>;
  productConfusionMatrix: Record<string, Record<string, number>>;
}

const questionIntents = new Set<ConversationIntent>(["menu_question", "availability_question", "price_question", "ingredient_question", "recommendation_question"]);

export function calculateEvaluationReport(observations: EvaluationObservation[]): EvaluationReport {
  const denominator = Math.max(1, observations.length);
  const questionCases = observations.filter((item) => questionIntents.has(item.expectedIntent));
  let trueProducts = 0;
  let predictedProducts = 0;
  let matchedProducts = 0;
  const dialects: Record<string, { correct: number; total: number }> = {};
  const productConfusionMatrix: Record<string, Record<string, number>> = {};
  for (const item of observations) {
    const expected = new Set(item.expectedProductIds);
    const actual = new Set(item.actualProductIds);
    trueProducts += expected.size;
    predictedProducts += actual.size;
    matchedProducts += [...expected].filter((id) => actual.has(id)).length;
    dialects[item.dialectProfile] ??= { correct: 0, total: 0 };
    dialects[item.dialectProfile].total += 1;
    if (item.actualIntent === item.expectedIntent) dialects[item.dialectProfile].correct += 1;
    for (const expectedId of expected.size ? expected : ["NONE"]) {
      productConfusionMatrix[expectedId] ??= {};
      for (const actualId of actual.size ? actual : ["NONE"]) productConfusionMatrix[expectedId][actualId] = (productConfusionMatrix[expectedId][actualId] ?? 0) + 1;
    }
  }
  const nonOrderCases = observations.filter((item) => !["order", "addition", "removal", "replacement", "correction"].includes(item.expectedIntent));
  const nonRemovalCases = observations.filter((item) => item.expectedIntent !== "removal");
  return {
    cases: observations.length,
    questionIntentAccuracy: questionCases.length ? questionCases.filter((item) => item.actualIntent === item.expectedIntent).length / questionCases.length : 1,
    productRecall: trueProducts ? matchedProducts / trueProducts : 1,
    productPrecision: predictedProducts ? matchedProducts / predictedProducts : 1,
    exactOrderMatch: observations.filter((item) => item.exactOrder).length / denominator,
    falseOrderRate: nonOrderCases.length ? nonOrderCases.filter((item) => item.orderMutated).length / nonOrderCases.length : 0,
    falseRemovalRate: nonRemovalCases.length ? nonRemovalCases.filter((item) => item.removalApplied).length / nonRemovalCases.length : 0,
    clarificationRate: observations.filter((item) => item.clarificationRequested).length / denominator,
    averageLatencyMs: observations.reduce((sum, item) => sum + item.latencyMs, 0) / denominator,
    accuracyPerDialect: Object.fromEntries(Object.entries(dialects).map(([profile, value]) => [profile, value.correct / value.total])),
    productConfusionMatrix,
  };
}
