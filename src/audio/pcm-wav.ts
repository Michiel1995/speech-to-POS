const TARGET_SAMPLE_RATE = 16_000;

export interface WavAudioInfo {
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
  durationSeconds: number;
}

function ascii(view: DataView, offset: number, length: number): string {
  return String.fromCharCode(...Array.from({ length }, (_, index) => view.getUint8(offset + index)));
}

export function inspectWavAudio(audio: ArrayBuffer): WavAudioInfo {
  if (audio.byteLength < 44) throw new Error("De WAV-opname is onvolledig.");
  const view = new DataView(audio);
  if (ascii(view, 0, 4) !== "RIFF" || ascii(view, 8, 4) !== "WAVE") {
    throw new Error("De opname bevat geen geldige WAV-header.");
  }
  let offset = 12;
  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let byteRate = 0;
  let dataBytes = 0;
  while (offset + 8 <= audio.byteLength) {
    const chunkId = ascii(view, offset, 4);
    const chunkSize = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (chunkSize > audio.byteLength - dataOffset) throw new Error("De WAV-opname is beschadigd of afgekapt.");
    if (chunkId === "fmt ") {
      if (chunkSize < 16) throw new Error("De WAV-audio-instellingen zijn onvolledig.");
      const format = view.getUint16(dataOffset, true);
      if (format !== 1) throw new Error("Alleen ongecomprimeerde PCM-WAV wordt lokaal ondersteund.");
      channels = view.getUint16(dataOffset + 2, true);
      sampleRate = view.getUint32(dataOffset + 4, true);
      byteRate = view.getUint32(dataOffset + 8, true);
      bitsPerSample = view.getUint16(dataOffset + 14, true);
    } else if (chunkId === "data") {
      dataBytes += chunkSize;
    }
    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  if (!sampleRate || sampleRate < 8_000 || sampleRate > 192_000 || !byteRate) {
    throw new Error("De WAV-opname heeft een ongeldige samplefrequentie.");
  }
  if (channels < 1 || channels > 2 || ![8, 16, 24, 32].includes(bitsPerSample)) {
    throw new Error("De WAV-opname gebruikt een niet-ondersteunde kanaal- of bitindeling.");
  }
  if (!dataBytes) throw new Error("De WAV-opname bevat geen audiodata.");
  return {
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
    durationSeconds: dataBytes / byteRate,
  };
}

export interface PreparedSpeechPcm {
  samples: Float32Array;
  originalDurationSeconds: number;
  preparedDurationSeconds: number;
  trimmedDurationSeconds: number;
  noiseFloorRms: number;
  speechThresholdRms: number;
  speechDetected: boolean;
}

function mergeSamples(chunks: Float32Array[]): Float32Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const merged = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

export function downsamplePcm(
  chunks: Float32Array[],
  inputSampleRate: number,
  outputSampleRate = TARGET_SAMPLE_RATE,
): Float32Array {
  if (!Number.isFinite(inputSampleRate) || inputSampleRate <= 0) {
    throw new Error("De microfoon gaf een ongeldige samplefrequentie terug.");
  }
  if (inputSampleRate < outputSampleRate) {
    throw new Error("De microfoonkwaliteit is te laag voor lokale spraakherkenning.");
  }

  const input = mergeSamples(chunks);
  if (inputSampleRate === outputSampleRate) return input;

  const ratio = inputSampleRate / outputSampleRate;
  const output = new Float32Array(Math.round(input.length / ratio));
  let inputOffset = 0;
  for (let outputOffset = 0; outputOffset < output.length; outputOffset += 1) {
    const nextInputOffset = Math.min(input.length, Math.round((outputOffset + 1) * ratio));
    let sum = 0;
    let count = 0;
    for (let index = inputOffset; index < nextInputOffset; index += 1) {
      sum += input[index];
      count += 1;
    }
    output[outputOffset] = count ? sum / count : 0;
    inputOffset = nextInputOffset;
  }
  return output;
}

function frameRms(samples: Float32Array, start: number, end: number): number {
  let squares = 0;
  for (let index = start; index < end; index += 1) squares += samples[index] * samples[index];
  return Math.sqrt(squares / Math.max(1, end - start));
}

function percentile(values: number[], fraction: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor((sorted.length - 1) * fraction)))];
}

/**
 * Prepares microphone PCM for speech recognition without storing audio:
 * removes low-frequency terminal/air-conditioning rumble, estimates the
 * ambient floor, trims non-speech before/after the utterance and applies a
 * bounded gain. The gate is only used to find the edges; it never deletes
 * pauses inside the utterance.
 */
export function preparePcmForSpeech(
  chunks: Float32Array[],
  inputSampleRate: number,
  calibratedNoiseFloorRms?: number,
): PreparedSpeechPcm {
  const input = downsamplePcm(chunks, inputSampleRate);
  if (!input.length) throw new Error("Er werd geen microfoongeluid opgenomen.");

  // One-pole high-pass around 75 Hz at 16 kHz: useful against HVAC and rumble,
  // while keeping the speech band intact.
  const filtered = new Float32Array(input.length);
  const coefficient = Math.exp(-2 * Math.PI * 75 / TARGET_SAMPLE_RATE);
  let previousInput = 0;
  let previousOutput = 0;
  for (let index = 0; index < input.length; index += 1) {
    const output = input[index] - previousInput + coefficient * previousOutput;
    filtered[index] = output;
    previousInput = input[index];
    previousOutput = output;
  }

  const frameSize = Math.round(TARGET_SAMPLE_RATE * 0.02);
  const frameLevels: number[] = [];
  for (let start = 0; start < filtered.length; start += frameSize) {
    frameLevels.push(frameRms(filtered, start, Math.min(filtered.length, start + frameSize)));
  }
  const measuredFloor = percentile(frameLevels, 0.2);
  const suppliedFloor = Number.isFinite(calibratedNoiseFloorRms) ? calibratedNoiseFloorRms! : 0;
  // Prefer the quieter of calibration and recording percentiles. A speaker
  // starting immediately must not be mistaken for the ambient floor.
  const noiseFloorRms = Math.max(0.0015, Math.min(0.12,
    suppliedFloor > 0 ? Math.min(suppliedFloor, measuredFloor || suppliedFloor) : measuredFloor,
  ));
  const speechThresholdRms = Math.max(0.0065, noiseFloorRms + Math.max(0.003, noiseFloorRms * 0.2));
  const activeFrames = frameLevels
    .map((level, index) => level >= speechThresholdRms ? index : -1)
    .filter((index) => index >= 0);

  let firstSample = 0;
  let lastSample = filtered.length;
  // Require multiple active frames so a single piece of tableware does not
  // cut the recording down to a click.
  if (activeFrames.length >= 3) {
    const preRoll = Math.round(TARGET_SAMPLE_RATE * 0.28);
    const postRoll = Math.round(TARGET_SAMPLE_RATE * 0.38);
    firstSample = Math.max(0, activeFrames[0] * frameSize - preRoll);
    lastSample = Math.min(filtered.length, (activeFrames.at(-1)! + 1) * frameSize + postRoll);
  }
  const trimmed = filtered.slice(firstSample, lastSample);

  let peak = 0;
  let rmsSquares = 0;
  for (const sample of trimmed) {
    peak = Math.max(peak, Math.abs(sample));
    rmsSquares += sample * sample;
  }
  const rms = Math.sqrt(rmsSquares / Math.max(1, trimmed.length));
  const gainFromRms = rms > 0 ? 0.085 / rms : 1;
  const gainFromPeak = peak > 0 ? 0.88 / peak : 1;
  const gain = Math.max(0.72, Math.min(2.8, gainFromRms, gainFromPeak));
  if (gain !== 1) {
    for (let index = 0; index < trimmed.length; index += 1) trimmed[index] *= gain;
  }

  const originalDurationSeconds = input.length / TARGET_SAMPLE_RATE;
  const preparedDurationSeconds = trimmed.length / TARGET_SAMPLE_RATE;
  return {
    samples: trimmed,
    originalDurationSeconds,
    preparedDurationSeconds,
    trimmedDurationSeconds: Math.max(0, originalDurationSeconds - preparedDurationSeconds),
    noiseFloorRms,
    speechThresholdRms,
    speechDetected: activeFrames.length >= 2,
  };
}

export function encodePcm16Wav(samples: Float32Array, sampleRate = TARGET_SAMPLE_RATE): Blob {
  const bytesPerSample = 2;
  const buffer = new ArrayBuffer(44 + samples.length * bytesPerSample);
  const view = new DataView(buffer);

  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * bytesPerSample, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true);
  view.setUint16(32, bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * bytesPerSample, true);

  let offset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(offset, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
    offset += bytesPerSample;
  }

  return new Blob([buffer], { type: "audio/wav" });
}

export function recordingToWav(chunks: Float32Array[], inputSampleRate: number): Blob {
  if (chunks.length === 0) throw new Error("Er werd geen microfoongeluid opgenomen.");
  return encodePcm16Wav(downsamplePcm(chunks, inputSampleRate));
}

export function preparedRecordingToWav(
  chunks: Float32Array[],
  inputSampleRate: number,
  calibratedNoiseFloorRms?: number,
): { blob: Blob; preparation: PreparedSpeechPcm } {
  if (chunks.length === 0) throw new Error("Er werd geen microfoongeluid opgenomen.");
  const preparation = preparePcmForSpeech(chunks, inputSampleRate, calibratedNoiseFloorRms);
  return { blob: encodePcm16Wav(preparation.samples), preparation };
}
