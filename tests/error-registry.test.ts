import { describe, expect, it, vi } from "vitest";

import { DomainError } from "@/src/domain/errors";
import { apiError } from "@/src/http/api-error";
import {
  MAX_ERROR_INCIDENTS,
  appendErrorIncident,
  createErrorIncident,
  formatErrorIncident,
  parseErrorIncidents,
} from "@/src/ui/error-registry";
import { userFacingVoiceError } from "@/src/ui/voice-errors";

function timeoutIncident(index = 1) {
  return createErrorIncident({
    friendly: userFacingVoiceError({ code: "TRANSCRIPTION_BUDGET_EXCEEDED", status: 504 }),
    code: "TRANSCRIPTION_BUDGET_EXCEEDED",
    status: 504,
    endpoint: "/api/transcribe?private=ignored",
    phase: "transcription",
    elapsedMs: 8_120,
    runtime: "desktop",
    online: true,
    speechMode: "offline",
    voicePhase: "LOCAL_TRANSCRIBING",
    now: new Date(`2026-08-21T10:00:${String(index).padStart(2, "0")}.000Z`),
    referenceSuffix: String(index).padStart(6, "0"),
  });
}

describe("privacy-safe technical error registry", () => {
  it("creates a stable, actionable timeout explanation without conversation data", () => {
    const incident = timeoutIncident();
    expect(incident).toMatchObject({
      reference: "SE-20260821-000001",
      code: "TRANSCRIPTION_BUDGET_EXCEEDED",
      phase: "transcription",
      component: "Lokale transcriptie",
      status: 504,
      endpoint: "/api/transcribe",
      elapsedMs: 8_120,
    });
    expect(incident.suggestedChecks.length).toBeGreaterThanOrEqual(2);
    const report = formatErrorIncident(incident);
    expect(report).toContain("Technische uitleg:");
    expect(report).toContain("Privacy: bevat geen audio");
    expect(report).not.toContain("private=ignored");
  });

  it("bounds the local register and rejects malformed persisted values", () => {
    let incidents = [] as ReturnType<typeof parseErrorIncidents>;
    for (let index = 1; index <= MAX_ERROR_INCIDENTS + 8; index += 1) {
      incidents = appendErrorIncident(incidents, timeoutIncident(index));
    }
    expect(incidents).toHaveLength(MAX_ERROR_INCIDENTS);
    expect(parseErrorIncidents(JSON.stringify(incidents))).toHaveLength(MAX_ERROR_INCIDENTS);
    expect(parseErrorIncidents("not-json")).toEqual([]);
    expect(parseErrorIncidents(JSON.stringify([{ transcript: "twee Duvel" }]))).toEqual([]);
  });

  it("uses code, phase and endpoint—not raw messages—for the fingerprint", () => {
    const first = timeoutIncident(1);
    const second = createErrorIncident({
      friendly: userFacingVoiceError({ code: "TRANSCRIPTION_BUDGET_EXCEEDED" }),
      code: "TRANSCRIPTION_BUDGET_EXCEEDED",
      status: 504,
      endpoint: "/api/transcribe",
      phase: "transcription",
      runtime: "desktop",
      online: false,
      referenceSuffix: "ABC123",
    });
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it("rehydrates technical copy from the allowlisted registry instead of trusting storage text", () => {
    const unsafe = {
      ...timeoutIncident(),
      component: "Table 12",
      explanation: "twee Duvel en een steak",
      suggestedChecks: ["customer transcript"],
      speechMode: "private customer speech",
    };
    const parsed = parseErrorIncidents(JSON.stringify([unsafe]));
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("Table 12");
    expect(serialized).not.toContain("twee Duvel");
    expect(serialized).not.toContain("customer transcript");
    expect(serialized).not.toContain("private customer speech");
    expect(parsed[0].component).toBe("Lokale transcriptie");
  });

  it("links API errors to a safe server-log reference", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = apiError(new DomainError("budget", "TRANSCRIPTION_BUDGET_EXCEEDED", 504));
    const body = await response.json() as { code: string; diagnosticId: string };
    expect(response.status).toBe(504);
    expect(body.code).toBe("TRANSCRIPTION_BUDGET_EXCEEDED");
    expect(body.diagnosticId).toMatch(/^SRV-\d{14}-[A-Z0-9]{6}$/);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining(body.diagnosticId));
    warning.mockRestore();
  });
});
