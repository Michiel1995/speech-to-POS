import { spawn } from "node:child_process";
import { once } from "node:events";
import fs from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runtimeRoot = process.env.TEST_RUNTIME_ROOT || path.join(projectRoot, "desktop-runtime");
const speechRoot = process.env.TEST_SPEECH_ROOT || path.join(projectRoot, "offline-speech");
const wavPath = process.env.TEST_WAV || path.join(os.tmpdir(), "service-ears-speech-test", "order.wav");
const serverExecutable = process.env.TEST_SERVER_EXECUTABLE || process.execPath;
const electronNodeMode = Boolean(process.env.TEST_SERVER_EXECUTABLE);

async function freePort() {
  return new Promise((resolve, reject) => {
    const listener = net.createServer();
    listener.on("error", reject);
    listener.listen(0, "127.0.0.1", () => {
      const address = listener.address();
      listener.close(() => typeof address === "object" && address
        ? resolve(address.port)
        : reject(new Error("No test port available.")));
    });
  });
}

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
const testStartedAt = performance.now();
const server = spawn(serverExecutable, ["server-bootstrap.cjs"], {
  cwd: runtimeRoot,
  env: {
    ...process.env,
    ...(electronNodeMode ? { ELECTRON_RUN_AS_NODE: "1" } : {}),
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    NODE_PATH: path.join(runtimeRoot, "runtime_modules"),
    POS_ADAPTER: "mock",
    ORDER_ENGINE_MODE: "deterministic",
    LOCAL_WHISPER_CLI: path.join(speechRoot, "bin", "whisper-cli.exe"),
    LOCAL_WHISPER_SERVER: path.join(speechRoot, "bin", "whisper-server.exe"),
    LOCAL_WHISPER_MODEL: path.join(speechRoot, "models", "ggml-small-q5_1.bin"),
    LOCAL_WHISPER_MODELS_DIRS: path.join(speechRoot, "models"),
    LOCAL_WHISPER_VAD_MODEL: path.join(speechRoot, "models", "ggml-silero-v6.2.0.bin"),
    LOCAL_WHISPER_MODEL_POLICY: process.env.TEST_MODEL_POLICY || "adaptive",
    LOCAL_WHISPER_MAX_THREADS: "6",
    LOCAL_WHISPER_TARGET_LATENCY_MS: "30000",
    LOCAL_WHISPER_IDLE_UNLOAD_MS: "180000",
    LOCAL_WHISPER_BACKEND: "CPU/BLAS",
  },
  windowsHide: true,
  stdio: ["ignore", "pipe", "pipe"],
});

let serverOutput = "";
server.stdout.on("data", (chunk) => { serverOutput += chunk.toString(); });
server.stderr.on("data", (chunk) => { serverOutput += chunk.toString(); });

try {
  let health;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(`${origin}/api/health`);
      if (response.ok) {
        health = await response.json();
        break;
      }
    } catch {
      // The standalone server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  if (!health) throw new Error(`Standalone server did not start.\n${serverOutput}`);
  const healthReadyMs = Math.round(performance.now() - testStartedAt);

  let explicitWarmupMs;
  let warmupResult;
  if (process.env.TEST_WARMUP === "1") {
    const warmupStartedAt = performance.now();
    const warmupResponse = await fetch(`${origin}/api/transcribe/warmup`, { method: "POST" });
    warmupResult = await warmupResponse.json();
    explicitWarmupMs = Math.round(performance.now() - warmupStartedAt);
    if (!warmupResponse.ok || !warmupResult.warmed) {
      throw new Error(`Speech warmup failed: ${JSON.stringify(warmupResult)}\n${serverOutput}`);
    }
  }

  const audio = await fs.readFile(wavPath);
  async function transcribeAudio() {
    const form = new FormData();
    form.append("audio", new Blob([audio], { type: "audio/wav" }), "order.wav");
    form.append("language", "nl");
    form.append("contextProductIds", JSON.stringify(["POS-1001", "POS-3001"]));
    const response = await fetch(`${origin}/api/transcribe`, { method: "POST", body: form });
    const result = await response.json();
    if (!response.ok) throw new Error(`Transcription failed: ${JSON.stringify(result)}\n${serverOutput}`);
    return result;
  }
  const coldStartedAt = performance.now();
  const coldTranscript = await transcribeAudio();
  const coldTranscriptionMs = Math.round(performance.now() - coldStartedAt);
  const warmStartedAt = performance.now();
  const transcript = await transcribeAudio();
  const warmTranscriptionMs = Math.round(performance.now() - warmStartedAt);

  const orderResponse = await fetch(`${origin}/api/interpret`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tenantId: "tenant-demo-brussels",
      tableId: "TABLE-12",
      tableLabel: "Table 12",
      waiterId: "waiter-demo",
      source: "audio",
      engine: "deterministic",
      turns: transcript.turns,
    }),
  });
  const order = await orderResponse.json();
  if (!orderResponse.ok) throw new Error(`Interpretation failed: ${JSON.stringify(order)}\n${serverOutput}`);

  const summary = {
    health: health.ok,
    serverStartupMs: healthReadyMs,
    explicitWarmupMs,
    warmedModel: warmupResult?.model?.label,
    coldTranscriptionMs,
    warmTranscriptionMs,
    coldTranscript: coldTranscript.text,
    offlineSpeech: health.offlineSpeechConfigured,
    transcript: transcript.text,
    language: transcript.language,
    engine: transcript.engine,
    confidence: transcript.confidence,
    vadUsed: transcript.vadUsed,
    secondPassAttempted: transcript.secondPassAttempted,
    secondPassSelected: transcript.secondPassSelected,
    selectedModel: transcript.localModel?.label,
    modelTier: transcript.localModel?.tier,
    fallbackUsed: transcript.localModel?.fallbackUsed,
    modelProcessingMs: transcript.localModel?.processingMs,
    modelRuntime: transcript.localModel?.runtime,
    lines: order.draft.lines.map((line) => `${line.quantity}x ${line.canonicalName}`),
    modifiers: order.draft.lines.flatMap((line) => line.modifiers.map((modifier) => modifier.optionId)),
    productIds: order.draft.lines.map((line) => line.productId),
    issues: order.draft.issues.length,
  };
  console.log(JSON.stringify(summary, null, 2));
  if (!summary.productIds.includes("POS-3001") || !summary.productIds.includes("POS-1001")) {
    throw new Error(`Expected order lines were not produced.\n${JSON.stringify(summary, null, 2)}`);
  }
  if (!order.draft.lines.some((line) => line.productId === "POS-1001" && line.quantity === 2)) {
    throw new Error(`Spoken quantity variant was not recovered as two Duvel.\n${JSON.stringify(summary, null, 2)}`);
  }
  if (!summary.modifiers.includes("MOD-FRIES") || !summary.modifiers.includes("MOD-PEPPER")) {
    throw new Error(`Spoken side and sauce variants were not recovered.\n${JSON.stringify(summary, null, 2)}`);
  }
  if (!summary.vadUsed || !health.offlineVadConfigured) {
    throw new Error(`Local VAD was not active.\n${JSON.stringify(summary, null, 2)}`);
  }
} finally {
  if (server.exitCode === null) {
    server.kill();
    await Promise.race([
      once(server, "exit"),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
  }
}
