export interface CapturedAudio {
  bytes: Uint8Array;
  mimeType: string;
  durationMs?: number;
  deviceKind: "smartphone" | "wearable" | "lapel" | "dedicated" | "unknown";
}

export interface AudioInput {
  readonly name: string;
  start(): Promise<void>;
  stop(): Promise<CapturedAudio>;
}
