import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";

interface PackageIntegrityModule {
  writePackageChecksums(root: string): { files: number; manifestSha256: string };
  verifyPackageChecksums(root: string): {
    ok: boolean;
    checkedFiles: number;
    expectedFiles: number;
    missingFiles: string[];
    mismatchedFiles: string[];
    unexpectedFiles: string[];
    invalidEntries: string[];
  };
}

async function loadIntegrity(): Promise<PackageIntegrityModule> {
  const moduleUrl = pathToFileURL(path.join(process.cwd(), "desktop", "package-integrity.mjs")).href;
  return import(moduleUrl) as Promise<PackageIntegrityModule>;
}

function fixture(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "service-ears-package-integrity-"));
  fs.mkdirSync(path.join(root, "app", "static"), { recursive: true });
  fs.mkdirSync(path.join(root, "offline-speech"), { recursive: true });
  fs.writeFileSync(path.join(root, "app", "server.cjs"), "server-v1");
  fs.writeFileSync(path.join(root, "app", "static", "page.js"), "page-v1");
  fs.writeFileSync(path.join(root, "offline-speech", "model.bin"), Buffer.from([1, 2, 3]));
  return root;
}

describe("complete package integrity", () => {
  it("atomically covers every packaged file and verifies a clean tree", async () => {
    const root = fixture();
    try {
      const integrity = await loadIntegrity();
      fs.writeFileSync(path.join(root, "CHECKSUMS-SHA256.txt.new"), "interrupted earlier write");
      const written = integrity.writePackageChecksums(root);
      const result = integrity.verifyPackageChecksums(root);
      expect(written.files).toBe(3);
      expect(written.manifestSha256).toMatch(/^[0-9a-f]{64}$/);
      expect(result).toMatchObject({ ok: true, checkedFiles: 3, expectedFiles: 3 });
      expect(fs.existsSync(path.join(root, "CHECKSUMS-SHA256.txt.new"))).toBe(false);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("detects changed, missing and unexpected files", async () => {
    const root = fixture();
    try {
      const integrity = await loadIntegrity();
      integrity.writePackageChecksums(root);
      fs.writeFileSync(path.join(root, "app", "server.cjs"), "tampered");
      fs.rmSync(path.join(root, "app", "static", "page.js"));
      fs.writeFileSync(path.join(root, "unexpected.txt"), "not in manifest");
      const result = integrity.verifyPackageChecksums(root);
      expect(result.ok).toBe(false);
      expect(result.mismatchedFiles).toEqual(["app/server.cjs"]);
      expect(result.missingFiles).toEqual(["app/static/page.js"]);
      expect(result.unexpectedFiles).toEqual(["unexpected.txt"]);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("rejects traversal and duplicate manifest entries", async () => {
    const root = fixture();
    try {
      const integrity = await loadIntegrity();
      integrity.writePackageChecksums(root);
      const manifest = path.join(root, "CHECKSUMS-SHA256.txt");
      const existing = fs.readFileSync(manifest, "utf8").split(/\r?\n/).find(Boolean)!;
      fs.appendFileSync(manifest, `${"a".repeat(64)}  ../outside.txt\r\n${existing}\r\n`);
      const result = integrity.verifyPackageChecksums(root);
      expect(result.ok).toBe(false);
      expect(result.invalidEntries).toHaveLength(2);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
