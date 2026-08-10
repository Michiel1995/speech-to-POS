import { NextResponse } from "next/server";
import { z } from "zod";

import { DraftOrderSchema } from "@/src/domain/schemas";
import { apiError } from "@/src/http/api-error";
import { getPOSAdapter } from "@/src/pos/registry";

const SubmissionSchema = z.object({
  draft: DraftOrderSchema,
  idempotencyKey: z.string().min(8).max(128),
  sentBy: z.string().min(1).max(128),
});

export async function POST(request: Request) {
  try {
    const submission = SubmissionSchema.parse(await request.json());
    const adapter = getPOSAdapter();
    const draft = await adapter.createDraftOrder(submission);
    return NextResponse.json({ draft, adapter: adapter.name });
  } catch (error) {
    return apiError(error);
  }
}
