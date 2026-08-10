import { NextResponse } from "next/server";

import { getPOSAdapter } from "@/src/pos/registry";

export async function GET() {
  const adapter = getPOSAdapter();
  return NextResponse.json({
    ok: true,
    adapter: adapter.name,
    capabilities: adapter.capabilities,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
    retention: process.env.DEBUG_RETAIN_CONVERSATION === "true" ? "debug-opt-in" : "transient",
  });
}
