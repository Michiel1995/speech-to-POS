import fs from "node:fs";
import path from "node:path";

const root = path.resolve("evals/generated");
const expectedSplits = { development: 0.7, validation: 0.15, test: 0.15 };
const rows = [];
for (const split of Object.keys(expectedSplits)) {
  const file = path.join(root, `${split}.jsonl`);
  if (!fs.existsSync(file)) throw new Error(`Missing corpus split: ${file}`);
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/).filter(Boolean)) rows.push({ ...JSON.parse(line), expectedSplit: split });
}
const ids = new Set();
const fingerprints = new Set();
for (const item of rows) {
  if (ids.has(item.id)) throw new Error(`Duplicate case ID: ${item.id}`);
  ids.add(item.id);
  const fingerprint = item.turns.map((turn) => `${turn.speaker}:${turn.text}`).join("|");
  if (fingerprints.has(fingerprint)) throw new Error(`Duplicate transcript: ${item.id}`);
  fingerprints.add(fingerprint);
  if (item.split !== item.expectedSplit) throw new Error(`Split mismatch for ${item.id}`);
}
if (rows.length !== 5_000) throw new Error(`Expected 5000 cases, found ${rows.length}`);
const counts = Object.fromEntries(Object.keys(expectedSplits).map((split) => [split, rows.filter((item) => item.expectedSplit === split).length]));
for (const [split, target] of Object.entries(expectedSplits)) {
  const ratio = counts[split] / rows.length;
  if (ratio < target - 0.08 || ratio > target + 0.08) throw new Error(`Split ${split} is ${ratio.toFixed(3)}, outside tolerance`);
}
const reportPath = path.join(root, "REPORT.json");
const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
if (report.total !== rows.length) throw new Error("REPORT.json total does not match JSONL files");
console.log(JSON.stringify({ total: rows.length, counts, uniqueIds: ids.size, uniqueTranscripts: fingerprints.size, valid: true }, null, 2));