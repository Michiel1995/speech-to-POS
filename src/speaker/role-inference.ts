import type { ConversationTurn, SpeakerRole } from "@/src/domain/schemas";
import { normalizeSpoken } from "@/src/semantic-menu/matcher";

export interface DiarizedSegment {
  speaker: string;
  text: string;
  start?: number;
  end?: number;
}

const WAITER_MARKERS = [
  /\bdus\b/,
  /\bklopt dat\b/,
  /\bik zet\b/,
  /\bzal ik\b/,
  /\bgoed\?$/,
  /\bso that's\b/,
  /\bshall i\b/,
  /\bdonc\b/,
  /\bje vous mets\b/,
];

export function inferSpeakerRoles(segments: DiarizedSegment[]): ConversationTurn[] {
  const scores = new Map<string, number>();
  for (const segment of segments) {
    const normalized = normalizeSpoken(segment.text);
    const score = WAITER_MARKERS.reduce(
      (total, marker) => total + (marker.test(normalized) ? 1 : 0),
      0,
    );
    scores.set(segment.speaker, (scores.get(segment.speaker) ?? 0) + score);
  }

  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const waiterSpeaker = ranked[0]?.[1] > 0 ? ranked[0][0] : undefined;

  return segments.map((segment) => {
    const speaker: SpeakerRole = waiterSpeaker
      ? segment.speaker === waiterSpeaker
        ? "waiter"
        : "customer"
      : "unknown";
    return {
      speaker,
      providerSpeaker: segment.speaker,
      text: segment.text,
      startedAtMs: segment.start === undefined ? undefined : Math.round(segment.start * 1_000),
      endedAtMs: segment.end === undefined ? undefined : Math.round(segment.end * 1_000),
    };
  });
}
