import type { DraftOrder } from "@/src/domain/schemas";

export type VoiceOperationKind = "conversation" | "correction" | "text" | "send";

export type VoicePhase =
  | "IDLE"
  | "CALIBRATING"
  | "LISTENING"
  | "FINALIZING_AUDIO"
  | "PROVISIONAL_REVIEW"
  | "LOCAL_TRANSCRIBING"
  | "INTERPRETING"
  | "READY_FOR_REVIEW"
  | "SENDING"
  | "SENT"
  | "ERROR"
  | "CANCELLED";

export interface VoiceOperationToken {
  id: string;
  sequence: number;
  kind: VoiceOperationKind;
  tableId: string;
  baseDraftRevision: string;
  startedAtMs: number;
  signal: AbortSignal;
}

export interface VoiceOperationSnapshot {
  tableId: string;
  draftRevision: string;
}

export function draftRevision(draft?: DraftOrder): string {
  if (!draft) return "empty";
  const value = [
    draft.id,
    draft.updatedAt,
    draft.status,
    draft.lines.map((line) => `${line.lineId}:${line.quantity}`).join(","),
    draft.issues.map((issue) => issue.id).join(","),
  ].join("|");
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return `draft-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

/**
 * Owns at most one user-visible async operation. Beginning a newer operation
 * aborts the previous network work and makes every older token ineligible to
 * update Review, even when an upstream service ignores cancellation.
 */
export class VoiceOperationCoordinator {
  private sequence = 0;
  private active?: { token: VoiceOperationToken; controller: AbortController };

  begin(input: {
    kind: VoiceOperationKind;
    tableId: string;
    draftRevision: string;
    nowMs?: number;
  }): VoiceOperationToken {
    this.cancel();
    const controller = new AbortController();
    const sequence = ++this.sequence;
    const token: VoiceOperationToken = {
      id: `voice-${sequence}`,
      sequence,
      kind: input.kind,
      tableId: input.tableId,
      baseDraftRevision: input.draftRevision,
      startedAtMs: input.nowMs ?? performance.now(),
      signal: controller.signal,
    };
    this.active = { token, controller };
    return token;
  }

  isActive(token: VoiceOperationToken): boolean {
    return this.active?.token.id === token.id && !token.signal.aborted;
  }

  mayCommit(token: VoiceOperationToken, snapshot: VoiceOperationSnapshot): boolean {
    return this.isActive(token) &&
      token.tableId === snapshot.tableId &&
      token.baseDraftRevision === snapshot.draftRevision;
  }

  complete(token: VoiceOperationToken): boolean {
    if (!this.isActive(token)) return false;
    this.active = undefined;
    return true;
  }

  cancel(): VoiceOperationToken | undefined {
    const token = this.active?.token;
    this.active?.controller.abort();
    this.active = undefined;
    return token;
  }
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError"
    : error instanceof Error && error.name === "AbortError";
}
