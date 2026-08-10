"use client";

import { FormEvent, useEffect, useState } from "react";

export function DesktopSettings() {
  const [status, setStatus] = useState<ServiceEarsDesktopStatus>();
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    const bridge = window.serviceEarsDesktop;
    if (!bridge) return;
    void bridge.getStatus().then((nextStatus) => {
      setStatus(nextStatus);
      if (!nextStatus.openaiConfigured) setOpen(true);
    });
    return bridge.onServerError(setError);
  }, []);

  if (!status) return null;

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const bridge = window.serviceEarsDesktop;
    if (!bridge) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextStatus = await bridge.saveOpenAIKey(key);
      setStatus(nextStatus);
      setKey("");
      setOpen(false);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "De API-sleutel kon niet worden opgeslagen.");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    const bridge = window.serviceEarsDesktop;
    if (!bridge) return;
    setBusy(true);
    setError(undefined);
    try {
      const nextStatus = await bridge.clearOpenAIKey();
      setStatus(nextStatus);
      setOpen(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "De API-sleutel kon niet worden verwijderd.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button className="settings-button" onClick={() => setOpen(true)}>
        {status.openaiConfigured ? "Spraak actief" : "Spraak instellen"}
      </button>
      {open && (
        <div className="settings-backdrop" role="presentation">
          <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="settings-title-row">
              <div>
                <p className="step">DESKTOPINSTELLINGEN</p>
                <h2 id="settings-title">Spraak activeren</h2>
              </div>
              {status.openaiConfigured && <button className="settings-close" onClick={() => setOpen(false)} aria-label="Sluiten">×</button>}
            </div>
            <p>
              Voeg je OpenAI API-sleutel toe om gesprekken via de microfoon te transcriberen.
              De sleutel wordt versleuteld bewaard in je Windows-profiel en wordt nooit naar de browser gestuurd.
            </p>
            <form onSubmit={(event) => void save(event)}>
              <label htmlFor="desktop-openai-key">OpenAI API-sleutel</label>
              <input
                id="desktop-openai-key"
                type="password"
                value={key}
                onChange={(event) => setKey(event.target.value)}
                placeholder={status.openaiConfigured ? "Nieuwe sleutel invoeren…" : "sk-…"}
                autoComplete="off"
                spellCheck={false}
                disabled={busy || !status.encryptedStorageAvailable}
              />
              {!status.encryptedStorageAvailable && <p className="settings-error">Windows-versleuteling is niet beschikbaar.</p>}
              {error && <p className="settings-error">{error}</p>}
              <div className="settings-actions">
                {status.openaiConfigured && <button type="button" className="danger-button" onClick={() => void clear()} disabled={busy}>Sleutel verwijderen</button>}
                <button type="submit" className="primary-button" disabled={busy || !key.trim() || !status.encryptedStorageAvailable}>
                  {busy ? "Opslaan en herstarten…" : "Opslaan en spraak activeren"}
                </button>
              </div>
            </form>
            <small>Service Ears {status.appVersion} · Audio wordt na verwerking verwijderd.</small>
          </section>
        </div>
      )}
    </>
  );
}
