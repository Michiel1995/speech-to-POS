export type VoiceErrorCode =
  | "ABORTED"
  | "AUDIO_CHUNKS_EMPTY"
  | "AUDIO_ONLY_NOISE"
  | "AUDIO_REQUIRED"
  | "AUDIO_SAMPLE_RATE_INVALID"
  | "AUDIO_TRIMMED_EMPTY"
  | "AUDIO_WAV_DATA_INVALID"
  | "AUDIO_WAV_HEADER_INVALID"
  | "BROWSER_SPEECH_FAILED"
  | "BROWSER_SPEECH_NO_RESULT"
  | "BROWSER_SPEECH_UNAVAILABLE"
  | "INVALID_REQUEST"
  | "LOCAL_SPEECH_BUSY"
  | "LOCAL_SPEECH_NOT_CONFIGURED"
  | "LOCAL_TRANSCRIBE_API_FAILED"
  | "LOCAL_TRANSCRIBE_TIMEOUT"
  | "LOCAL_WHISPER_CLI_MISSING"
  | "LOCAL_WHISPER_MODEL_MISSING"
  | "LOCAL_WHISPER_RUNTIME_UNAVAILABLE"
  | "MICROPHONE_DENIED"
  | "MICROPHONE_STREAM_FAILED"
  | "NETWORK_UNAVAILABLE"
  | "NO_SPEECH_DETECTED"
  | "POS_UNAVAILABLE"
  | "STALE_OPERATION"
  | "TRANSCRIPTION_BUDGET_EXCEEDED"
  | "WAV_CREATION_FAILED"
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

export function classifyVoicePipelineError(input: {
  code?: string;
  status?: number;
  message?: string;
  endpoint?: string;
}): string {
  const raw = [input.code ?? "", input.status?.toString() ?? "", input.message ?? "", input.endpoint ?? ""]
    .join(" ")
    .toLowerCase();

  if (!raw) return "UNKNOWN";
  if (/local_whisper_cli_missing|cli.*missing|whisper.*not.*installed|model.*missing/.test(raw)) return "LOCAL_WHISPER_CLI_MISSING";
  if (/samplefrequentie|ongeldige sample|sample.*rate|too low.*sample|microfoonkwaliteit/.test(raw)) return "AUDIO_SAMPLE_RATE_INVALID";
  if (/wav-header|wav.*onvolledig|wav.*beschadigd|geldige wav|audio.*onvolledig/.test(raw)) return "AUDIO_WAV_HEADER_INVALID";
  if (/geen microfoongeluid|lege opname|no speech detected|geen duidelijke spraak/.test(raw)) return "NO_SPEECH_DETECTED";
  if (/omgevingsgeluid|audio only noise|alleen omgevingsgeluid/.test(raw)) return "AUDIO_ONLY_NOISE";
  if (/microfoon.*denied|not-allowed|permission.*denied|microfoontoegang/.test(raw)) return "MICROPHONE_DENIED";
  if (/browser.*speech.*unavailable|speechrecognition.*not.*available|webkit.*not.*available/.test(raw)) return "BROWSER_SPEECH_UNAVAILABLE";
  if (/browser.*speech.*failed|speech.*failed|no.*result|geen.*bruikbare.*tekst/.test(raw)) return "BROWSER_SPEECH_FAILED";
  if (/503|service unavailable|transcribe.*failed|fetch.*failed|failed to fetch|network.*error/.test(raw)) return "LOCAL_TRANSCRIBE_API_FAILED";
  if (/timeout|timed out|abort/.test(raw)) return "LOCAL_TRANSCRIBE_TIMEOUT";
  if (/wav.*creation|encode.*wav|invalid.*wav|audio.*processing/.test(raw)) return "WAV_CREATION_FAILED";
  if (/audio.*chunks|no.*audio|zero.*length|contains.*no.*audio/.test(raw)) return "AUDIO_CHUNKS_EMPTY";
  return input.code ?? "UNKNOWN";
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
    code: "LOCAL_WHISPER_CLI_MISSING",
    title: "Lokale spraakmodule ontbreekt",
    message: "De lokale speech-runtime is niet geïnstalleerd of niet beschikbaar. Het bestaande concept blijft bewaard; gebruik voor nu de browserflow of installeer de lokale runtime opnieuw.",
    retryable: false,
  },
  LOCAL_WHISPER_MODEL_MISSING: {
    code: "LOCAL_WHISPER_MODEL_MISSING",
    title: "Lokaal taalmodel ontbreekt",
    message: "Het lokale taalmodel ontbreekt in deze installatie. Het bestaande concept blijft bewaard; gebruik voor nu de browserflow of herstel de modelbestanden.",
    retryable: false,
  },
  LOCAL_WHISPER_RUNTIME_UNAVAILABLE: {
    code: "LOCAL_WHISPER_RUNTIME_UNAVAILABLE",
    title: "Lokale spraakmodule herstelt",
    message: "De lokale spraakruntime wordt opnieuw opgebouwd. De opname en het bestaande concept bleven bewaard; probeer meteen opnieuw.",
    retryable: true,
  },
  LOCAL_TRANSCRIBE_API_FAILED: {
    code: "LOCAL_TRANSCRIBE_API_FAILED",
    title: "Lokale transcriptie mislukt",
    message: "De lokale transcriptie-endpoint gaf een fout terug. Het bestaande concept blijft bewaard; probeer opnieuw of gebruik de browserherkenning.",
    retryable: true,
  },
  LOCAL_TRANSCRIBE_TIMEOUT: {
    code: "LOCAL_TRANSCRIBE_TIMEOUT",
    title: "Lokale transcriptie timed out",
    message: "De lokale transcriptie nam te lang. Het bestaande concept is niet gewijzigd; probeer opnieuw met een kortere opname.",
    retryable: true,
  },
  WAV_CREATION_FAILED: {
    code: "WAV_CREATION_FAILED",
    title: "Audio kon niet worden omgezet",
    message: "De opname kon niet veilig naar WAV worden voorbereid. Probeer opnieuw en zorg dat je duidelijker spreekt.",
    retryable: true,
  },
  AUDIO_WAV_HEADER_INVALID: {
    code: "AUDIO_WAV_HEADER_INVALID",
    title: "Ongeldige WAV-header",
    message: "De audio is beschadigd of ongebruikelijk geformateerd. De opname werd niet verwerkt.",
    retryable: true,
  },
  AUDIO_SAMPLE_RATE_INVALID: {
    code: "AUDIO_SAMPLE_RATE_INVALID",
    title: "Audiokwaliteit onvoldoende",
    message: "De microfoon gaf een ongeldige of te lage samplefrequentie terug. Probeer opnieuw met de standaard microfoon.",
    retryable: true,
  },
  MICROPHONE_STREAM_FAILED: {
    code: "MICROPHONE_STREAM_FAILED",
    title: "Microfoonstream faalde",
    message: "De microfoonstroom kon niet veilig worden opgebouwd. Controleer de microfoon en probeer opnieuw.",
    retryable: true,
  },
  BROWSER_SPEECH_UNAVAILABLE: {
    code: "BROWSER_SPEECH_UNAVAILABLE",
    title: "Browser-spraak niet beschikbaar",
    message: "De browser ondersteunt geen live spraakherkenning in deze situatie. De lokale route blijft beschikbaar.",
    retryable: false,
  },
  BROWSER_SPEECH_FAILED: {
    code: "BROWSER_SPEECH_FAILED",
    title: "Browser-spraak mislukte",
    message: "De browser kon geen veilige uitspraak opleveren. De lokale opname wordt als back-up gebruikt waar mogelijk.",
    retryable: true,
  },
  BROWSER_SPEECH_NO_RESULT: {
    code: "BROWSER_SPEECH_NO_RESULT",
    title: "Geen browsertekst gevonden",
    message: "De browser herkende geen bruikbare tekst. Spreek duidelijker of gebruik de lokale opname.",
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
  const raw = input.message?.trim();
  const normalized = `${input.code ?? ""} ${raw ?? ""}`.toLowerCase();
  if (input.status && input.status >= 500) {
    return ERROR_MESSAGES.LOCAL_TRANSCRIBE_API_FAILED ?? {
      code: "LOCAL_TRANSCRIBE_API_FAILED",
      title: "Lokale transcriptie mislukt",
      message: "De lokale transcriptie-endpoint gaf een fout terug. Probeer opnieuw.",
      retryable: true,
    };
  }
  if (/failed to fetch|networkerror|load failed|unexpected server error|503|service unavailable/i.test(normalized)) {
    return ERROR_MESSAGES.LOCAL_TRANSCRIBE_API_FAILED ?? {
      code: "LOCAL_TRANSCRIBE_API_FAILED",
      title: "Lokale transcriptie mislukt",
      message: "De lokale transcriptie-endpoint gaf een fout terug. Het bestaande concept bleef bewaard. Probeer opnieuw.",
      retryable: true,
    };
  }
  if (/timeout|timed out/i.test(normalized)) {
    return ERROR_MESSAGES.LOCAL_TRANSCRIBE_TIMEOUT ?? {
      code: "LOCAL_TRANSCRIBE_TIMEOUT",
      title: "Lokale transcriptie timed out",
      message: "De lokale transcriptie nam te lang. Het bestaande concept bleef bewaard; probeer opnieuw.",
      retryable: true,
    };
  }
  return {
    code: classifyVoicePipelineError({ code: input.code, status: input.status, message: input.message }),
    title: "Review niet bijgewerkt",
    message: raw ?? input.fallback ?? "De verwerking kon niet veilig worden afgerond. Het bestaande concept bleef ongewijzigd.",
    retryable: true,
  };
}
