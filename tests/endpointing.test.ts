import { describe, expect, it } from "vitest";

import {
  automaticSilenceDelaySeconds,
  MAX_AUTOMATIC_RECORDING_SECONDS,
} from "../src/audio/endpointing";

describe("automatic recording endpointing", () => {
  it("allows a natural pause after a longer utterance", () => {
    expect(
      automaticSilenceDelaySeconds({
        noiseFloorRms: 0.008,
        spokenDurationSeconds: 8,
        previewText: "Voor mij een steak saignant",
      }),
    ).toBe(3);
  });

  it("gives speakers more time in noisy rooms instead of cutting them off sooner", () => {
    expect(
      automaticSilenceDelaySeconds({
        noiseFloorRms: 0.024,
        spokenDurationSeconds: 8,
        previewText: "Voor mij een steak saignant",
      }),
    ).toBe(3.8);
  });

  it("waits longer after a very short phrase", () => {
    expect(
      automaticSilenceDelaySeconds({
        noiseFloorRms: 0.008,
        spokenDurationSeconds: 1.4,
        previewText: "Twee Duvel",
      }),
    ).toBe(3.7);
  });

  it.each(["ik wil een Duvel en", "I would like a beer and", "je voudrais une bière et"])(
    "uses the maximum pause after an incomplete phrase: %s",
    (previewText) => {
      expect(
        automaticSilenceDelaySeconds({
          noiseFloorRms: 0.025,
          spokenDurationSeconds: 1.5,
          previewText,
        }),
      ).toBe(5);
    },
  );

  it("keeps a generous safety limit for long conversations", () => {
    expect(MAX_AUTOMATIC_RECORDING_SECONDS).toBe(180);
  });
});
