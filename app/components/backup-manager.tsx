"use client";

import { useEffect, useRef, useState } from "react";

import {
  applyLocalBackupAtomically,
  buildLocalBackup,
  formatLocalBackup,
  hasLocalBackupRollback,
  parseLocalBackup,
  restorePreviousLocalStateAtomically,
  type LocalBackup,
  type LocalBackupPreview,
} from "@/src/memory/local-backup";
import { BACKUP_RESTORE_NOTICE_KEY } from "@/src/memory/storage-keys";

type Status = { kind: "success" | "error"; message: string };

export function BackupManager() {
  const [open, setOpen] = useState(false);
  const [candidate, setCandidate] = useState<{ backup: LocalBackup; preview: LocalBackupPreview }>();
  const [rollbackConfirmation, setRollbackConfirmation] = useState(false);
  const [rollbackAvailable, setRollbackAvailable] = useState(false);
  const [status, setStatus] = useState<Status>();
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const restored = sessionStorage.getItem(BACKUP_RESTORE_NOTICE_KEY);
      if (!restored) return;
      sessionStorage.removeItem(BACKUP_RESTORE_NOTICE_KEY);
      setRollbackAvailable(hasLocalBackupRollback(localStorage));
      setStatus({ kind: "success", message: restored });
      setOpen(true);
    }, 0);
    return () => window.clearTimeout(timer);
  }, []);

  const downloadBackup = () => {
    try {
      const backup = buildLocalBackup(localStorage);
      const url = URL.createObjectURL(new Blob([formatLocalBackup(backup)], { type: "application/json" }));
      const link = document.createElement("a");
      link.href = url;
      link.download = `service-ears-backup-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
      setStatus({ kind: "success", message: "Back-up gedownload. Bewaar het bestand op een veilige plek." });
    } catch {
      setStatus({ kind: "error", message: "De lokale gegevens konden niet veilig worden gebundeld. Probeer opnieuw." });
    }
  };

  const chooseBackup = async (file?: File) => {
    setCandidate(undefined);
    setRollbackConfirmation(false);
    if (!file) return;
    try {
      const parsed = parseLocalBackup(await file.text());
      if (!parsed.ok) {
        setStatus({ kind: "error", message: parsed.error });
        return;
      }
      setCandidate({ backup: parsed.backup, preview: parsed.preview });
      setStatus(undefined);
    } catch {
      setStatus({ kind: "error", message: "Het back-upbestand kon niet worden gelezen." });
    }
  };

  const applyBackup = () => {
    if (!candidate) return;
    try {
      applyLocalBackupAtomically(localStorage, candidate.backup);
      sessionStorage.setItem(BACKUP_RESTORE_NOTICE_KEY, "Back-up veilig hersteld. Alle concepten staan opnieuw op ‘niet verzonden’ en moeten worden gecontroleerd.");
      window.location.reload();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "Herstellen is mislukt; de vorige staat is behouden.",
      });
    }
  };

  const applyRollback = () => {
    try {
      restorePreviousLocalStateAtomically(localStorage);
      sessionStorage.setItem(BACKUP_RESTORE_NOTICE_KEY, "De vorige lokale staat is teruggezet.");
      window.location.reload();
    } catch (error) {
      setStatus({
        kind: "error",
        message: error instanceof Error ? error.message : "De vorige staat kon niet worden teruggezet.",
      });
    }
  };

  const close = () => {
    setOpen(false);
    setCandidate(undefined);
    setRollbackConfirmation(false);
    setStatus(undefined);
  };

  return <>
    <button className="settings-button" onClick={() => {
      setRollbackAvailable(hasLocalBackupRollback(localStorage));
      setOpen(true);
    }}>Back-up</button>
    {open && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
      <section className="settings-dialog backup-dialog" role="dialog" aria-modal="true" aria-labelledby="backup-title">
        <div className="settings-title-row">
          <div><p className="eyebrow">LOKAAL BEHOUDEN EN HERSTELLEN</p><h2 id="backup-title">Back-up van je werk</h2></div>
          <button className="settings-close" onClick={close} aria-label="Sluiten">×</button>
        </div>
        <p>Bewaar tafelcontext, bestelconcepten en goedgekeurde taalregels in één bestand. Audio, transcripties, timinggegevens, modellen en de POS-kaart worden nooit opgenomen.</p>

        <div className="backup-privacy-note">
          <strong>Blijft onder jouw controle</strong>
          <span>De back-up verlaat deze laptop alleen wanneer jij het gedownloade bestand zelf verplaatst. Het bestand kan tafelcodes en orderinhoud bevatten.</span>
        </div>

        <div className="backup-actions-grid">
          <button type="button" className="primary-button" onClick={downloadBackup}>Back-up downloaden</button>
          <button type="button" className="secondary-button" onClick={() => fileInput.current?.click()}>Back-up kiezen…</button>
        </div>
        <input ref={fileInput} hidden type="file" accept="application/json,.json" onChange={(event) => {
          void chooseBackup(event.target.files?.[0]);
          event.target.value = "";
        }} />

        {candidate && <div className="backup-preview" aria-live="polite">
          <div><span>Actieve tafel</span><strong>{candidate.preview.activeTableId ?? "Geen"}</strong></div>
          <div><span>Concepten</span><strong>{candidate.preview.draftCount}</strong></div>
          <div><span>Bestellijnen</span><strong>{candidate.preview.lineCount}</strong></div>
          <div><span>Contexttafels</span><strong>{candidate.preview.contextTableCount}</strong></div>
          <div><span>Gebeurtenissen</span><strong>{candidate.preview.eventCount}</strong></div>
          <div><span>Goedgekeurde taalregels</span><strong>{candidate.preview.approvedMappingCount}</strong></div>
          <p>Herstellen vervangt de huidige lokale werkstaat. Eerder verzonden concepten worden voor veiligheid opnieuw <strong>niet verzonden</strong>.</p>
          <div className="settings-actions">
            <button type="button" className="secondary-button" onClick={() => setCandidate(undefined)}>Annuleren</button>
            <button type="button" className="primary-button" onClick={applyBackup}>Herstellen en herladen</button>
          </div>
        </div>}

        {rollbackAvailable && !candidate && <div className="backup-rollback">
          <strong>Verkeerde back-up hersteld?</strong>
          <span>De staat van vlak vóór de laatste import is nog beschikbaar.</span>
          {!rollbackConfirmation
            ? <button type="button" className="secondary-button" onClick={() => setRollbackConfirmation(true)}>Vorige staat terugzetten</button>
            : <div className="settings-actions">
              <button type="button" className="secondary-button" onClick={() => setRollbackConfirmation(false)}>Annuleren</button>
              <button type="button" className="danger-button" onClick={applyRollback}>Ja, vorige staat terugzetten</button>
            </div>}
        </div>}

        {status && <p className={`backup-status ${status.kind === "error" ? "is-error" : ""}`} role="status">{status.message}</p>}
      </section>
    </div>}
  </>;
}
