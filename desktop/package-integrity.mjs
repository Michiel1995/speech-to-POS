import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

export const PACKAGE_CHECKSUM_MANIFEST = "CHECKSUMS-SHA256.txt";

function sha256File(filePath) {
  return createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function compareOrdinal(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function listPackageFiles(root) {
  const resolvedRoot = path.resolve(root);
  const files = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      const relative = path.relative(resolvedRoot, absolute).replaceAll("\\", "/");
      if (!relative || relative === PACKAGE_CHECKSUM_MANIFEST || relative === `${PACKAGE_CHECKSUM_MANIFEST}.new`) continue;
      if (relative.includes("\n") || relative.includes("\r")) {
        throw new Error(`Ongeldige bestandsnaam in package: ${relative}`);
      }
      if (entry.isSymbolicLink()) {
        throw new Error(`Symbolische koppelingen zijn niet toegestaan in de package: ${relative}`);
      }
      if (entry.isDirectory()) visit(absolute);
      else if (entry.isFile()) files.push(relative);
      else throw new Error(`Niet-ondersteund package-item: ${relative}`);
    }
  };
  visit(resolvedRoot);
  return files.sort(compareOrdinal);
}

function safeManifestPath(root, relative) {
  if (!relative || path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) return undefined;
  const resolvedRoot = path.resolve(root);
  const absolute = path.resolve(resolvedRoot, relative.replaceAll("/", path.sep));
  if (absolute === resolvedRoot || !absolute.startsWith(`${resolvedRoot}${path.sep}`)) return undefined;
  return absolute;
}

export function writePackageChecksums(root) {
  const files = listPackageFiles(root);
  const contents = `${files.map((relative) => `${sha256File(path.join(root, relative))}  ${relative}`).join("\r\n")}\r\n`;
  const manifest = path.join(root, PACKAGE_CHECKSUM_MANIFEST);
  const temporary = `${manifest}.new`;
  fs.writeFileSync(temporary, contents, { encoding: "utf8", flag: "w" });
  fs.renameSync(temporary, manifest);
  return {
    files: files.length,
    manifestSha256: createHash("sha256").update(contents).digest("hex"),
  };
}

export function verifyPackageChecksums(root) {
  const manifestPath = path.join(root, PACKAGE_CHECKSUM_MANIFEST);
  if (!fs.existsSync(manifestPath)) {
    return { ok: false, checkedFiles: 0, expectedFiles: 0, missingFiles: [], mismatchedFiles: [], unexpectedFiles: [], invalidEntries: ["manifest ontbreekt"] };
  }
  const expected = new Map();
  const invalidEntries = [];
  const lines = fs.readFileSync(manifestPath, "utf8").split(/\r?\n/).filter(Boolean);
  for (const [index, line] of lines.entries()) {
    const match = /^([0-9a-f]{64}) {2}(.+)$/i.exec(line);
    if (!match) {
      invalidEntries.push(`regel ${index + 1}`);
      continue;
    }
    const relative = match[2].replaceAll("\\", "/");
    if (!safeManifestPath(root, relative) || relative === PACKAGE_CHECKSUM_MANIFEST || expected.has(relative)) {
      invalidEntries.push(`regel ${index + 1}`);
      continue;
    }
    expected.set(relative, match[1].toLowerCase());
  }
  const actual = listPackageFiles(root);
  const actualSet = new Set(actual);
  const missingFiles = [];
  const mismatchedFiles = [];
  let checkedFiles = 0;
  for (const [relative, checksum] of expected) {
    if (!actualSet.has(relative)) {
      missingFiles.push(relative);
      continue;
    }
    const absolute = safeManifestPath(root, relative);
    if (!absolute || sha256File(absolute) !== checksum) mismatchedFiles.push(relative);
    checkedFiles += 1;
  }
  const unexpectedFiles = actual.filter((relative) => !expected.has(relative));
  return {
    ok: invalidEntries.length === 0 && missingFiles.length === 0 && mismatchedFiles.length === 0 && unexpectedFiles.length === 0 && checkedFiles === expected.size,
    checkedFiles,
    expectedFiles: expected.size,
    missingFiles,
    mismatchedFiles,
    unexpectedFiles,
    invalidEntries,
  };
}
