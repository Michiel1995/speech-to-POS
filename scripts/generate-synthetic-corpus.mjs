import { spawnSync } from "node:child_process";
import process from "node:process";

const result = spawnSync(process.execPath, ["node_modules/vitest/vitest.mjs", "run", "tests/write-synthetic-corpus.test.ts"], {
  stdio: "inherit",
  env: { ...process.env, WRITE_SYNTHETIC_CORPUS: "1" },
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);