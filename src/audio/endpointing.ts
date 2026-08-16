export const MAX_AUTOMATIC_RECORDING_SECONDS = 180;

const INCOMPLETE_ENDINGS = new Set([
  "en",
  "of",
  "maar",
  "met",
  "zonder",
  "voor",
  "plus",
  "ook",
  "nog",
  "dan",
  "een",
  "de",
  "het",
  "et",
  "ou",
  "mais",
  "avec",
  "sans",
  "pour",
  "un",
  "une",
  "le",
  "la",
  "les",
  "and",
  "or",
  "but",
  "with",
  "without",
  "for",
  "a",
  "an",
  "the",
]);

export interface SilenceEndpointInput {
  noiseFloorRms: number;
  spokenDurationSeconds: number;
  previewText?: string;
}

function previewLooksIncomplete(previewText = ""): boolean {
  const normalized = previewText.trim().toLocaleLowerCase("nl-BE");
  if (!normalized) return false;
  if (/[,;:\-–—]$/.test(normalized)) return true;

  const words = normalized.match(/[\p{L}\p{N}]+/gu);
  return words ? INCOMPLETE_ENDINGS.has(words.at(-1) ?? "") : false;
}

export function automaticSilenceDelaySeconds(input: SilenceEndpointInput): number {
  const noisyRoom = Number.isFinite(input.noiseFloorRms) && input.noiseFloorRms >= 0.018;
  let delaySeconds = noisyRoom ? 3.8 : 3;

  if (input.spokenDurationSeconds < 2.2) delaySeconds += 0.7;
  if (previewLooksIncomplete(input.previewText)) delaySeconds += 0.7;

  return Math.min(5, Number(delaySeconds.toFixed(2)));
}
