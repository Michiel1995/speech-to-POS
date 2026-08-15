import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import type { LocalWhisperSelection } from "@/src/speech/local-model-manager";

export interface WhisperServerVerboseJson {
  task?: string;
  language?: string;
  duration?: number;
  text?: string;
  segments?: Array<{
    id?: number;
    start?: number;
    end?: number;
    text?: string;
    words?: Array<{
      word?: string;
      start?: number;
      end?: number;
      probability?: number;
    }>;
  }>;
}

export interface WhisperServerPassOptions {
  language: string;
  prompt: string;
  beamSize: number;
  bestOf: number;
  temperature: number;
  vad: boolean;
  vadThreshold: number;
  vadMinSpeechDurationMs: number;
  vadMinSilenceDurationMs: number;
  vadSpeechPadMs: number;
  vadSamplesOverlap: number;
  timeoutMs: number;
  allowCliFallback?: boolean;
}

interface RunningWhisperServer {
  modelId: string;
  origin: string;
  process: ChildProcess;
  logTail: string;
  startupError?: Error;
  ready?: Promise<void>;
  prime?: Promise<void>;
  idleTimer?: NodeJS.Timeout;
}

let runningServer: RunningWhisperServer | undefined;
let cleanupRegistered = false;

function configuredServerPath(): string | undefined {
  const configured = process.env.LOCAL_WHISPER_SERVER;
  return configured && existsSync(configured) ? configured : undefined;
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.unref();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => typeof address === "object" && address
        ? resolve(address.port)
        : reject(new Error("Geen vrije poort voor de lokale spraakserver.")));
    });
  });
}

function stopWhisperServer(): void {
  if (!runningServer) return;
  if (runningServer.idleTimer) clearTimeout(runningServer.idleTimer);
  if (!runningServer.process.killed) runningServer.process.kill();
  runningServer = undefined;
}

function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.once("exit", stopWhisperServer);
  process.once("SIGINT", () => { stopWhisperServer(); process.exit(0); });
  process.once("SIGTERM", () => { stopWhisperServer(); process.exit(0); });
}

function scheduleIdleUnload(server: RunningWhisperServer): void {
  if (server.idleTimer) clearTimeout(server.idleTimer);
  const configured = Number(process.env.LOCAL_WHISPER_IDLE_UNLOAD_MS);
  const idleMs = Number.isFinite(configured) ? Math.max(30_000, configured) : 3 * 60 * 1_000;
  server.idleTimer = setTimeout(() => {
    if (runningServer === server) stopWhisperServer();
  }, idleMs);
  server.idleTimer.unref();
}

async function waitUntilReady(server: RunningWhisperServer): Promise<void> {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (server.startupError) throw server.startupError;
    if (server.process.exitCode !== null) {
      throw new Error(`Lokale spraakserver stopte tijdens het laden. ${server.logTail.slice(-1_000)}`);
    }
    try {
      const response = await fetch(`${server.origin}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Model is still loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`Lokale spraakserver startte niet op tijd. ${server.logTail.slice(-1_000)}`);
}

async function ensureWhisperServer(selection: LocalWhisperSelection): Promise<RunningWhisperServer | undefined> {
  const serverPath = configuredServerPath();
  if (!serverPath) return undefined;
  if (runningServer?.modelId === selection.id && runningServer.process.exitCode === null) {
    const existing = runningServer;
    await existing.ready;
    if (existing.startupError || existing.process.exitCode !== null || runningServer !== existing) {
      throw existing.startupError ?? new Error("Lokale spraakserver stopte tijdens het laden.");
    }
    scheduleIdleUnload(existing);
    return existing;
  }
  stopWhisperServer();
  const port = await freePort();
  const vadModelPath = process.env.LOCAL_WHISPER_VAD_MODEL;
  const args = [
    "-m", selection.path,
    "--host", "127.0.0.1",
    "--port", String(port),
    "-t", String(selection.threadCount),
    "-mc", "224",
    "-ml", "96",
    "-sow",
    "-sns",
    "-nlp",
    "-ng",
  ];
  if (vadModelPath && existsSync(vadModelPath)) args.push("-vm", vadModelPath);
  const child = spawn(serverPath, args, {
    cwd: path.dirname(serverPath),
    windowsHide: true,
    env: {
      ...process.env,
      OPENBLAS_NUM_THREADS: String(selection.threadCount),
      OMP_NUM_THREADS: String(selection.threadCount),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL);
  } catch {
    // The portable launcher also starts the parent below normal on Windows.
  }
  const server: RunningWhisperServer = {
    modelId: selection.id,
    origin: `http://127.0.0.1:${port}`,
    process: child,
    logTail: "",
  };
  const appendLog = (chunk: Buffer) => {
    server.logTail = `${server.logTail}${chunk.toString("utf8")}`.slice(-8_000);
  };
  child.stdout?.on("data", appendLog);
  child.stderr?.on("data", appendLog);
  child.once("error", (error) => {
    server.startupError = error;
    if (runningServer === server) runningServer = undefined;
  });
  child.once("exit", () => {
    if (runningServer === server) runningServer = undefined;
  });
  runningServer = server;
  registerCleanup();
  server.ready = waitUntilReady(server);
  try {
    await server.ready;
    scheduleIdleUnload(server);
    return server;
  } catch (error) {
    stopWhisperServer();
    throw error;
  }
}

export async function warmLocalWhisperServer(selection: LocalWhisperSelection): Promise<boolean> {
  try {
    const server = await ensureWhisperServer(selection);
    if (!server) return false;
    server.prime ??= primeWhisperServer(server);
    await server.prime;
    scheduleIdleUnload(server);
    return true;
  } catch (error) {
    console.warn("Lokale spraakserver kon niet vooraf worden geladen; de normale fallback blijft beschikbaar:", error);
    stopWhisperServer();
    return false;
  }
}

export function createWhisperWarmupWav(durationMs = 500, sampleRate = 16_000): Uint8Array<ArrayBuffer> {
  const sampleCount = Math.max(1, Math.round(sampleRate * Math.max(100, durationMs) / 1_000));
  const pcmBytes = sampleCount * 2;
  const wav = new Uint8Array(new ArrayBuffer(44 + pcmBytes));
  const view = new DataView(wav.buffer);
  const ascii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) wav[offset + index] = value.charCodeAt(index);
  };
  ascii(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes, true);
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, "data");
  view.setUint32(40, pcmBytes, true);
  return wav;
}

async function primeWhisperServer(server: RunningWhisperServer): Promise<void> {
  const form = new FormData();
  form.append("file", new Blob([createWhisperWarmupWav()], { type: "audio/wav" }), "warmup.wav");
  append(form, "language", "nl");
  append(form, "response_format", "json");
  append(form, "prompt", "horeca bestelling");
  append(form, "beam_size", 1);
  append(form, "best_of", 1);
  append(form, "max_context", 64);
  append(form, "max_len", 16);
  append(form, "temperature", 0);
  append(form, "vad", false);
  const response = await fetch(`${server.origin}/inference`, {
    method: "POST",
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`Lokale spraakserver kon niet worden geprimed: ${response.status} ${(await response.text()).slice(0, 300)}`);
  }
}

function append(form: FormData, name: string, value: string | number | boolean): void {
  form.append(name, String(value));
}

export async function transcribeWithLocalWhisperServer(
  audio: ArrayBuffer,
  selection: LocalWhisperSelection,
  options: WhisperServerPassOptions,
): Promise<WhisperServerVerboseJson | undefined> {
  let server: RunningWhisperServer | undefined;
  try {
    server = await ensureWhisperServer(selection);
    if (!server) return undefined;
    if (server.idleTimer) clearTimeout(server.idleTimer);
    const form = new FormData();
    form.append("file", new Blob([audio], { type: "audio/wav" }), "recording.wav");
    append(form, "language", options.language);
    append(form, "response_format", "verbose_json");
    append(form, "prompt", options.prompt);
    append(form, "carry_initial_prompt", true);
    append(form, "beam_size", options.beamSize);
    append(form, "best_of", options.bestOf);
    append(form, "max_context", 224);
    append(form, "max_len", 96);
    append(form, "split_on_word", true);
    append(form, "temperature", options.temperature);
    append(form, "temperature_inc", 0.2);
    append(form, "suppress_nst", true);
    append(form, "no_language_probabilities", true);
    append(form, "vad", options.vad);
    if (options.vad) {
      append(form, "vad_threshold", options.vadThreshold);
      append(form, "vad_min_speech_duration_ms", options.vadMinSpeechDurationMs);
      append(form, "vad_min_silence_duration_ms", options.vadMinSilenceDurationMs);
      append(form, "vad_max_speech_duration_s", 24);
      append(form, "vad_speech_pad_ms", options.vadSpeechPadMs);
      append(form, "vad_samples_overlap", options.vadSamplesOverlap);
    }
    const response = await fetch(`${server.origin}/inference`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) {
      throw new Error(`Lokale spraakserver gaf status ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    return await response.json() as WhisperServerVerboseJson;
  } catch (error) {
    console.warn("Persistent local whisper server unavailable; using CLI fallback:", error);
    stopWhisperServer();
    if (options.allowCliFallback === false) throw error;
    return undefined;
  } finally {
    if (server && runningServer === server) scheduleIdleUnload(server);
  }
}
