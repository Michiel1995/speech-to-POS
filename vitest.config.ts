import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Wall-clock performance is measured in its own isolated process so the
    // gate reflects one production utterance, not synthetic test contention.
    exclude: ["tests/transcribe-latency-route.test.ts"],
    coverage: { reporter: ["text", "json-summary"] },
  },
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
});
