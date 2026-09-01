import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { DomainError } from "@/src/domain/errors";

function serverDiagnosticReference(): string {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 6).toUpperCase()
    ?? Math.random().toString(36).slice(2, 8).toUpperCase();
  return `SRV-${stamp}-${suffix}`;
}

export function apiError(error: unknown) {
  const diagnosticId = serverDiagnosticReference();
  if (error instanceof DomainError) {
    console.warn(`[${diagnosticId}] ${error.code} (${error.status})`);
    return NextResponse.json(
      { error: error.message, code: error.code, diagnosticId },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    console.warn(`[${diagnosticId}] INVALID_REQUEST (400)`);
    return NextResponse.json(
      { error: "Invalid request.", code: "INVALID_REQUEST", diagnosticId, details: error.issues },
      { status: 400 },
    );
  }
  // The reference is sufficient for correlation; never print arbitrary error
  // payloads because a provider error can contain transcript or order text.
  console.error(`[${diagnosticId}] INTERNAL_ERROR`);
  return NextResponse.json(
    { error: "Unexpected server error.", code: "INTERNAL_ERROR", diagnosticId },
    { status: 500 },
  );
}
