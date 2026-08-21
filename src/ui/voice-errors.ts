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
