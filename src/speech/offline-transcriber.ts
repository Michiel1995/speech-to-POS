import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { inspectWavAudio } from "@/src/audio/pcm-wav";
import { DomainError } from "@/src/domain/errors";
import type { ConversationTurn } from "@/src/domain/schemas";
import {
  recordLocalWhisperPerformance,
  selectLocalWhisperEntryModel,
  selectLocalWhisperModel,
  withLocalSpeechCapacity,
  type LocalWhisperSelection,
} from "@/src/speech/local-model-manager";
import {
  transcribeWithLocalWhisperServer,
  type WhisperServerVerboseJson,
} from "@/src/speech/local-whisper-server";

const execFileAsync = promisify(execFile);
const MAX_AUDIO_BYTES = 24 * 1024 * 1024;

interface WhisperJson {
  result?: { language?: string };
  transcription?: Array<{
    text?: string;
    offsets?: { from?: number; to?: number };
    tokens?: Array<{
      text?: string;
      p?: number;
    }>;
  }>;
}

export type SpeechLanguage = "nl" | "fr" | "en" | "auto";

export interface OfflineTranscriptionOptions {
  language?: SpeechLanguage;
  primaryPrompt: string;
  retryPrompt?: string;
  scoreTranscript?: (text: string) => number;
  audioProfile?: {
    rms?: number;
    silenceRatio?: number;
    clippingRatio?: number;
    noiseFloorRms?: number;
  };
  preferLowLatency?: boolean;
  maxPassMs?: number;
}

interface TranscriptionPass {
  name: string;
  text: string;
  turns: ConversationTurn[];
  language?: string;
  confidence: number;
  score: number;
  model?: LocalWhisperSelection;
}

function requiredFilePath(value: string | undefined, code: string): string {
  if (!value) {
    throw new DomainError(
      "De lokale spraakmodule ontbreekt in deze installatie. Installeer de nieuwste versie opnieuw.",
      code,
      503,
    );
  }
  return value;
}

function cleanText(value: string | undefined): string {
  return (value ?? "")
    .replace(/\[(?:BLANK_AUDIO|MUSIC|APPLAUSE|LAUGHTER)\]/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function inferOfflineSpeaker(text: string): ConversationTurn["speaker"] {
  const normalized = text.toLocaleLowerCase("nl-BE").trim();
  return /^(dus\b|zal ik\b|mag ik\b|wilt u\b|wil je\b|wenst u\b|wat mag\b|kan ik\b|ik zet\b|doe ik\b)|\bklopt dat\b/.test(normalized)
    ? "waiter"
    : "unknown";
}

function segmentSentences(value: string): string[] {
  return value.match(/[^.!?]+[.!?]?/g)?.map((sentence) => sentence.trim()).filter(Boolean) ?? [];
}

function tokenConfidence(parsed: WhisperJson): number {
  const weightedTokens = (parsed.transcription ?? []).flatMap((segment) =>
    (segment.tokens ?? []).flatMap((token) => {
      const text = cleanText(token.text);
      if (!text || /^\[_.*\]$/.test(text) || !Number.isFinite(token.p)) return [];
      return [{ probability: Math.max(0, Math.min(1, token.p ?? 0)), weight: Math.max(1, text.length) }];
    }),
  );
  const weight = weightedTokens.reduce((total, token) => total + token.weight, 0);
  if (!weight) return 0;
  return weightedTokens.reduce((total, token) => total + token.probability * token.weight, 0) / weight;
}

function parseTranscription(parsed: WhisperJson, scoreTranscript?: (text: string) => number): TranscriptionPass {
  const turns = (parsed.transcription ?? []).flatMap((segment): ConversationTurn[] => {
    const text = cleanText(segment.text);
    if (!text) return [];
    return segmentSentences(text).map((sentence) => ({
      speaker: inferOfflineSpeaker(sentence),
      providerSpeaker: "offline-whisper",
      text: sentence,
      startedAtMs: segment.offsets?.from,
      endedAtMs: segment.offsets?.to,
    }));
  });
  const text = cleanText(turns.map((turn) => turn.text).join(" "));
  return {
    name: "unknown",
    text,
    turns,
    language: parsed.result?.language,
    confidence: tokenConfidence(parsed),
    score: text && scoreTranscript ? scoreTranscript(text) : 0,
  };
}

function whisperServerJson(value: WhisperServerVerboseJson): WhisperJson {
  const segments = value.segments?.length
    ? value.segments
    : value.text?.trim()
      ? [{ text: value.text, start: 0, end: value.duration ?? 0, words: [] }]
      : [];
  return {
    result: { language: value.language },
    transcription: segments.map((segment) => ({
      text: segment.text,
      offsets: {
        from: typeof segment.start === "number" ? Math.round(segment.start * 1_000) : undefined,
        to: typeof segment.end === "number" ? Math.round(segment.end * 1_000) : undefined,
      },
      tokens: segment.words?.map((word) => ({ text: word.word, p: word.probability })),
    })),
  };
}

function passQuality(pass: TranscriptionPass): number {
  return Math.log1p(Math.max(0, pass.score)) * 3 + pass.confidence * 5;
}

export interface OfflineTranscriptionHypothesis {
  text: string;
  confidence: number;
  menuScore: number;
  totalScore: number;
  pass: string;
  selected: boolean;
}

export interface OfflineTranscriptionResult {
  text: string;
  turns: ConversationTurn[];
  language?: string;
  engine: "whisper.cpp";
  confidence: number;
  vadUsed: boolean;
  vadProfile: "quiet" | "clipped" | "noisy" | "balanced";
  secondPassAttempted: boolean;
  secondPassSelected: boolean;
  hypothesisMargin: number;
  hypotheses: OfflineTranscriptionHypothesis[];
  localModel: {
    id: string;
    label: string;
    tier: LocalWhisperSelection["tier"];
    threadCount: number;
    policy: LocalWhisperSelection["policy"];
    fallbackUsed: boolean;
    runtime: "persistent-server" | "cli";
    processingMs: number;
    audioDurationSeconds: number;
  };
  retained: false;
}

function decodingProfile(selection: LocalWhisperSelection): {
  beamSize: number;
  bestOf: number;
  retryConfidence: number;
  maxPasses: 1 | 2 | 3;
} {
  switch (selection.tier) {
    case "large":
      return { beamSize: 2, bestOf: 2, retryConfidence: 0.5, maxPasses: 1 };
    case "large-turbo":
      return { beamSize: 2, bestOf: 2, retryConfidence: 0.55, maxPasses: 2 };
    case "medium":
      return { beamSize: 3, bestOf: 3, retryConfidence: 0.62, maxPasses: 2 };
    default:
      return { beamSize: 4, bestOf: 4, retryConfidence: 0.66, maxPasses: 2 };
  }
}

async function transcribeHospitalityAudioOfflineUnlocked(
  file: File,
  options: OfflineTranscriptionOptions,
): Promise<OfflineTranscriptionResult> {
  if (!file.size) throw new DomainError("De audio-opname is leeg.", "EMPTY_AUDIO");
  if (file.size > MAX_AUDIO_BYTES) {
    throw new DomainError("De opname is te lang. Stop en verwerk binnen ongeveer tien minuten.", "AUDIO_TOO_LARGE", 413);
  }
  if (file.type && file.type !== "audio/wav" && file.type !== "audio/wave") {
    throw new DomainError("De lokale spraakmodule verwacht een WAV-opname.", "UNSUPPORTED_AUDIO_FORMAT", 415);
  }

  const audio = await file.arrayBuffer();
  let audioDurationSeconds: number;
  try {
    audioDurationSeconds = Math.max(0.1, inspectWavAudio(audio).durationSeconds);
  } catch (error) {
    throw new DomainError(
      error instanceof Error ? error.message : "De WAV-opname is beschadigd.",
      "INVALID_WAV_AUDIO",
      415,
    );
  }

  const cliPath = requiredFilePath(process.env.LOCAL_WHISPER_CLI, "LOCAL_WHISPER_CLI_MISSING");
  const modelPlan = selectLocalWhisperEntryModel();
  const strongestModel = modelPlan.strongest;
  let activeModel = modelPlan.entry;
  if (activeModel && strongestModel && activeModel.id !== strongestModel.id) {
    activeModel = {
      ...activeModel,
      reason: options.preferLowLatency
        ? "kort contextantwoord · snelle lokale route"
        : "snelle eerste passage · sterk model blijft beschikbaar bij lage zekerheid",
    };
  }
  if (!activeModel) requiredFilePath(process.env.LOCAL_WHISPER_MODEL, "LOCAL_WHISPER_MODEL_MISSING");
  if (!activeModel) {
    throw new DomainError(
      "Er is geen lokaal spraakmodel dat veilig op dit toestel kan draaien.",
      "LOCAL_WHISPER_MODEL_UNAVAILABLE",
      503,
    );
  }
  const vadModelPath = process.env.LOCAL_WHISPER_VAD_MODEL;
  const vadUsed = Boolean(vadModelPath && existsSync(vadModelPath));
  const quietRecording = (options.audioProfile?.rms ?? 0.05) < 0.026;
  const clippedRecording = (options.audioProfile?.clippingRatio ?? 0) > 0.01;
  const mostlySilentRecording = (options.audioProfile?.silenceRatio ?? 0) > 0.82;
  const noisyRecording = (options.audioProfile?.noiseFloorRms ?? 0) >= 0.018;
  const workingDirectory = await mkdtemp(path.join(tmpdir(), "service-ears-speech-"));
  const audioPath = path.join(workingDirectory, "recording.wav");
  const processingStartedAt = performance.now();
  let fallbackUsed = false;
  let persistentServerUsed = false;

  try {
    await writeFile(audioPath, Buffer.from(audio));
    const runPass = async (
      name: string,
      rawPrompt: string,
      profile: "primary" | "context" | "rescue",
      selection: LocalWhisperSelection,
    ): Promise<TranscriptionPass> => {
      const outputBase = path.join(workingDirectory, name);
      const prompt = rawPrompt.replace(/\s+/g, " ").trim().slice(0, 1_200);
      const decoding = decodingProfile(selection);
      const vadThreshold = quietRecording || mostlySilentRecording
        ? (profile === "primary" ? 0.28 : 0.24)
        : clippedRecording
          ? (profile === "primary" ? 0.48 : 0.42)
          : noisyRecording
            ? (profile === "primary" ? 0.52 : 0.44)
          : (profile === "primary" ? 0.38 : 0.32);
      const vadMinSpeechDurationMs = quietRecording ? 70 : noisyRecording ? 140 : profile === "primary" ? 110 : 80;
      const vadMinSilenceDurationMs = quietRecording ? 440 : noisyRecording ? 260 : profile === "primary" ? 300 : 420;
      const vadSpeechPadMs = quietRecording ? 280 : noisyRecording ? 160 : profile === "primary" ? 180 : 240;
      const vadSamplesOverlap = profile === "primary" ? 0.25 : 0.30;
      const timeoutMs = options.maxPassMs
        ? Math.max(1_500, Math.min(5_000, options.maxPassMs))
        : Math.max(30_000, Math.min(90_000, selection.targetLatencyMs * 3));
      const args = [
        "-m", selection.path,
        "-f", audioPath,
        "-l", options.language ?? "nl",
        "-t", String(selection.threadCount),
        "-bs", String(profile === "rescue" ? Math.min(5, decoding.beamSize) : decoding.beamSize),
        "-bo", String(decoding.bestOf),
        "-mc", "224",
        "-ml", "96",
        "-sow",
        "-tp", profile === "rescue" ? "0.20" : "0.00",
        "-tpi", "0.20",
        "-ojf",
        "-of", outputBase,
        "-np",
        "-sns",
      ];
      if (vadUsed && vadModelPath && profile !== "rescue") {
        args.push(
          "--vad",
          "--vad-model", vadModelPath,
          "--vad-threshold", String(vadThreshold),
          "--vad-min-speech-duration-ms", String(vadMinSpeechDurationMs),
          "--vad-min-silence-duration-ms", String(vadMinSilenceDurationMs),
          "--vad-max-speech-duration-s", "24",
          "--vad-speech-pad-ms", String(vadSpeechPadMs),
          "--vad-samples-overlap", String(vadSamplesOverlap),
        );
      }
      if (prompt) args.push("--prompt", prompt, "--carry-initial-prompt");
      const passStartedAt = performance.now();
      try {
        const serverResult = await transcribeWithLocalWhisperServer(audio, selection, {
          language: options.language ?? "nl",
          prompt,
          beamSize: profile === "rescue" ? Math.min(5, decoding.beamSize) : decoding.beamSize,
          bestOf: decoding.bestOf,
          temperature: profile === "rescue" ? 0.2 : 0,
          vad: vadUsed && profile !== "rescue",
          vadThreshold,
          vadMinSpeechDurationMs,
          vadMinSilenceDurationMs,
          vadSpeechPadMs,
          vadSamplesOverlap,
          timeoutMs,
          allowCliFallback: !options.maxPassMs,
        });
        if (serverResult) {
          persistentServerUsed = true;
          recordLocalWhisperPerformance(selection, performance.now() - passStartedAt, audioDurationSeconds, true);
          return { ...parseTranscription(whisperServerJson(serverResult), options.scoreTranscript), name, model: selection };
        }
        await execFileAsync(cliPath, args, {
          cwd: path.dirname(cliPath),
          encoding: "utf8",
          maxBuffer: 2 * 1024 * 1024,
          timeout: timeoutMs,
          windowsHide: true,
        });
        recordLocalWhisperPerformance(selection, performance.now() - passStartedAt, audioDurationSeconds, true);
      } catch (error) {
        recordLocalWhisperPerformance(selection, performance.now() - passStartedAt, audioDurationSeconds, false);
        throw error;
      }
      const parsed = JSON.parse(await readFile(`${outputBase}.json`, "utf8")) as WhisperJson;
      return { ...parseTranscription(parsed, options.scoreTranscript), name, model: selection };
    };

    let primary: TranscriptionPass;
    try {
      primary = await runPass("primary", options.primaryPrompt, "primary", activeModel);
    } catch (error) {
      if (options.maxPassMs) {
        throw new DomainError(
          "De lokale eindcontrole bereikte de tijdslimiet. Gebruik live tekst voor een snelle, menu-gegronde fallback of probeer opnieuw.",
          "TRANSCRIPTION_BUDGET_EXCEEDED",
          504,
        );
      }
      const fallback = selectLocalWhisperModel({}, [activeModel.id]);
      if (!fallback) {
        const message = error instanceof Error ? error.message : String(error);
        console.error("Offline transcription failed:", message);
        throw new DomainError(
          "Lokale spraakherkenning kon de opname niet verwerken. Probeer opnieuw en spreek iets dichter bij de microfoon.",
          "OFFLINE_TRANSCRIPTION_FAILED",
          502,
        );
      }
      console.warn(`Local speech model ${activeModel.id} failed; retrying with ${fallback.id}.`);
      activeModel = fallback;
      fallbackUsed = true;
      try {
        primary = await runPass("primary-fallback", options.primaryPrompt, "primary", activeModel);
      } catch (fallbackError) {
        console.error("Offline transcription fallback failed:", fallbackError);
        throw new DomainError(
          "Lokale spraakherkenning kon de opname niet verwerken. Probeer opnieuw en spreek iets dichter bij de microfoon.",
          "OFFLINE_TRANSCRIPTION_FAILED",
          502,
        );
      }
    }

    const decoding = decodingProfile(activeModel);
    const shouldRetry = Boolean(
      options.retryPrompt &&
      !options.maxPassMs &&
      (decoding.maxPasses >= 2 || strongestModel?.id !== activeModel.id) &&
      primary.confidence < decoding.retryConfidence &&
      primary.score < 5,
    );
    let retry: TranscriptionPass | undefined;
    if (shouldRetry && options.retryPrompt) {
      try {
        const retryModel = strongestModel && strongestModel.id !== activeModel.id ? strongestModel : activeModel;
        retry = await runPass("context-retry", options.retryPrompt, "context", retryModel);
      } catch (error) {
        console.warn("Context transcription retry failed; primary transcript remains active:", error);
      }
    }
    const firstPasses = [primary, ...(retry ? [retry] : [])];
    const bestFirstPass = [...firstPasses].sort((left, right) => passQuality(right) - passQuality(left))[0];
    const needsRescue = Boolean(
      options.retryPrompt &&
      !options.maxPassMs &&
      decoding.maxPasses >= 3 &&
      retry &&
      bestFirstPass.confidence < 0.58 &&
      bestFirstPass.score <= 0,
    );
    let rescue: TranscriptionPass | undefined;
    if (needsRescue && options.retryPrompt) {
      try {
        rescue = await runPass("acoustic-rescue", options.retryPrompt, "rescue", activeModel);
      } catch (error) {
        console.warn("Acoustic rescue transcription failed; prior hypotheses remain active:", error);
      }
    }
    const passes = [...firstPasses, ...(rescue ? [rescue] : [])]
      .sort((left, right) => passQuality(right) - passQuality(left));
    const selected = passes[0];
    const selectedModel = selected.model ?? activeModel;
    if (!selected.text || selected.turns.length === 0) {
      throw new DomainError(
        "Ik hoorde geen duidelijke spraak. Probeer opnieuw in een stillere omgeving.",
        "NO_SPEECH_DETECTED",
        422,
      );
    }

    const hypotheses = passes
      .filter((pass, index, values) => values.findIndex((candidate) => candidate.text === pass.text) === index)
      .slice(0, 5)
      .map((pass): OfflineTranscriptionHypothesis => ({
        text: pass.text,
        confidence: Number(pass.confidence.toFixed(3)),
        menuScore: Number(pass.score.toFixed(3)),
        totalScore: Number(passQuality(pass).toFixed(3)),
        pass: pass.name,
        selected: pass === selected,
      }));
    const hypothesisMargin = hypotheses.length > 1
      ? Number((hypotheses[0].totalScore - hypotheses[1].totalScore).toFixed(3))
      : hypotheses[0]?.totalScore ?? 0;
    return {
      text: selected.text,
      turns: selected.turns,
      language: selected.language,
      engine: "whisper.cpp",
      confidence: Number(selected.confidence.toFixed(3)),
      vadUsed,
      vadProfile: quietRecording || mostlySilentRecording ? "quiet" : clippedRecording ? "clipped" : noisyRecording ? "noisy" : "balanced",
      secondPassAttempted: Boolean(retry || rescue),
      secondPassSelected: selected !== primary,
      hypothesisMargin,
      hypotheses,
      localModel: {
        id: selectedModel.id,
        label: selectedModel.label,
        tier: selectedModel.tier,
        threadCount: selectedModel.threadCount,
        policy: selectedModel.policy,
        fallbackUsed,
        runtime: persistentServerUsed ? "persistent-server" : "cli",
        processingMs: Math.round(performance.now() - processingStartedAt),
        audioDurationSeconds: Number(audioDurationSeconds.toFixed(2)),
      },
      retained: false,
    };
  } finally {
    await rm(workingDirectory, { recursive: true, force: true });
  }
}

export async function transcribeHospitalityAudioOffline(
  file: File,
  options: OfflineTranscriptionOptions,
): Promise<OfflineTranscriptionResult> {
  return withLocalSpeechCapacity(() => transcribeHospitalityAudioOfflineUnlocked(file, options));
}
