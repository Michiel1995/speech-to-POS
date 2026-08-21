import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  discoverLocalWhisperModels,
  localSpeechRuntimeStatus,
  recordLocalWhisperPerformance,
  resetLocalModelMeasurementsForTests,
  selectLocalWhisperEntryModel,
  selectLocalWhisperModel,
  withLocalSpeechCapacity,
} from "@/src/speech/local-model-manager";

describe("adaptive local Whisper model selection", () => {
  let directory: string;

  beforeEach(async () => {
    resetLocalModelMeasurementsForTests();
    directory = await mkdtemp(path.join(os.tmpdir(), "service-ears-models-"));
    await writeFile(path.join(directory, "ggml-small-q5_1.bin"), Buffer.alloc(128));
    await writeFile(path.join(directory, "ggml-large-v3-turbo-q5_0.bin"), Buffer.alloc(256));
  });

  afterEach(async () => {
    await rm(directory, { recursive: true, force: true });
  });

  it("discovers interchangeable models without baking one into the app", () => {
    const models = discoverLocalWhisperModels({ modelDirectories: [directory] });
    expect(models.map((model) => model.tier)).toEqual(["large-turbo", "small"]);
  });

  it("selects Large Turbo on a capable 16 GB laptop but limits CPU threads", () => {
    const selected = selectLocalWhisperModel({
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 16 * 1024,
      freeMemoryMb: 8 * 1024,
      logicalProcessors: 14,
      maxThreads: 6,
      policy: "adaptive",
    });
    expect(selected).toMatchObject({ tier: "large-turbo", threadCount: 6, policy: "adaptive" });
  });

  it("starts adaptive recognition on Small while retaining Large Turbo as the rescue model", () => {
    const plan = selectLocalWhisperEntryModel({
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 16 * 1024,
      freeMemoryMb: 8 * 1024,
      logicalProcessors: 14,
      maxThreads: 6,
      policy: "adaptive",
    });
    expect(plan.entry?.tier).toBe("small");
    expect(plan.strongest?.tier).toBe("large-turbo");
  });

  it("keeps fixed installations on their configured model", () => {
    const plan = selectLocalWhisperEntryModel({
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 16 * 1024,
      freeMemoryMb: 8 * 1024,
      logicalProcessors: 14,
      policy: "fixed",
    });
    expect(plan.entry?.tier).toBe("small");
    expect(plan.strongest?.id).toBe(plan.entry?.id);
  });

  it("keeps a weak 8 GB device on the Small reserve model", () => {
    const selected = selectLocalWhisperModel({
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 8 * 1024,
      freeMemoryMb: 4 * 1024,
      logicalProcessors: 6,
      maxThreads: 6,
      policy: "adaptive",
    });
    expect(selected?.tier).toBe("small");
    expect(selected?.threadCount).toBe(2);
  });

  it("refuses to load a model that does not fit safely in memory", async () => {
    await rm(path.join(directory, "ggml-small-q5_1.bin"));
    const selected = selectLocalWhisperModel({
      fixedModelPath: path.join(directory, "ggml-large-v3-turbo-q5_0.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 4 * 1024,
      freeMemoryMb: 900,
      logicalProcessors: 4,
      policy: "adaptive",
    });
    expect(selected).toBeUndefined();
  });

  it("automatically demotes a repeatedly slow strong model", () => {
    const options = {
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 16 * 1024,
      freeMemoryMb: 8 * 1024,
      logicalProcessors: 14,
      maxThreads: 6,
      targetLatencyMs: 10_000,
      policy: "adaptive" as const,
      now: Date.now(),
    };
    const strong = selectLocalWhisperModel(options)!;
    recordLocalWhisperPerformance(strong, 18_000, 5, true);
    recordLocalWhisperPerformance(strong, 18_000, 5, true);
    expect(selectLocalWhisperModel({ ...options, now: Date.now() + 1 })?.tier).toBe("small");
    expect(localSpeechRuntimeStatus({ ...options, now: Date.now() + 1 }).installedModels[0]).toMatchObject({ eligible: false });
  });

  it("does not disable a healthy model merely because one request budget expired", () => {
    const options = {
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 16 * 1024,
      freeMemoryMb: 8 * 1024,
      logicalProcessors: 14,
      policy: "adaptive" as const,
      now: Date.now(),
    };
    const selected = selectLocalWhisperModel(options)!;
    recordLocalWhisperPerformance(selected, 4_200, 12, "timeout");
    expect(selectLocalWhisperModel({ ...options, now: Date.now() + 1 })?.id).toBe(selected.id);
  });

  it("recovers from a single runtime failure without hiding the model", () => {
    const options = {
      fixedModelPath: path.join(directory, "ggml-small-q5_1.bin"),
      modelDirectories: [directory],
      totalMemoryMb: 16 * 1024,
      freeMemoryMb: 8 * 1024,
      logicalProcessors: 14,
      policy: "adaptive" as const,
      now: Date.now(),
    };
    const selected = selectLocalWhisperModel(options)!;
    recordLocalWhisperPerformance(selected, 500, 2, "runtime-error");
    expect(selectLocalWhisperModel({ ...options, now: Date.now() + 1 })?.id).toBe(selected.id);
  });

  it("bounds a queued request instead of waiting behind stale heavy work", async () => {
    let releaseFirst!: () => void;
    const first = withLocalSpeechCapacity(() => new Promise<string>((resolve) => { releaseFirst = () => resolve("first"); }));
    await expect(withLocalSpeechCapacity(async () => "late", { maxWaitMs: 5 })).rejects.toMatchObject({
      code: "LOCAL_SPEECH_BUSY",
    });
    releaseFirst();
    await expect(first).resolves.toBe("first");
  });

  it("queues local work and rejects excess load instead of starting parallel heavy jobs", async () => {
    let releaseFirst!: () => void;
    const first = withLocalSpeechCapacity(() => new Promise<string>((resolve) => { releaseFirst = () => resolve("first"); }));
    const second = withLocalSpeechCapacity(async () => "second");
    const third = withLocalSpeechCapacity(async () => "third");
    await expect(withLocalSpeechCapacity(async () => "fourth")).rejects.toMatchObject({ code: "LOCAL_SPEECH_BUSY" });
    releaseFirst();
    await expect(Promise.all([first, second, third])).resolves.toEqual(["first", "second", "third"]);
  });
});
