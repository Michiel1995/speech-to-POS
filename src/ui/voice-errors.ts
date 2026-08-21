export type VoiceErrorCode =
  | "ABORTED"
  | "AUDIO_REQUIRED"
  | "INVALID_REQUEST"
  | "LOCAL_SPEECH_BUSY"
  | "LOCAL_SPEECH_NOT_CONFIGURED"
  | "MICROPHONE_DENIED"
  | "NETWORK_UNAVAILABLE"
  | "POS_UNAVAILABLE"
  | "STALE_OPERATION"
  | "TRANSCRIPTION_BUDGET_EXCEEDED"
  | "UNKNOWN";

export interface UserFacingVoiceError {
  code: VoiceErrorCode;
  title: string;
  message: string;
  retryable: boolean;
}

export class VoicePipelineError extends Error {
  readonly code?: string;
  readonly status?: number;
  readonly endpoint?: string;
  readonly serverReference?: string;

  constructor(input: { message?: string; code?: string; status?: number; endpoint?: string; serverReference?: string }) {
    super(input.message || "Voice pipeline request failed.");
    this.name = "VoicePipelineError";
    this.code = input.code;
    this.status = input.status;
    this.endpoint = input.endpoint;
    this.serverReference = input.serverReference;
  }
}

export function voicePipelineErrorDetails(error: unknown): {
  message?: string;
  code?: string;
  status?: number;
  endpoint?: string;
  serverReference?: string;
} {
  if (error instanceof VoicePipelineError) {
    return { message: error.message, code: error.code, status: error.status, endpoint: error.endpoint, serverReference: error.serverReference };
  }
  return { message: error instanceof Error ? error.message : undefined };
}

const ERROR_MESSAGES: Partial<Record<string, UserFacingVoiceError>> = {
  TRANSCRIPTION_BUDGET_EXCEEDED: {
    code: "TRANSCRIPTION_BUDGET_EXCEEDED",
    title: "Opname niet volledig herkend",
    message: "Deze opname kon niet volledig worden uitgeschreven. De bestaande bestelling bleef bewaard. Probeer de uitspraak nogmaals, iets dichter bij de microfoon.",
    retryable: true,
  },
  LOCAL_SPEECH_BUSY: {
    code: "LOCAL_SPEECH_BUSY",
    title: "Spraakmodule is nog bezig",
    message: "De vorige opname wordt lokaal afgerond. Wacht enkele seconden en probeer opnieuw.",
    retryable: true,
  },
  AUDIO_REQUIRED: {
    code: "AUDIO_REQUIRED",
    title: "Geen bruikbare opname",
    message: "Er werd geen bruikbare microfoonopname ontvangen. Spreek iets dichter bij de microfoon en probeer opnieuw.",
    retryable: true,
  },
  MICROPHONE_DENIED: {
    code: "MICROPHONE_DENIED",
    title: "Microfoontoegang nodig",
    message: "Sta microfoontoegang toe voor Service Ears en probeer daarna opnieuw.",
    retryable: true,
  },
  LOCAL_WHISPER_CLI_MISSING: {
    code: "LOCAL_SPEECH_NOT_CONFIGURED",
    title: "Lokale spraakmodule ontbreekt",
    message: "Installeer de nieuwste Service Ears-versie opnieuw; het bestaande concept blijft bewaard.",
    retryable: false,
  },
  LOCAL_WHISPER_MODEL_MISSING: {
    code: "LOCAL_SPEECH_NOT_CONFIGURED",
    title: "Lokaal taalmodel ontbreekt",
    message: "Installeer de nieuwste Service Ears-versie opnieuw; het bestaande concept blijft bewaard.",
    retryable: false,
  },
  LOCAL_WHISPER_RUNTIME_UNAVAILABLE: {
    code: "LOCAL_SPEECH_NOT_CONFIGURED",
    title: "Lokale spraakmodule herstelt",
    message: "De lokale spraakruntime wordt opnieuw opgebouwd. De opname en het bestaande concept bleven bewaard; probeer meteen opnieuw.",
    retryable: true,
  },
  STALE_MENU: {
    code: "INVALID_REQUEST",
    title: "Menukaart is vernieuwd",
    message: "De menukaart veranderde tijdens deze verwerking. Vernieuw de app en probeer de uitspraak opnieuw.",
    retryable: true,
  },
  UNSUPPORTED_POS_CAPABILITY: {
    code: "POS_UNAVAILABLE",
    title: "POS-overdracht niet beschikbaar",
    message: "Deze POS-koppeling kan nog geen veilig concept ontvangen. De bestelling blijft lokaal bewaard.",
    retryable: false,
  },
};

export function userFacingVoiceError(input: {
  code?: string;
  status?: number;
  message?: string;
  fallback?: string;
}): UserFacingVoiceError {
  const known = input.code ? ERROR_MESSAGES[input.code] : undefined;
  if (known) return known;
  if (input.status === 429) return ERROR_MESSAGES.LOCAL_SPEECH_BUSY!;
  if (input.status && input.status >= 500) {
    return {
      code: "NETWORK_UNAVAILABLE",
      title: "Lokale dienst reageert niet",
      message: "De opname en het bestaande concept blijven bewaard. Probeer opnieuw zodra de lokale dienst gereed is.",
      retryable: true,
    };
  }
  const raw = input.message?.trim();
  const isRawNetworkError = !raw || /failed to fetch|networkerror|load failed|unexpected server error/i.test(raw);
  return {
    code: isRawNetworkError ? "NETWORK_UNAVAILABLE" : "UNKNOWN",
    title: "Review niet bijgewerkt",
    message: isRawNetworkError
      ? "De lokale dienst was tijdelijk niet bereikbaar. Het bestaande bestelconcept is niet gewijzigd; probeer opnieuw."
      : raw ?? input.fallback ?? "De verwerking kon niet veilig worden afgerond. Het bestaande concept bleef ongewijzigd.",
    retryable: true,
  };
}
