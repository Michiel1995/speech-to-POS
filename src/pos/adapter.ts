import type { DraftOrder, Table, TenantMenu } from "@/src/domain/schemas";

export interface POSCapabilities {
  menuRead: boolean;
  tableRead: boolean;
  openOrderRead: boolean;
  draftOrderCreate: boolean;
  draftOrderUpdate: boolean;
}

export interface DraftSubmission {
  draft: DraftOrder;
  idempotencyKey: string;
  sentBy: string;
}

export interface POSAdapter {
  readonly name: string;
  readonly capabilities: POSCapabilities;
  getMenu(): Promise<TenantMenu>;
  getTables(): Promise<Table[]>;
  createDraftOrder(submission: DraftSubmission): Promise<DraftOrder>;
  getOrder(externalOrderId: string): Promise<unknown | null>;
}
