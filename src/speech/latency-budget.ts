export const PROVISIONAL_REVIEW_BUDGET_MS = 2_000;
export const FINAL_REVIEW_BUDGET_MS = 5_000;

// Leaves time inside the five-second final budget for WAV finalization,
// request parsing, deterministic interpretation and React rendering.
export const FINAL_TRANSCRIPTION_BUDGET_MS = 4_200;

export interface VoiceLatencyGateInput {
  provisionalP95Ms?: number;
  finalP95Ms?: number;
}

export interface VoiceLatencyGateResult {
  measured: boolean;
  passed: boolean;
  provisionalPassed: boolean;
  finalPassed: boolean;
}

export function evaluateVoiceLatencyGate(input: VoiceLatencyGateInput): VoiceLatencyGateResult {
  const measured = input.provisionalP95Ms !== undefined && input.finalP95Ms !== undefined;
  const provisionalPassed = input.provisionalP95Ms !== undefined && input.provisionalP95Ms < PROVISIONAL_REVIEW_BUDGET_MS;
  const finalPassed = input.finalP95Ms !== undefined && input.finalP95Ms < FINAL_REVIEW_BUDGET_MS;
  return { measured, passed: measured && provisionalPassed && finalPassed, provisionalPassed, finalPassed };
}
