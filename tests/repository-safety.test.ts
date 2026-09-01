import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

// The production entrypoint intentionally stays plain ESM so CI can execute it
// before installing or compiling application dependencies.
// @ts-expect-error The dependency-free .mjs safety script has no TypeScript declarations.
import { auditRepositoryEntries, MAX_REPOSITORY_FILE_BYTES } from "../scripts/repository-safety.mjs";

function entry(path: string, value = "safe source", size = Buffer.byteLength(value)) {
  return { path, size, content: Buffer.from(value) };
}

describe("repository safety gate", () => {
  it("accepts normal source files and the documented environment template", () => {
    expect(auditRepositoryEntries([
      entry("src/order.ts", "export const order = true;"),
      entry(".env.example", "OPENAI_API_KEY=replace-me"),
    ])).toEqual([]);
  });

  it.each([
    [".env.local", "lokaal omgevingsbestand"],
    ["offline-speech/models/ggml-large.bin", "lokale spraakruntime of modelgewicht"],
    ["offline-speech/bin/whisper-cli.exe", "lokale spraakruntime of modelgewicht"],
    ["fixtures/table-recording.wav", "privacygevoelige audio-opname"],
    ["release/Service Ears.msi", "gegenereerd Windows-artefact"],
    ["certificates/signing.pfx", "privésleutel of certificaatbundel"],
  ])("blocks unsafe publishable path %s", (path, reason) => {
    expect(auditRepositoryEntries([entry(path)])).toEqual([
      expect.objectContaining({ path, type: "forbidden-path", reason }),
    ]);
  });

  it("blocks files larger than the repository limit", () => {
    const issues = auditRepositoryEntries([entry("fixtures/corpus.json", "", MAX_REPOSITORY_FILE_BYTES + 1)]);
    expect(issues).toEqual([
      expect.objectContaining({ path: "fixtures/corpus.json", type: "oversized-file" }),
    ]);
  });

  it.each([
    [`OPENAI_API_KEY=${["sk", "proj", "1234567890abcdefghij"].join("-")}`, "mogelijke OpenAI API-sleutel"],
    [`GITHUB_TOKEN=${["ghp", "1234567890abcdefghij"].join("_")}`, "mogelijk GitHub-token"],
    [`aws=${["AKIA", "1234567890ABCDEF"].join("")}`, "mogelijke AWS access key"],
    [["-----BEGIN", "PRIVATE KEY-----"].join(" "), "mogelijke privésleutel"],
  ])("detects %s", (value, reason) => {
    expect(auditRepositoryEntries([entry("config.txt", value)])).toEqual([
      expect.objectContaining({ path: "config.txt", type: "possible-secret", reason }),
    ]);
  });

  it("does not decode binary content as text", () => {
    expect(auditRepositoryEntries([{
      path: "public/icon.png",
      size: 32,
      content: Buffer.from([0, 115, 107, 45, 112, 114, 111, 106]),
    }])).toEqual([]);
  });
});
