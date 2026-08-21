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
  signal?: AbortSignal;
}

export type LocalWhisperServerFailureKind = "startup-timeout" | "inference-timeout" | "runtime-unavailable";

export class LocalWhisperServerError extends Error {
  constructor(
    message: string,
    readonly kind: LocalWhisperServerFailureKind,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "LocalWhisperServerError";
  }
}

export interface LocalWhisperServerReadiness {
  state: "idle" | "loading" | "ready" | "recovering" | "failed";
  modelId?: string;
  coldStart: boolean;
  updatedAt: number;
  lastErrorKind?: LocalWhisperServerFailureKind;
}

export type LocalWhisperReadinessEvent =
  | { type: "start"; modelId: string }
  | { type: "ready"; modelId: string }
  | { type: "request-timeout" }
  | { type: "recover"; kind: LocalWhisperServerFailureKind; modelId?: string }
  | { type: "fail"; kind: LocalWhisperServerFailureKind; modelId?: string }
  | { type: "stop" };

interface RunningWhisperServer {
  modelId: string;
  origin: string;
  process: ChildProcess;
  startupError?: Error;
  ready?: Promise<void>;
  prime?: Promise<void>;
  idleTimer?: NodeJS.Timeout;
}

let runningServer: RunningWhisperServer | undefined;
let cleanupRegistered = false;
let readiness: LocalWhisperServerReadiness = {
  state: "idle",
  coldStart: true,
  updatedAt: Date.now(),
};

export function localWhisperServerReadiness(): LocalWhisperServerReadiness {
  return { ...readiness };
}

export function transitionLocalWhisperReadiness(
  current: LocalWhisperServerReadiness,
  event: LocalWhisperReadinessEvent,
  now = Date.now(),
): LocalWhisperServerReadiness {
  if (event.type === "request-timeout") return { ...current, updatedAt: now };
  if (event.type === "start") return { state: "loading", modelId: event.modelId, coldStart: true, updatedAt: now };
  if (event.type === "ready") return { state: "ready", modelId: event.modelId, coldStart: false, updatedAt: now };
  if (event.type === "recover") return { state: "recovering", modelId: event.modelId ?? current.modelId, coldStart: true, updatedAt: now, lastErrorKind: event.kind };
  if (event.type === "fail") return { state: "failed", modelId: event.modelId ?? current.modelId, coldStart: true, updatedAt: now, lastErrorKind: event.kind };
  return { state: "idle", coldStart: true, updatedAt: now };
}

function moveReadiness(event: LocalWhisperReadinessEvent): void {
  readiness = transitionLocalWhisperReadiness(readiness, event);
}

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

function stopWhisperServer(
  nextState: LocalWhisperServerReadiness["state"] = "idle",
  failureKind: LocalWhisperServerFailureKind = "runtime-unavailable",
): void {
  if (!runningServer) return;
  if (runningServer.idleTimer) clearTimeout(runningServer.idleTimer);
  if (!runningServer.process.killed) runningServer.process.kill();
  runningServer = undefined;
  if (nextState === "recovering") moveReadiness({ type: "recover", kind: failureKind });
  else if (nextState === "failed") moveReadiness({ type: "fail", kind: readiness.lastErrorKind ?? "runtime-unavailable" });
  else moveReadiness({ type: "stop" });
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
      throw new LocalWhisperServerError("Lokale spraakserver stopte tijdens het laden.", "runtime-unavailable");
    }
    try {
      const response = await fetch(`${server.origin}/`, { signal: AbortSignal.timeout(1_000) });
      if (response.ok) return;
    } catch {
      // Model is still loading.
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new LocalWhisperServerError("Lokale spraakserver startte niet binnen de maximale opstarttijd.", "startup-timeout");
}

function abortError(): DOMException {
  return new DOMException("Spraakverwerking geannuleerd.", "AbortError");
}

async function waitWithinBudget<T>(
  promise: Promise<T>,
  timeoutMs: number,
  signal: AbortSignal | undefined,
  kind: LocalWhisperServerFailureKind,
): Promise<T> {
  if (signal?.aborted) throw abortError();
  return await new Promise<T>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
      callback();
    };
    const abort = () => finish(() => reject(abortError()));
    const timer = setTimeout(() => finish(() => reject(new LocalWhisperServerError(
      kind === "startup-timeout"
        ? "Het lokale model was niet tijdig klaar."
        : "De lokale transcriptie overschreed haar tijdsbudget.",
      kind,
    ))), Math.max(1, timeoutMs));
    timer.unref();
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function ensureWhisperServer(
  selection: LocalWhisperSelection,
  maxWaitMs = 45_000,
  signal?: AbortSignal,
): Promise<RunningWhisperServer | undefined> {
  const serverPath = configuredServerPath();
  if (!serverPath) return undefined;
  if (runningServer?.modelId === selection.id && runningServer.process.exitCode === null) {
    const existing = runningServer;
    await waitWithinBudget(existing.ready ?? Promise.resolve(), maxWaitMs, signal, "startup-timeout");
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
  };
  moveReadiness({ type: "start", modelId: selection.id });
  // Drain provider output without retaining it: whisper.cpp may echo decoded
  // text, which must never enter application logs or diagnostics.
  child.stdout?.resume();
  child.stderr?.resume();
  child.once("error", (error) => {
    server.startupError = error;
    if (runningServer === server) runningServer = undefined;
  });
  child.once("exit", () => {
    if (runningServer === server) runningServer = undefined;
  });
  runningServer = server;
  registerCleanup();
  server.ready = waitUntilReady(server).then(() => {
    if (runningServer === server) moveReadiness({ type: "ready", modelId: selection.id });
  }).catch((error) => {
    const failure = error instanceof LocalWhisperServerError
      ? error
      : new LocalWhisperServerError("De lokale spraakserver kon niet starten.", "runtime-unavailable", error);
    if (runningServer === server) {
      moveReadiness({ type: "fail", modelId: selection.id, kind: failure.kind });
      stopWhisperServer("failed");
    }
    throw failure;
  });
  try {
    await waitWithinBudget(server.ready, maxWaitMs, signal, "startup-timeout");
    scheduleIdleUnload(server);
    return server;
  } catch (error) {
    // A request deadline must not kill the shared single-flight warmup. A
    // later request can reuse the model as soon as that same load completes.
    if (error instanceof LocalWhisperServerError && error.kind === "startup-timeout") {
      moveReadiness({ type: "request-timeout" });
    } else if (runningServer === server) {
      stopWhisperServer("recovering");
    }
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
  } catch {
    console.warn("Lokale spraakserver kon niet vooraf worden geladen; herstel blijft beschikbaar bij de volgende opname.");
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
    const startedAt = performance.now();
    server = await ensureWhisperServer(selection, options.timeoutMs, options.signal);
    if (!server) return undefined;
    if (server.prime) {
      const remainingPrimeMs = Math.max(1, options.timeoutMs - (performance.now() - startedAt));
      await waitWithinBudget(server.prime, remainingPrimeMs, options.signal, "startup-timeout");
    }
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
    const remainingMs = Math.max(1, options.timeoutMs - (performance.now() - startedAt));
    const response = await waitWithinBudget(fetch(`${server.origin}/inference`, {
      method: "POST",
      body: form,
      signal: options.signal,
    }), remainingMs, options.signal, "inference-timeout");
    if (!response.ok) {
      throw new Error(`Lokale spraakserver gaf status ${response.status}: ${(await response.text()).slice(0, 500)}`);
    }
    return await response.json() as WhisperServerVerboseJson;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    const failure = error instanceof LocalWhisperServerError
      ? error
      : new LocalWhisperServerError("De lokale spraakserver is niet beschikbaar.", "runtime-unavailable", error);
    // Startup may continue in the single shared background load. An inference
    // timeout can leave whisper.cpp occupied, so that process is restarted.
    if (failure.kind !== "startup-timeout") stopWhisperServer("recovering", failure.kind);
    if (options.allowCliFallback === false) throw error;
    if (failure.kind === "inference-timeout") throw failure;
    return undefined;
  } finally {
    if (server && runningServer === server) scheduleIdleUnload(server);
  }
}
