"use client";

import { useEffect, useState } from "react";

import { formatPrivacySafeDiagnostics } from "@/src/ui/diagnostics";
import {
  ERROR_REGISTRY_UPDATED_EVENT,
  formatErrorRegistry,
  parseErrorIncidents,
  type ErrorIncident,
} from "@/src/ui/error-registry";
import { LOCAL_STORAGE_KEYS } from "@/src/memory/storage-keys";

const VOICE_PERFORMANCE_KEY = "service-ears:voice-performance:v1";

interface LocalSpeechHealth {
  configured: boolean;
  policy: "adaptive" | "fixed";
  selectedModel?: {
    id: string;
    label: string;
    tier: string;
    fileSizeMb: number;
    estimatedMemoryMb: number;
    threadCount: number;
    reason: string;
  };
  installedModels: Array<{
    id: string;
    label: string;
    tier: string;
    fileSizeMb: number;
    eligible: boolean;
    reason: string;
    averageProcessingMs?: number;
    averageRealtimeFactor?: number;
  }>;
  device: {
    totalMemoryGb: number;
    freeMemoryGb: number;
    logicalProcessors: number;
    maxSpeechThreads: number;
    maxConcurrentTranscriptions: number;
    backend: string;
  };
  targetLatencyMs: number;
  queuedTranscriptions?: number;
  activeTranscriptions?: number;
}

interface HealthResponse {
  ok?: boolean;
  adapter?: string;
  offlineSpeechConfigured?: boolean;
  offlineVadConfigured?: boolean;
  localSpeech?: LocalSpeechHealth;
  culinaryKnowledge?: { concepts: number; acousticAliases: number; speechForms: number };
  retention?: string;
}

interface DesktopSettingsProps {
  livePreviewEnabled: boolean;
  onLivePreviewEnabledChange: (enabled: boolean) => void;
  showLivePreviewSetting: boolean;
}

export function DesktopSettings({
  livePreviewEnabled,
  onLivePreviewEnabledChange,
  showLivePreviewSetting,
}: DesktopSettingsProps) {
  const [desktopStatus, setDesktopStatus] = useState<ServiceEarsDesktopStatus>();
  const [localSpeech, setLocalSpeech] = useState<LocalSpeechHealth>();
  const [culinaryKnowledge, setCulinaryKnowledge] = useState<HealthResponse["culinaryKnowledge"]>();
  const [health, setHealth] = useState<HealthResponse>();
  const [open, setOpen] = useState(false);
  const [serverError, setServerError] = useState<string>();
  const [diagnosticsStatus, setDiagnosticsStatus] = useState<"idle" | "copying" | "copied" | "error">("idle");
  const [errorIncidents, setErrorIncidents] = useState<ErrorIncident[]>([]);

  useEffect(() => {
    const bridge = window.serviceEarsDesktop;
    let unsubscribe: (() => void) | undefined;
    if (bridge) {
      void bridge.getStatus().then(setDesktopStatus);
      unsubscribe = bridge.onServerError(setServerError);
    }
    void fetch("/api/health")
      .then(async (response) => response.ok ? response.json() as Promise<HealthResponse> : undefined)
      .then((health) => {
        setHealth(health);
        setLocalSpeech(health?.localSpeech);
        setCulinaryKnowledge(health?.culinaryKnowledge);
      })
      .catch(() => { /* the main console reports server availability */ });
    return () => unsubscribe?.();
  }, []);

  useEffect(() => {
    const refreshErrors = () => {
      try {
        setErrorIncidents(parseErrorIncidents(localStorage.getItem(LOCAL_STORAGE_KEYS.errorRegistry)));
      } catch {
        setErrorIncidents([]);
      }
    };
    refreshErrors();
    window.addEventListener(ERROR_REGISTRY_UPDATED_EVENT, refreshErrors);
    window.addEventListener("storage", refreshErrors);
    return () => {
      window.removeEventListener(ERROR_REGISTRY_UPDATED_EVENT, refreshErrors);
      window.removeEventListener("storage", refreshErrors);
    };
  }, []);

  const copyDiagnostics = async () => {
    setDiagnosticsStatus("copying");
    let currentHealth = health;
    try {
      const response = await fetch("/api/health", { cache: "no-store" });
      if (response.ok) {
        currentHealth = await response.json() as HealthResponse;
        setHealth(currentHealth);
        setLocalSpeech(currentHealth.localSpeech);
        setCulinaryKnowledge(currentHealth.culinaryKnowledge);
      }
    } catch {
      // A useful offline diagnostic can still be copied from the last known health.
    }

    const report = formatPrivacySafeDiagnostics({
      generatedAt: new Date().toISOString(),
      appVersion: desktopStatus?.appVersion,
      desktop: Boolean(window.serviceEarsDesktop),
      online: navigator.onLine,
      language: navigator.language,
      viewport: {
        width: window.innerWidth,
        height: window.innerHeight,
        devicePixelRatio: window.devicePixelRatio,
      },
      health: currentHealth,
      performanceJson: localStorage.getItem(VOICE_PERFORMANCE_KEY),
      errorRegistryJson: localStorage.getItem(LOCAL_STORAGE_KEYS.errorRegistry),
      serverErrorPresent: Boolean(serverError || !currentHealth?.ok),
    });

    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(report);
      setDiagnosticsStatus("copied");
    } catch {
      setDiagnosticsStatus("error");
    }
  };

  const copyErrorRegistry = async () => {
    setDiagnosticsStatus("copying");
    try {
      if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
      await navigator.clipboard.writeText(formatErrorRegistry(errorIncidents));
      setDiagnosticsStatus("copied");
    } catch {
      setDiagnosticsStatus("error");
    }
  };

  const available = Boolean(localSpeech?.configured || desktopStatus?.offlineSpeechAvailable);
  if (!available && !desktopStatus) return null;
  const selected = localSpeech?.selectedModel;
  const hasAdaptiveCascade = localSpeech?.policy === "adaptive" && Boolean(
    localSpeech.installedModels.some((model) => model.tier === "small" && model.eligible) &&
    localSpeech.installedModels.some((model) => ["medium", "large-turbo", "large"].includes(model.tier) && model.eligible),
  );

  return (
    <>
      <button className="settings-button" onClick={() => setOpen(true)} aria-label="Instellingen openen" title="Instellingen">
        <span aria-hidden="true">⚙</span>
        <span>Instellingen</span>
      </button>
      {open && (
        <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-title-row">
              <div>
                <p className="step">ADAPTIEVE LOKALE SPRAAK</p>
                <h2 id="settings-title">Sterk zonder overbelasting</h2>
              </div>
              <button className="settings-close" onClick={() => setOpen(false)} aria-label="Sluiten">×</button>
            </div>
            <p>
              Service Ears gebruikt een snelle lokale eerste passage. Wanneer taalzekerheid én menucontext te zwak zijn,
              controleert het sterkere geïnstalleerde model automatisch opnieuw. Er draait maximaal één transcriptie tegelijk.
            </p>
            <div className={available ? "settings-success" : "settings-error"}>
              {selected
                ? <><strong>{hasAdaptiveCascade ? "Small → Large-v3 Turbo bij twijfel" : selected.label}</strong><br />{selected.reason}. Maximaal {selected.threadCount} processorthreads.</>
                : available
                  ? `${desktopStatus?.speechModel ?? "Het lokale spraakmodel"} is geïnstalleerd en klaar voor gebruik.`
                  : "De spraakmodule is niet gevonden. Installeer de nieuwste Service Ears-versie opnieuw."}
            </div>
            {showLivePreviewSetting && (
              <label className="settings-toggle">
                <input
                  type="checkbox"
                  checked={livePreviewEnabled}
                  onChange={(event) => onLivePreviewEnabledChange(event.target.checked)}
                />
                <span>
                  <strong>Snelle live voorvertoning</strong>
                  <small>Optioneel: Microsoft Edge verwerkt de spraak tijdens het luisteren. De lokale opname blijft altijd de zelfstandige eindcontrole.</small>
                </span>
              </label>
            )}
            {localSpeech && <>
              <p className="model-device-summary">
                Toestel: {localSpeech.device.totalMemoryGb} GB RAM · {localSpeech.device.logicalProcessors} logische processors · {localSpeech.device.backend}.
              </p>
              {culinaryKnowledge && <p className="model-device-summary">
                Taalbasis: {culinaryKnowledge.concepts} culinaire concepten · {culinaryKnowledge.acousticAliases.toLocaleString("nl-BE")} uitspraakvormen · {culinaryKnowledge.speechForms.toLocaleString("nl-BE")} meertalige oefenzinnen.
              </p>}
              <div className="model-list">
                {localSpeech.installedModels.map((model) => <div className="model-row" key={model.id}>
                  <div><strong>{model.label}</strong><span>{Math.round(model.fileSizeMb)} MB · {model.eligible ? "beschikbaar" : model.reason}</span></div>
                  <span className={selected?.id === model.id ? "model-active" : "model-standby"}>
                    {model.eligible && hasAdaptiveCascade
                      ? model.tier === "small" ? "SNEL" : ["medium", "large-turbo", "large"].includes(model.tier) ? "CONTROLE" : "RESERVE"
                      : selected?.id === model.id ? "ACTIEF" : model.eligible ? "RESERVE" : "UIT"}
                  </span>
                </div>)}
              </div>
            </>}
            {serverError && <p className="settings-error">{serverError}</p>}
            <div className="error-registry-panel">
              <div className="error-registry-heading">
                <div>
                  <strong>Technisch foutenregister</strong>
                  <span>{errorIncidents.length === 0 ? "Nog geen fouten geregistreerd" : `${errorIncidents.length} lokale fout${errorIncidents.length === 1 ? "" : "en"} bewaard`}</span>
                </div>
                <button
                  type="button"
                  className="secondary-button diagnostics-button"
                  disabled={diagnosticsStatus === "copying" || errorIncidents.length === 0}
                  onClick={() => void copyErrorRegistry()}
                >Register kopiëren</button>
              </div>
              {errorIncidents.slice(0, 3).map((incident) => (
                <div className="error-registry-row" key={incident.reference}>
                  <code>{incident.reference}</code>
                  <div><strong>{incident.code}</strong><span>{incident.component} · {new Date(incident.occurredAt).toLocaleString("nl-BE")}</span></div>
                </div>
              ))}
              <small>Alleen technische metadata; nooit audio, transcript, bestelling, tafelnummer of operation-id.</small>
            </div>
            <div className="diagnostics-panel">
              <div>
                <strong>Hulp nodig?</strong>
                <span>Kopieer technische status en het recente foutenregister zonder audio, transcript, bestelling of tafelgegevens.</span>
              </div>
              <button
                type="button"
                className="secondary-button diagnostics-button"
                disabled={diagnosticsStatus === "copying"}
                onClick={() => void copyDiagnostics()}
              >
                {diagnosticsStatus === "copying" ? "Controleren…" : "Diagnose + fouten kopiëren"}
              </button>
            </div>
            <p className={`diagnostics-status ${diagnosticsStatus === "error" ? "is-error" : ""}`} aria-live="polite">
              {diagnosticsStatus === "copied" && "Diagnose gekopieerd — veilig om te delen."}
              {diagnosticsStatus === "error" && "Kopiëren lukte niet. Controleer de klembordtoegang en probeer opnieuw."}
            </p>
            <div className="settings-actions">
              <button type="button" className="primary-button" onClick={() => setOpen(false)}>Begrepen</button>
            </div>
            <small>
              Geen API-sleutel of abonnement · modellen zijn verwisselbaar per toestel · audio wordt na verwerking verwijderd.
              {desktopStatus ? ` Service Ears ${desktopStatus.appVersion}.` : ""}
            </small>
          </section>
        </div>
      )}
    </>
  );
}
