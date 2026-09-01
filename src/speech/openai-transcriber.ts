import OpenAI, { toFile } from "openai";

import { DomainError } from "@/src/domain/errors";
import type { ConversationTurn } from "@/src/domain/schemas";
import { inferSpeakerRoles, type DiarizedSegment } from "@/src/speaker/role-inference";

interface DiarizedResponse {
  text: string;
  segments: Array<{
    speaker: string;
    text: string;
    start?: number;
    end?: number;
  }>;
}

export async function transcribeHospitalityAudio(file: File): Promise<{
  text: string;
  turns: ConversationTurn[];
  retained: false;
}> {
  if (!process.env.OPENAI_API_KEY) {
    throw new DomainError(
      "OPENAI_API_KEY is not configured. Text demo mode remains available.",
      "OPENAI_NOT_CONFIGURED",
      503,
    );
  }
  if (!file.size) throw new DomainError("The audio recording is empty.", "EMPTY_AUDIO");
  if (file.size > 24 * 1024 * 1024) {
    throw new DomainError("Audio exceeds the 24 MB MVP upload limit.", "AUDIO_TOO_LARGE", 413);
  }

  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const bytes = Buffer.from(await file.arrayBuffer());
  const uploadedFile = await toFile(bytes, file.name || "conversation.webm", {
    type: file.type || "audio/webm",
  });

  const result = (await client.audio.transcriptions.create({
    file: uploadedFile,
    model: process.env.OPENAI_TRANSCRIPTION_MODEL ?? "gpt-4o-transcribe-diarize",
    response_format: "diarized_json",
  })) as unknown as DiarizedResponse;

  const segments: DiarizedSegment[] = Array.isArray(result.segments)
    ? result.segments.map((segment) => ({
        speaker: String(segment.speaker),
        text: String(segment.text),
        start: segment.start,
        end: segment.end,
      }))
    : [{ speaker: "A", text: result.text }];

  return { text: result.text, turns: inferSpeakerRoles(segments), retained: false };
}
