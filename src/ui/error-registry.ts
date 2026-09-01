import type { UserFacingVoiceError } from "@/src/ui/voice-errors";

export const ERROR_REGISTRY_UPDATED_EVENT = "service-ears:error-registry-updated";
export const MAX_ERROR_INCIDENTS = 30;

export type ErrorPhase =
  | "startup"
  | "menu"
  | "microphone"
  | "browser-speech"
  | "audio-finalization"
  | "transcription"
  | "interpretation"
  | "pos"
  | "unknown";

export interface ErrorIncident {
  reference: string;
  fingerprint: string;
  occurredAt: string;
  code: string;
  phase: ErrorPhase;
  component: string;
  explanation: string;
  suggestedChecks: string[];
  retryable: boolean;
  status?: number;
  endpoint?: string;
  serverReference?: string;
  elapsedMs?: number;
  runtime: "desktop" | "browser";
  online: boolean;
  speechMode?: string;
  voicePhase?: string;
}

export interface ErrorIncidentInput {
  friendly: UserFacingVoiceError;
  code?: string;
  status?: number;
  endpoint?: string;
  serverReference?: string;
  phase: ErrorPhase;
  elapsedMs?: number;
  runtime: "desktop" | "browser";
  online: boolean;
  speechMode?: string;
  voicePhase?: string;
  now?: Date;
  referenceSuffix?: string;
}

interface TechnicalExplanation {
  component: string;
  explanation: string;
  suggestedChecks: string[];
}

const TECHNICAL_EXPLANATIONS: Record<string, TechnicalExplanation> = {
  TRANSCRIPTION_BUDGET_EXCEEDED: {
    component: "Lokale transcriptie",
    explanation: "Het lokale Whisper-model leverde binnen de maximale verwerkingstijd geen volledige, bruikbare transcriptie. Het concept is daarom niet overschreven met een onvolledige gok.",
    suggestedChecks: ["Controleer modelopwarming en verwerkingstijd", "Vergelijk opnameduur met transcriptieduur", "Controleer ruisniveau en beschikbare live hypothesen"],
  },
  LOCAL_TRANSCRIBE_API_FAILED: {
    component: "Lokale transcriptie API",
    explanation: "De lokale transcriptie-endpoint gaf een fout terug, vaak door een ontbrekende modelruntime of een afgebroken verwerking.",
    suggestedChecks: ["Controleer /api/transcribe", "Controleer of de lokale runtime nog actief is", "Controleer 503/timeout-gevallen in de serverlog"],
  },
  LOCAL_TRANSCRIBE_TIMEOUT: {
    component: "Lokale transcriptie timeout",
    explanation: "De lokale transcriptie hield te lang de verwerking vast en mislukte nadien zonder veilig conceptresultaat.",
    suggestedChecks: ["Controleer opname- en modeltijd", "Korte opnames eerst testen", "Controleer of een modelproces vastloopt"],
  },
  WAV_CREATION_FAILED: {
    component: "Audiofinalisatie",
    explanation: "De opname kon niet veilig naar WAV worden omgezet en werd daarom niet doorgestuurd voor herkenning.",
    suggestedChecks: ["Controleer opnameduur en microfoonsignaal", "Controleer WAV-encoding in de browser", "Controleer of de opnamen daadwerkelijk stem bevatten"],
  },
  AUDIO_WAV_HEADER_INVALID: {
    component: "Audioformatvalidatie",
    explanation: "De WAV-header was afwezig of beschadigd, waardoor de opname niet als valide lokaal audiofragment kon worden verwerkt.",
    suggestedChecks: ["Controleer audioformat in browser-devtools", "Controleer audio-chunks in het capture-proces", "Controleer op de juiste samplefrequentie"],
  },
  AUDIO_SAMPLE_RATE_INVALID: {
    component: "Microfoonkwaliteit",
    explanation: "De microfoonlevering had een ongeldige of te lage samplefrequentie voor veilige lokale verwerking.",
    suggestedChecks: ["Controleer het gekozen invoerapparaat", "Controleer browser- en Windows-audiokwaliteit", "Probeer een andere microfoon of kortere opname"],
  },
  AUDIO_CHUNKS_EMPTY: {
    component: "Microfoonstram",
    explanation: "Er werden geen bruikbare audiodata-chunks verzameld voor verdere verwerking.",
    suggestedChecks: ["Controleer of de stream daadwerkelijk is gestart", "Controleer het audioproces in de browser", "Controleer of de opname is afgelopen zonder stem"],
  },
  AUDIO_ONLY_NOISE: {
    component: "Audiofilter",
    explanation: "De voorbewerking classificeerde de opname als omgevingsgeluid zonder bruikbare spraak.",
    suggestedChecks: ["Controleer ruisprofiel en microfoondrempel", "Controleer de afstand tot de spreker", "Test met kortere, duidelijkere zinnen"],
  },
  NO_SPEECH_DETECTED: {
    component: "Spraakdetectie",
    explanation: "Er was te weinig aaneengesloten stemsignaal om veilig een conversatie te beschouwen.",
    suggestedChecks: ["Controleer spraakvolume", "Controleer ruis en stilte", "Test een kortere, helderdere uitspraak"],
  },
  MICROPHONE_STREAM_FAILED: {
    component: "Microfoonstream",
    explanation: "De microfoonstream werd niet betrouwbaar opgebouwd en kon daardoor geen audiodata leveren.",
    suggestedChecks: ["Controleer microfoontoestemming", "Controleer apparaatkeuze", "Controleer browser- of OS-audiolocks"],
  },
  BROWSER_SPEECH_UNAVAILABLE: {
    component: "Browserherkenning",
    explanation: "De browser bood geen werkende SpeechRecognition-API aan voor live herkenning.",
    suggestedChecks: ["Gebruik Edge of een compatibele browser", "Controleer browser-ondersteuning", "Val terug op de lokale route"],
  },
  BROWSER_SPEECH_FAILED: {
    component: "Browserherkenning",
    explanation: "De optionele browserherkenning stopte voor een fout of een leeg resultaat en ging niet veilig door.",
    suggestedChecks: ["Controleer microfoontoegang", "Controleer netwerkstatus", "Controleer Edge spraakinstellingen"],
  },
  OFFLINE_TRANSCRIPTION_FAILED: {
    component: "Lokale transcriptie",
    explanation: "De lokale transcriptiemotor kon de WAV-opname niet verwerken of het modelproces stopte onverwacht.",
    suggestedChecks: ["Controleer de lokale Whisper-processen", "Controleer model- en VAD-bestanden", "Bekijk de lokale serverlog rond deze foutreferentie"],
  },
  LOCAL_WHISPER_RUNTIME_UNAVAILABLE: {
    component: "Lokale modelruntime",
    explanation: "Het lokale modelproces was tijdelijk niet beschikbaar. Een volgende opname mag dezelfde runtime opnieuw opbouwen; het model is niet door deze ene fout gedeactiveerd.",
    suggestedChecks: ["Controleer runtime-readiness", "Controleer of één herstelproces actief is", "Herhaal een korte testopname"],
  },
  LOCAL_SPEECH_BUSY: {
    component: "Lokale spraakwachtrij",
    explanation: "Een eerdere transcriptie hield de enige toegestane lokale transcriptieplaats nog bezet.",
    suggestedChecks: ["Controleer actieve en wachtende transcripties", "Meet de duur van de vorige opname", "Controleer of een modelproces bleef hangen"],
  },
  NO_SPEECH_DETECTED: {
    component: "Spraakdetectie",
    explanation: "De opname bevatte onvoldoende aaneengesloten stemsignaal om veilig als gesprek te verwerken.",
    suggestedChecks: ["Controleer microfoonniveau", "Controleer ruisdrempel en stiltepercentage", "Spreek dichter bij de microfoon"],
  },
  AUDIO_ONLY_NOISE: {
    component: "Audiofilter",
    explanation: "De lokale voorbewerking classificeerde de opname als omgevingsgeluid zonder betrouwbaar stemsegment.",
    suggestedChecks: ["Controleer het gekalibreerde ruisprofiel", "Controleer microfoonrichting", "Test met kortere afstand tot de spreker"],
  },
  MICROPHONE_DENIED: {
    component: "Microfoontoegang",
    explanation: "Windows of de browser gaf geen bruikbare audiostream aan Service Ears.",
    suggestedChecks: ["Controleer browsertoestemming", "Controleer Windows-microfoonprivacy", "Controleer het geselecteerde invoerapparaat"],
  },
  BROWSER_SPEECH_UNAVAILABLE: {
    component: "Browserherkenning",
    explanation: "De actieve browser biedt geen compatibele live spraakherkenningsinterface.",
    suggestedChecks: ["Gebruik de lokale geïnstalleerde route", "Controleer browserondersteuning", "Laat Edge-voorvertoning uitgeschakeld als lokale spraak werkt"],
  },
  BROWSER_SPEECH_FAILED: {
    component: "Browserherkenning",
    explanation: "De optionele live browserherkenning stopte voordat ze bruikbare tekst kon afleveren.",
    suggestedChecks: ["Controleer internetverbinding voor Edge-spraak", "Controleer microfoontoegang", "Gebruik de lokale opname als eindcontrole"],
  },
  MENU_LOAD_FAILED: {
    component: "Menukaart",
    explanation: "De actieve menukaart kon niet van de lokale server worden geladen; productgronding is daardoor niet veilig beschikbaar.",
    suggestedChecks: ["Controleer /api/menu", "Controleer de lokale serverstatus", "Controleer de POS-adapter"],
  },
  INVALID_REQUEST: {
    component: "API-validatie",
    explanation: "De lokale API wees de aanvraag af omdat verplichte of versiegebonden gegevens niet geldig waren.",
    suggestedChecks: ["Controleer request-schema en appversie", "Controleer tabel- en conceptrevisie", "Controleer API-responsdetails in de serverlog"],
  },
  POS_READBACK_FAILED: {
    component: "POS-bevestiging",
    explanation: "Het concept werd verstuurd, maar kon niet betrouwbaar uit de POS-adapter worden teruggelezen.",
    suggestedChecks: ["Controleer de POS-referentie", "Controleer adapterbeschikbaarheid", "Voorkom opnieuw verzenden tot de status bevestigd is"],
  },
  POS_UNAVAILABLE: {
    component: "POS-adapter",
    explanation: "De geconfigureerde POS-adapter kon het gevalideerde bestelconcept niet ontvangen.",
    suggestedChecks: ["Controleer adapter-health", "Controleer ondersteunde POS-capaciteiten", "Bewaar het lokale concept voor herstel"],
  },
  INTERNAL_ERROR: {
    component: "Lokale appserver",
    explanation: "De lokale server bereikte een onverwacht codepad en gaf geen veilig domeinantwoord terug.",
    suggestedChecks: ["Zoek de foutreferentie in de lokale serverlog", "Controleer de eerste stacktrace", "Reproduceer met dezelfde fase, niet met klantinhoud"],
  },
  NETWORK_UNAVAILABLE: {
    component: "Lokale verbinding",
    explanation: "De interface kon de lokale Service Ears-server tijdelijk niet bereiken.",
    suggestedChecks: ["Controleer http://127.0.0.1:3211/api/health", "Controleer het lokale serverproces", "Controleer poort 3211"],
  },
};

const PHASE_DEFAULTS: Record<ErrorPhase, TechnicalExplanation> = {
  startup: { component: "Appstart", explanation: "Een onderdeel dat nodig is om Service Ears gebruiksklaar te maken kon niet worden gestart.", suggestedChecks: ["Controleer app-health", "Controleer de lokale serverlog"] },
  menu: { component: "Menukaart", explanation: "De menukaart- of productcontext kon niet veilig worden voorbereid.", suggestedChecks: ["Controleer /api/menu", "Controleer de POS-adapter"] },
  microphone: { component: "Microfoon", explanation: "De audiocaptatie kon niet betrouwbaar worden gestart of afgerond.", suggestedChecks: ["Controleer microfoontoegang", "Controleer invoerapparaat en niveau"] },
  "browser-speech": { component: "Browserherkenning", explanation: "De optionele browserherkenning stopte onverwacht.", suggestedChecks: ["Controleer browserondersteuning", "Gebruik lokale transcriptie"] },
  "audio-finalization": { component: "Audioverwerking", explanation: "De opgenomen audio kon niet tot een geldige lokale WAV worden verwerkt.", suggestedChecks: ["Controleer opnameduur", "Controleer audioformat en spraakdetectie"] },
  transcription: { component: "Transcriptie", explanation: "De opname leverde geen volledige transcriptie voor veilige orderinterpretatie.", suggestedChecks: ["Controleer modelruntime", "Controleer audio- en latentiemetingen"] },
  interpretation: { component: "Orderinterpretatie", explanation: "De transcriptie kon niet tot een gevalideerd bestelconcept worden verwerkt.", suggestedChecks: ["Controleer API-validatie", "Controleer menucontext en conceptrevisie"] },
  pos: { component: "POS-overdracht", explanation: "Het bestelconcept kon niet volledig door de POS-bevestigingsstappen.", suggestedChecks: ["Controleer adapter-health", "Controleer POS read-back"] },
  unknown: { component: "Service Ears", explanation: "De fout werd geregistreerd, maar heeft nog geen specifiek technisch patroon in het register.", suggestedChecks: ["Gebruik foutreferentie, code, fase en tijdstip om de eerste serverfout te vinden"] },
};

const ERROR_PHASES = new Set<ErrorPhase>([
  "startup", "menu", "microphone", "browser-speech", "audio-finalization",
  "transcription", "interpretation", "pos", "unknown",
]);
const SPEECH_MODES = new Set(["detecting", "offline", "browser", "unavailable"]);
const VOICE_PHASES = new Set([
  "IDLE", "CALIBRATING", "LISTENING", "FINALIZING_AUDIO", "PROVISIONAL_REVIEW",
  "LOCAL_TRANSCRIBING", "INTERPRETING", "READY_FOR_REVIEW", "SENDING", "SENT",
  "ERROR", "CANCELLED",
]);

function safeCode(value: string | undefined): string {
  const normalized = value?.trim().toUpperCase().replace(/[^A-Z0-9_-]/g, "_").slice(0, 64);
  return normalized || "UNKNOWN";
}

function safeEndpoint(value: string | undefined): string | undefined {
  if (!value?.startsWith("/api/")) return undefined;
  return value.split("?")[0].slice(0, 120);
}

function safeServerReference(value: string | undefined): string | undefined {
  return value && /^SRV-\d{14}-[A-Z0-9]{6}$/.test(value) ? value : undefined;
}

function hashFingerprint(value: string): string {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function referenceSuffix(value?: string): string {
  const provided = value?.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  if (provided) return provided.padEnd(6, "0");
  const random = globalThis.crypto?.randomUUID?.().replaceAll("-", "").slice(0, 6).toUpperCase();
  return random || Math.random().toString(36).slice(2, 8).toUpperCase().padEnd(6, "0");
}

export function createErrorIncident(input: ErrorIncidentInput): ErrorIncident {
  const now = input.now ?? new Date();
  const code = safeCode(input.code ?? input.friendly.code);
  const technical = TECHNICAL_EXPLANATIONS[code] ?? PHASE_DEFAULTS[input.phase];
  const endpoint = safeEndpoint(input.endpoint);
  const status = typeof input.status === "number" && Number.isInteger(input.status) && input.status >= 100 && input.status <= 599
    ? input.status
    : undefined;
  const elapsedMs = typeof input.elapsedMs === "number" && Number.isFinite(input.elapsedMs) && input.elapsedMs >= 0
    ? Math.min(300_000, Math.round(input.elapsedMs))
    : undefined;
  const datePart = now.toISOString().slice(0, 10).replaceAll("-", "");
  return {
    reference: `SE-${datePart}-${referenceSuffix(input.referenceSuffix)}`,
    fingerprint: hashFingerprint([code, input.phase, endpoint ?? "local", status ?? 0].join("|")),
    occurredAt: now.toISOString(),
    code,
    phase: input.phase,
    component: technical.component,
    explanation: technical.explanation,
    suggestedChecks: technical.suggestedChecks.slice(0, 4),
    retryable: input.friendly.retryable,
    status,
    endpoint,
    serverReference: safeServerReference(input.serverReference),
    elapsedMs,
    runtime: input.runtime,
    online: input.online,
    speechMode: input.speechMode?.slice(0, 40),
    voicePhase: input.voicePhase?.slice(0, 40),
  };
}

function isErrorIncident(value: unknown): value is ErrorIncident {
  if (!value || typeof value !== "object") return false;
  const incident = value as Partial<ErrorIncident>;
  return typeof incident.reference === "string" && /^SE-\d{8}-[A-Z0-9]{6}$/.test(incident.reference) &&
    typeof incident.fingerprint === "string" && /^[a-f0-9]{8}$/.test(incident.fingerprint) &&
    typeof incident.occurredAt === "string" && !Number.isNaN(Date.parse(incident.occurredAt)) &&
    typeof incident.code === "string" && typeof incident.phase === "string" && ERROR_PHASES.has(incident.phase as ErrorPhase) &&
    typeof incident.component === "string" && typeof incident.explanation === "string" &&
    Array.isArray(incident.suggestedChecks) && incident.suggestedChecks.every((item) => typeof item === "string") &&
    typeof incident.retryable === "boolean" && typeof incident.online === "boolean" &&
    (incident.runtime === "desktop" || incident.runtime === "browser");
}

export function parseErrorIncidents(raw: string | null | undefined): ErrorIncident[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isErrorIncident).slice(0, MAX_ERROR_INCIDENTS).map((incident) => {
      const code = safeCode(incident.code);
      const technical = TECHNICAL_EXPLANATIONS[code] ?? PHASE_DEFAULTS[incident.phase];
      return {
        ...incident,
        code,
        endpoint: safeEndpoint(incident.endpoint),
        serverReference: safeServerReference(incident.serverReference),
        status: typeof incident.status === "number" && Number.isInteger(incident.status) && incident.status >= 100 && incident.status <= 599 ? incident.status : undefined,
        elapsedMs: typeof incident.elapsedMs === "number" && Number.isFinite(incident.elapsedMs) && incident.elapsedMs >= 0 ? Math.min(300_000, Math.round(incident.elapsedMs)) : undefined,
        component: technical.component,
        explanation: technical.explanation,
        suggestedChecks: technical.suggestedChecks.slice(0, 4),
        speechMode: incident.speechMode && SPEECH_MODES.has(incident.speechMode) ? incident.speechMode : undefined,
        voicePhase: incident.voicePhase && VOICE_PHASES.has(incident.voicePhase) ? incident.voicePhase : undefined,
      };
    });
  } catch {
    return [];
  }
}

export function appendErrorIncident(current: ErrorIncident[], incident: ErrorIncident): ErrorIncident[] {
  return [incident, ...current.filter((item) => item.reference !== incident.reference)].slice(0, MAX_ERROR_INCIDENTS);
}

export function formatErrorIncident(incident: ErrorIncident): string {
  return [
    "SERVICE EARS TECHNISCH FOUTRAPPORT",
    `Referentie: ${incident.reference}`,
    `Tijdstip: ${incident.occurredAt}`,
    `Fingerprint: ${incident.fingerprint}`,
    `Code: ${incident.code}`,
    `Fase: ${incident.phase}`,
    `Component: ${incident.component}`,
    `Endpoint: ${incident.endpoint ?? "lokaal"}`,
    `Serverreferentie: ${incident.serverReference ?? "n.v.t."}`,
    `HTTP-status: ${incident.status ?? "n.v.t."}`,
    `Duur tot fout: ${incident.elapsedMs ?? "onbekend"} ms`,
    `Runtime: ${incident.runtime}`,
    `Online: ${incident.online}`,
    `Spraakmodus: ${incident.speechMode ?? "onbekend"}`,
    `Pipelinefase: ${incident.voicePhase ?? "onbekend"}`,
    "",
    `Technische uitleg: ${incident.explanation}`,
    "Controlepunten:",
    ...incident.suggestedChecks.map((item) => `- ${item}`),
    "",
    "Privacy: bevat geen audio, transcript, bestelling, tafelnummer of operation-id.",
  ].join("\n");
}

export function formatErrorRegistry(incidents: ErrorIncident[]): string {
  const recent = incidents.slice(0, 10);
  return [
    `SERVICE EARS FOUTENREGISTER (${recent.length}/${incidents.length})`,
    "",
    ...recent.flatMap((incident, index) => [formatErrorIncident(incident), ...(index < recent.length - 1 ? ["", "---", ""] : [])]),
  ].join("\n");
}
