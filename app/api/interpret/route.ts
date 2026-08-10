import { NextResponse } from "next/server";

import { DomainError } from "@/src/domain/errors";
import { InterpretRequestSchema } from "@/src/domain/schemas";
import { apiError } from "@/src/http/api-error";
import { interpretDeterministically } from "@/src/order-understanding/deterministic-engine";
import { interpretWithOpenAI } from "@/src/order-understanding/openai-interpreter";
import { getPOSAdapter } from "@/src/pos/registry";

export async function POST(request: Request) {
  try {
    const input = InterpretRequestSchema.parse(await request.json());
    const menu = await getPOSAdapter().getMenu();
    if (input.tenantId !== menu.tenantId) {
      throw new DomainError("The selected menu tenant is stale. Refresh the menu.", "STALE_MENU", 409);
    }
    const draft =
      input.engine === "openai"
        ? await interpretWithOpenAI(input, menu)
        : interpretDeterministically(input, menu);
    return NextResponse.json({ draft, rawConversationRetained: false });
  } catch (error) {
    return apiError(error);
  }
}
