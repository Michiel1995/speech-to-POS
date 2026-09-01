import { NextResponse } from "next/server";

import { getPOSAdapter } from "@/src/pos/registry";
import { localSpeechRuntimeStatus } from "@/src/speech/local-model-manager";
import { culinaryKnowledgeStats } from "@/src/knowledge/culinary-knowledge";

export async function GET() {
  const adapter = getPOSAdapter();
  const localSpeech = localSpeechRuntimeStatus();
  return NextResponse.json({
    ok: true,
    adapter: adapter.name,
    capabilities: adapter.capabilities,
    offlineSpeechConfigured: localSpeech.configured,
    offlineVadConfigured: Boolean(process.env.LOCAL_WHISPER_VAD_MODEL),
    localSpeech,
    culinaryKnowledge: culinaryKnowledgeStats,
    retention: process.env.DEBUG_RETAIN_CONVERSATION === "true" ? "debug-opt-in" : "transient",
  });
}
