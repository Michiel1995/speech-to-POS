export interface AudioQualityResult {
  rms: number;
  peak: number;
  decibels: number;
  silenceRatio: number;
  clippingRatio: number;
  vadThreshold: number;
  warnings: Array<"too_quiet" | "too_far" | "clipping" | "mostly_silence" | "possible_music_or_tableware" | "possible_overlap">;
}

export function analyzeAudioQuality(chunks: Float32Array[]): AudioQualityResult {
  const samples = chunks.flatMap((chunk) => Array.from(chunk));
  if (!samples.length) return { rms: 0, peak: 0, decibels: -100, silenceRatio: 1, clippingRatio: 0, vadThreshold: 0.18, warnings: ["mostly_silence"] };
  let squares = 0;
  let peak = 0;
  let silent = 0;
  let clipped = 0;
  let fastChanges = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const absolute = Math.abs(samples[index]);
    squares += samples[index] * samples[index];
    peak = Math.max(peak, absolute);
    if (absolute < 0.008) silent += 1;
    if (absolute > 0.985) clipped += 1;
    if (index > 0 && Math.abs(samples[index] - samples[index - 1]) > 0.65) fastChanges += 1;
  }
  const rms = Math.sqrt(squares / samples.length);
  const decibels = 20 * Math.log10(Math.max(rms, 0.00001));
  const silenceRatio = silent / samples.length;
  const clippingRatio = clipped / samples.length;
  const warnings: AudioQualityResult["warnings"] = [];
  if (rms < 0.012) warnings.push("too_quiet");
  else if (rms < 0.026) warnings.push("too_far");
  if (clippingRatio > 0.01) warnings.push("clipping");
  if (silenceRatio > 0.9) warnings.push("mostly_silence");
  if (fastChanges / samples.length > 0.015) warnings.push("possible_music_or_tableware");
  if (rms > 0.22 && clippingRatio < 0.002) warnings.push("possible_overlap");
  return { rms, peak, decibels, silenceRatio, clippingRatio, vadThreshold: Math.min(0.62, Math.max(0.16, 0.18 + silenceRatio * 0.22)), warnings };
}

export function audioQualityMessage(result: AudioQualityResult): string | undefined {
  if (result.warnings.includes("too_quiet") || result.warnings.includes("mostly_silence")) return "Ik hoor bijna geen stem. Spreek iets dichter bij de microfoon.";
  if (result.warnings.includes("too_far")) return "De stem klinkt ver weg. Plaats de laptop dichter bij de tafel.";
  if (result.warnings.includes("clipping")) return "Het geluid is te luid en vervormt. Plaats de microfoon iets verder weg.";
  if (result.warnings.includes("possible_overlap")) return "Mogelijk spreken meerdere personen tegelijk. Controleer de nieuwste bestelling extra goed.";
  if (result.warnings.includes("possible_music_or_tableware")) return "Veel plots achtergrondgeluid gehoord; onzekere delen worden extra gecontroleerd.";
  return undefined;
}
