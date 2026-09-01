import { randomUUID } from "node:crypto";

import { demoMenu } from "@/src/data/demo-menu";
import { DomainError } from "@/src/domain/errors";
import { DraftOrderSchema, type DraftOrder } from "@/src/domain/schemas";
import type { DraftSubmission, POSAdapter } from "@/src/pos/adapter";
import { validateDraft } from "@/src/validation/order-validator";

const submittedByKey = new Map<string, DraftOrder>();

export class MockPOSAdapter implements POSAdapter {
  readonly name = "mock-pos";
  readonly capabilities = {
    menuRead: true,
    tableRead: true,
    openOrderRead: true,
    draftOrderCreate: true,
    draftOrderUpdate: true,
  } as const;

  async getMenu() {
    return demoMenu;
  }

  async getTables() {
    return demoMenu.tables;
  }

  async createDraftOrder({ draft, idempotencyKey, sentBy }: DraftSubmission): Promise<DraftOrder> {
    const existing = submittedByKey.get(idempotencyKey);
    if (existing) return existing;

    const validation = validateDraft(draft, demoMenu);
    if (!validation.valid) {
      throw new DomainError(validation.errors.join(" "), "INVALID_DRAFT", 422);
    }
    if (draft.status !== "NOT_SENT") {
      throw new DomainError("Only NOT_SENT drafts can be transmitted.", "DRAFT_ALREADY_SENT", 409);
    }

    const sentAt = new Date().toISOString();
    const sent = DraftOrderSchema.parse({
      ...draft,
      status: "SENT",
      sentBy,
      updatedAt: sentAt,
      posSubmission: {
        adapter: this.name,
        externalOrderId: `MOCK-${randomUUID()}`,
        idempotencyKey,
        confirmedByWaiter: false,
        sentAt,
      },
    });
    submittedByKey.set(idempotencyKey, sent);
    return sent;
  }

  async getOrder(externalOrderId: string) {
    return [...submittedByKey.values()].find(
      (draft) => draft.posSubmission?.externalOrderId === externalOrderId,
    ) ?? null;
  }
}
