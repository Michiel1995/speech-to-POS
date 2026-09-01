import { NextResponse } from "next/server";

import { apiError } from "@/src/http/api-error";
import { selectLocalWhisperEntryModel } from "@/src/speech/local-model-manager";
import { localWhisperServerReadiness, warmLocalWhisperServer } from "@/src/speech/local-whisper-server";

export const runtime = "nodejs";

export async function POST() {
  try {
    const { entry } = selectLocalWhisperEntryModel();
    if (!entry) {
      return NextResponse.json({ warmed: false, reason: "no-local-model" });
    }
    const warmed = await warmLocalWhisperServer(entry);
    return NextResponse.json({
      warmed,
      readiness: localWhisperServerReadiness(),
      model: { id: entry.id, label: entry.label, tier: entry.tier },
    });
  } catch (error) {
    return apiError(error);
  }
}
