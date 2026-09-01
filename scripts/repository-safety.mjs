import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const MAX_REPOSITORY_FILE_BYTES = 50 * 1024 * 1024;
const MAX_TEXT_SCAN_BYTES = 2 * 1024 * 1024;

const FORBIDDEN_PATH_RULES = [
  { test: (path) => /(^|\/)\.env(?:\..+)?$/i.test(path) && !/(^|\/)\.env\.example$/i.test(path), reason: "lokaal omgevingsbestand" },
  { test: (path) => /(^|\/)offline-speech\/(?:bin|models)(?:\/|$)/i.test(path), reason: "lokale spraakruntime of modelgewicht" },
  { test: (path) => /(^|\/)(?:node_modules|\.next|desktop-runtime|dist-desktop)(?:\/|$)/i.test(path), reason: "gegenereerde runtime-map" },
  { test: (path) => /\.(?:wav|webm|m4a|mp3|ogg)$/i.test(path), reason: "privacygevoelige audio-opname" },
  { test: (path) => /\.(?:exe|msi|blockmap)$/i.test(path), reason: "gegenereerd Windows-artefact" },
  { test: (path) => /\.(?:pem|p12|pfx|key)$/i.test(path), reason: "privésleutel of certificaatbundel" },
];

const SECRET_RULES = [
  { pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g, reason: "mogelijke OpenAI API-sleutel" },
  { pattern: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g, reason: "mogelijk GitHub-token" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, reason: "mogelijke AWS access key" },
  { pattern: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, reason: "mogelijke privésleutel" },
];

function normalizedPath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

function looksBinary(content) {
  const sampleLength = Math.min(content.length, 8_192);
  for (let index = 0; index < sampleLength; index += 1) {
    if (content[index] === 0) return true;
  }
  return false;
}

export function auditRepositoryEntries(entries) {
  const issues = [];

  for (const entry of entries) {
    const path = normalizedPath(entry.path);
    const pathRule = FORBIDDEN_PATH_RULES.find((rule) => rule.test(path));
    if (pathRule) {
      issues.push({ path, type: "forbidden-path", reason: pathRule.reason });
    }

    if (entry.size > MAX_REPOSITORY_FILE_BYTES) {
      issues.push({
        path,
        type: "oversized-file",
        reason: `${(entry.size / 1024 / 1024).toFixed(1)} MB is groter dan de limiet van 50 MB`,
      });
    }

    if (!entry.content || entry.size > MAX_TEXT_SCAN_BYTES || looksBinary(entry.content)) continue;
    const text = entry.content.toString("utf8");
    for (const secretRule of SECRET_RULES) {
      secretRule.pattern.lastIndex = 0;
      if (secretRule.pattern.test(text)) {
        issues.push({ path, type: "possible-secret", reason: secretRule.reason });
      }
    }
  }

  return issues.sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type));
}

export function repositoryEntries(root, paths) {
  return paths.flatMap((path) => {
    const absolutePath = resolve(root, path);
    let stats;
    try {
      stats = statSync(absolutePath);
    } catch {
      return [{ path, size: 0, content: Buffer.from(""), missing: true }];
    }
    if (!stats.isFile()) return [];
    const content = stats.size <= MAX_TEXT_SCAN_BYTES ? readFileSync(absolutePath) : undefined;
    return [{ path, size: stats.size, content }];
  });
}

function publishablePaths(root) {
  const output = execFileSync(
    "git",
    ["-c", "core.quotepath=false", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
    { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  return [...new Set(output.split("\0").filter(Boolean))].sort();
}

function printIssues(issues) {
  console.error(`Repository-veiligheidscontrole vond ${issues.length} probleem/problemen:`);
  for (const issue of issues) console.error(`- ${issue.path}: ${issue.reason}`);
}

export function runRepositorySafetyCheck(root = process.cwd()) {
  const paths = publishablePaths(root);
  const entries = repositoryEntries(root, paths);
  const missing = entries.filter((entry) => entry.missing);
  const issues = auditRepositoryEntries(entries);
  for (const entry of missing) {
    issues.push({ path: entry.path, type: "missing-file", reason: "publiceerbaar bestand ontbreekt tijdens controle" });
  }

  if (issues.length) {
    printIssues(issues);
    return { ok: false, checked: paths.length, issues };
  }

  console.log(`Repository-veiligheidscontrole geslaagd: ${paths.length} publiceerbare bestanden gecontroleerd.`);
  return { ok: true, checked: paths.length, issues: [] };
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const result = runRepositorySafetyCheck();
  if (!result.ok) process.exitCode = 1;
}
