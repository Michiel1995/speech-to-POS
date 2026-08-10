import { NextResponse } from "next/server";
import { ZodError } from "zod";

import { DomainError } from "@/src/domain/errors";

export function apiError(error: unknown) {
  if (error instanceof DomainError) {
    return NextResponse.json(
      { error: error.message, code: error.code },
      { status: error.status },
    );
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Invalid request.", code: "INVALID_REQUEST", details: error.issues },
      { status: 400 },
    );
  }
  console.error(error);
  return NextResponse.json(
    { error: "Unexpected server error.", code: "INTERNAL_ERROR" },
    { status: 500 },
  );
}
