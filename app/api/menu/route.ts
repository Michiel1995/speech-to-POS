import { NextResponse } from "next/server";

import { apiError } from "@/src/http/api-error";
import { getPOSAdapter } from "@/src/pos/registry";

export async function GET() {
  try {
    const adapter = getPOSAdapter();
    const menu = await adapter.getMenu();
    return NextResponse.json({ menu, adapter: adapter.name, capabilities: adapter.capabilities });
  } catch (error) {
    return apiError(error);
  }
}
