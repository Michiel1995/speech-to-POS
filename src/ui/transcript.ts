import type { ConversationTurn, SpeakerRole } from "@/src/domain/schemas";

const LABELS: Record<string, SpeakerRole> = {
  customer: "customer",
  klant: "customer",
  client: "customer",
  guest: "customer",
  waiter: "waiter",
  ober: "waiter",
  serveerster: "waiter",
  serveur: "waiter",
  serveuse: "waiter",
  unknown: "unknown",
  onbekend: "unknown",
};

export function parseTranscript(value: string): ConversationTurn[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^([^:]{1,20}):\s*(.+)$/);
      if (!match) return { speaker: "unknown" as const, text: line };
      const speaker = LABELS[match[1].trim().toLowerCase()] ?? "unknown";
      return { speaker, text: match[2].trim() };
    });
}

export function formatTurns(turns: ConversationTurn[]): string {
  return turns.map((turn) => `${turn.speaker === "waiter" ? "Waiter" : turn.speaker === "customer" ? "Customer" : "Unknown"}: ${turn.text}`).join("\n");
}
