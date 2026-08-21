import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { verifyPackageChecksums, writePackageChecksums } from "./package-integrity.mjs";

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

function sealPackage(root) {
  const written = writePackageChecksums(root);
  const verified = verifyPackageChecksums(root);
  if (!verified.ok || verified.checkedFiles !== written.files) {
    throw new Error(`Package-integriteit faalde voor ${root}: ${JSON.stringify(verified)}`);
  }
  return { files: verified.checkedFiles, manifestSha256: written.manifestSha256 };
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
fs.writeFileSync(path.join(browserTarget, "VERSIE.txt"), "Service Ears 0.3.11 browsertest\r\nStabiele voorlopige Review, monotone bewerkingen, lokale p50/p95-meting en POS read-back\r\n", "utf8");
const browserIntegrity = sealPackage(browserTarget);

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
      ? "Service Ears 0.3.11 adaptief lokaal\r\nVoorverwarmde Small-route + Large-v3 Turbo-controle bij echte twijfel + ruisadaptieve Silero VAD\r\nVoorlopige Review, race-veilige bewerkingen, versieerbaar herstel en bevestigde POS read-back\r\n"
      : "Service Ears 0.3.11 licht lokaal\r\nVoorverwarmde Small Q5 + ruisadaptieve Silero VAD\r\nVoorlopige Review, race-veilige bewerkingen, versieerbaar herstel en bevestigde POS read-back\r\n",
    "utf8",
  );
  return { target, integrity: sealPackage(target) };
}

const adaptiveLocal = prepareLocalPackage("Service-Ears-3.5-Lokaal-Adaptief", true);
const lightLocal = prepareLocalPackage("Service-Ears-3.5-Lokaal-Licht", false);

console.log(JSON.stringify({
  browserTarget,
  browserIntegrity,
  adaptiveLocalTarget: adaptiveLocal.target,
  adaptiveLocalIntegrity: adaptiveLocal.integrity,
  lightLocalTarget: lightLocal.target,
  lightLocalIntegrity: lightLocal.integrity,
}, null, 2));
