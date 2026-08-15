import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(projectRoot, "..", "..");
const outputsRoot = path.join(workspaceRoot, "outputs");
const runtimeRoot = path.join(projectRoot, "desktop-runtime");
const speechRoot = path.join(projectRoot, "offline-speech");
const nodeExecutable = process.env.SERVICE_EARS_NODE_RUNTIME || process.execPath;

function assertSource(filePath) {
  if (!fs.existsSync(filePath)) throw new Error(`Packagingbron ontbreekt: ${filePath}`);
}

function safeTarget(name) {
  const target = path.resolve(outputsRoot, name);
  if (path.dirname(target) !== path.resolve(outputsRoot)) throw new Error(`Onveilig outputpad: ${target}`);
  return target;
}

function prepareTarget(name, preserve = []) {
  const target = safeTarget(name);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(target)) {
    if (preserve.includes(entry)) continue;
    fs.rmSync(path.join(target, entry), { recursive: true, force: true });
  }
  return target;
}

function copy(source, destination) {
  assertSource(source);
  fs.cpSync(source, destination, { recursive: true, dereference: true, preserveTimestamps: true });
}

function syncRuntime(destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of fs.readdirSync(destination)) {
    if (entry === "runtime_modules") continue;
    fs.rmSync(path.join(destination, entry), { recursive: true, force: true });
  }
  fs.cpSync(runtimeRoot, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter(source) {
      const relative = path.relative(runtimeRoot, source);
      return relative !== "runtime_modules" && !relative.startsWith(`runtime_modules${path.sep}`);
    },
  });
  const packagedNext = path.join(destination, "runtime_modules", "next", "package.json");
  if (!fs.existsSync(packagedNext)) {
    copy(path.join(runtimeRoot, "runtime_modules"), path.join(destination, "runtime_modules"));
  }
}

function sha256(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeChecksums(root, relativeFiles) {
  const lines = relativeFiles.map((relative) => `${sha256(path.join(root, relative))}  ${relative.replaceAll("\\", "/")}`);
  fs.writeFileSync(path.join(root, "CHECKSUMS-SHA256.txt"), `${lines.join("\r\n")}\r\n`, "utf8");
}

assertSource(path.join(runtimeRoot, "server-bootstrap.cjs"));
assertSource(nodeExecutable);
fs.mkdirSync(outputsRoot, { recursive: true });

const browserTarget = prepareTarget("Service-Ears-3.5-Browsertest", ["app", "node"]);
syncRuntime(path.join(browserTarget, "app"));
fs.mkdirSync(path.join(browserTarget, "node"), { recursive: true });
fs.copyFileSync(nodeExecutable, path.join(browserTarget, "node", "node.exe"));
copy(path.join(projectRoot, "browser-test", "Start-Service-Ears-Browsertest.cmd"), path.join(browserTarget, "Start-Service-Ears-Browsertest.cmd"));
copy(path.join(projectRoot, "browser-test", "LEESMIJ.txt"), path.join(browserTarget, "LEESMIJ.txt"));
fs.writeFileSync(path.join(browserTarget, "VERSIE.txt"), "Service Ears 3.5 browsertest\r\nStabiele voorlopige Review, monotone bewerkingen, lokale p50/p95-meting en POS read-back\r\n", "utf8");
writeChecksums(browserTarget, ["node/node.exe", "app/server-bootstrap.cjs", "app/.next/BUILD_ID"]);

function syncSpeech(destination, includeStrongModel) {
  if (fs.existsSync(destination)) fs.rmSync(destination, { recursive: true, force: true });
  fs.cpSync(speechRoot, destination, {
    recursive: true,
    dereference: true,
    preserveTimestamps: true,
    filter(source) {
      return includeStrongModel || path.basename(source) !== "ggml-large-v3-turbo-q5_0.bin";
    },
  });
}

function prepareLocalPackage(name, includeStrongModel) {
  const target = prepareTarget(name, ["app", "node"]);
  syncRuntime(path.join(target, "app"));
  syncSpeech(path.join(target, "offline-speech"), includeStrongModel);
  fs.mkdirSync(path.join(target, "node"), { recursive: true });
  fs.copyFileSync(nodeExecutable, path.join(target, "node", "node.exe"));
  for (const fileName of ["Start-Service-Ears-Lokaal.cmd", "Start-Service-Ears-Lokaal.ps1", "LEESMIJ.txt", "THIRD-PARTY-NOTICES.txt"]) {
    copy(path.join(projectRoot, "portable", fileName), path.join(target, fileName));
  }
  fs.writeFileSync(
    path.join(target, "VERSIE.txt"),
    includeStrongModel
      ? "Service Ears 3.5 adaptief lokaal\r\nVoorverwarmde Small-route + Large-v3 Turbo-controle bij echte twijfel + ruisadaptieve Silero VAD\r\nVoorlopige Review, race-veilige bewerkingen, versieerbaar herstel en bevestigde POS read-back\r\n"
      : "Service Ears 3.5 licht lokaal\r\nVoorverwarmde Small Q5 + ruisadaptieve Silero VAD\r\nVoorlopige Review, race-veilige bewerkingen, versieerbaar herstel en bevestigde POS read-back\r\n",
    "utf8",
  );
  const checksumFiles = [
    "node/node.exe",
    "app/server-bootstrap.cjs",
    "app/.next/BUILD_ID",
    "offline-speech/bin/whisper-cli.exe",
    "offline-speech/bin/whisper-server.exe",
    "offline-speech/models/ggml-small-q5_1.bin",
    "offline-speech/models/ggml-silero-v6.2.0.bin",
    "Start-Service-Ears-Lokaal.cmd",
    "Start-Service-Ears-Lokaal.ps1",
  ];
  if (includeStrongModel) checksumFiles.push("offline-speech/models/ggml-large-v3-turbo-q5_0.bin");
  writeChecksums(target, checksumFiles);
  return target;
}

const adaptiveLocalTarget = prepareLocalPackage("Service-Ears-3.5-Lokaal-Adaptief", true);
const lightLocalTarget = prepareLocalPackage("Service-Ears-3.5-Lokaal-Licht", false);

console.log(JSON.stringify({ browserTarget, adaptiveLocalTarget, lightLocalTarget }, null, 2));
