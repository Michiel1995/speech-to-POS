import { NextResponse } from "next/server";
import { z } from "zod";

import { DraftOrderSchema } from "@/src/domain/schemas";
import { apiError } from "@/src/http/api-error";
import { getPOSAdapter } from "@/src/pos/registry";

const SubmissionSchema = z.object({
  draft: DraftOrderSchema,
  idempotencyKey: z.string().min(8).max(128),
  sentBy: z.string().min(1).max(128),
  operationId: z.string().min(1).max(100).optional(),
  baseDraftRevision: z.string().min(1).max(2_000).optional(),
});

export async function POST(request: Request) {
  try {
    const submission = SubmissionSchema.parse(await request.json());
    const adapter = getPOSAdapter();
    const draft = await adapter.createDraftOrder(submission);
    return NextResponse.json({
      draft,
      adapter: adapter.name,
      operationId: submission.operationId,
      tableId: submission.draft.tableId,
      baseDraftRevision: submission.baseDraftRevision,
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function GET(request: Request) {
  try {
    const externalOrderId = new URL(request.url).searchParams.get("externalOrderId")?.trim();
    if (!externalOrderId) {
      return NextResponse.json({ error: "externalOrderId is required.", code: "INVALID_REQUEST" }, { status: 400 });
    }
    const adapter = getPOSAdapter();
    if (!adapter.capabilities.openOrderRead) {
      return NextResponse.json({ error: "POS read-back is not supported.", code: "UNSUPPORTED_POS_CAPABILITY" }, { status: 422 });
    }
    const order = await adapter.getOrder(externalOrderId);
    if (!order) {
      return NextResponse.json({ error: "The POS did not return this order.", code: "POS_ORDER_NOT_FOUND" }, { status: 404 });
    }
    return NextResponse.json({ order, adapter: adapter.name, confirmed: true });
  } catch (error) {
    return apiError(error);
  }
}
