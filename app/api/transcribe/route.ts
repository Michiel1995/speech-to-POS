import { NextResponse } from "next/server";

import { DomainError } from "@/src/domain/errors";
import { apiError } from "@/src/http/api-error";
import { transcribeHospitalityAudio } from "@/src/speech/openai-transcriber";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const data = await request.formData();
    const audio = data.get("audio");
    if (!(audio instanceof File)) {
      throw new DomainError("A microphone recording is required.", "AUDIO_REQUIRED");
    }
    const result = await transcribeHospitalityAudio(audio);
    return NextResponse.json(result);
  } catch (error) {
    return apiError(error);
  }
}
