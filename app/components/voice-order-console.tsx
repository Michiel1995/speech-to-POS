"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type {
  ConversationTurn,
  Course,
  DraftIssue,
  DraftOrder,
  TenantMenu,
} from "@/src/domain/schemas";
import {
  addManualProduct,
  resolveIssueWithoutData,
  resolveModifier,
  resolveWithProduct,
} from "@/src/ui/draft-actions";
import { formatTurns, parseTranscript } from "@/src/ui/transcript";
import { DesktopSettings } from "./desktop-settings";

const DEMOS = {
  core: `Customer: Voor mij de steak saignant met frieten en pepersaus.
Waiter: Dus steak saignant, frieten en pepersaus?
Customer: Ja.
Customer: Voor mij de vol-au-vent met kroketten en twee Duvel.
Customer: Nee wacht, één Duvel en doe er een Stella bij.`,
  ambiguity: "Customer: Een Leffe.",
  unknown: "Customer: Voor mij een truffelpasta.",
  question: `Customer: Hebben jullie alcoholvrij bier?
Waiter: We hebben Leffe 0.0.
Customer: Dan neem ik de alcoholvrije Leffe.`,
  course: "Customer: Ik neem de garnaalkroketten maar breng die samen met mijn steak.",
  mixed: "Customer: Voor mij de steak medium rare with fries en béarnaise.",
};

const COURSE_LABELS: Record<Course, string> = {
  drinks: "Drinks",
  starter: "Starters",
  main: "Main course",
  dessert: "Dessert",
  unspecified: "Unspecified",
};

interface MenuResponse {
  menu: TenantMenu;
  adapter: string;
  capabilities: { draftOrderCreate: boolean };
}

interface ApiFailure {
  error?: string;
  code?: string;
}

function price(cents: number) {
  return new Intl.NumberFormat("en-BE", { style: "currency", currency: "EUR" }).format(cents / 100);
}

function UnresolvedChoice({
  draft,
  issue,
  menu,
  onChange,
}: {
  draft: DraftOrder;
  issue: DraftIssue;
  menu: TenantMenu;
  onChange: (draft: DraftOrder) => void;
}) {
  const [productId, setProductId] = useState("");
  return (
    <div className="resolution-row">
      <select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="Choose a POS product">
        <option value="">Choose valid POS product…</option>
        {[...menu.products]
          .filter((product) => product.active)
          .sort((a, b) => a.canonicalName.localeCompare(b.canonicalName))
          .map((product) => (
            <option value={product.id} key={product.id}>{product.canonicalName} · {product.posName}</option>
          ))}
      </select>
      <button
        className="small-button"
        disabled={!productId}
        onClick={() => {
          const product = menu.products.find((candidate) => candidate.id === productId);
          if (product) onChange(resolveWithProduct(draft, issue.id, product, menu));
        }}
      >
        Use product
      </button>
    </div>
  );
}

export function VoiceOrderConsole() {
  const [menuResponse, setMenuResponse] = useState<MenuResponse>();
  const [tableId, setTableId] = useState("TABLE-12");
  const [engine, setEngine] = useState<"deterministic" | "openai">("deterministic");
  const [transcript, setTranscript] = useState(DEMOS.core);
  const [draft, setDraft] = useState<DraftOrder>();
  const [correction, setCorrection] = useState("");
  const [manualProductId, setManualProductId] = useState("");
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState<"conversation" | "correction">();
  const [shiftMode, setShiftMode] = useState(false);
  const [online, setOnline] = useState(true);
  const [error, setError] = useState<string>();
  const mediaRecorder = useRef<MediaRecorder | undefined>(undefined);
  const recordingChunks = useRef<Blob[]>([]);

  const menu = menuResponse?.menu;
  const selectedTable = menu?.tables.find((table) => table.id === tableId);

  useEffect(() => {
    const hydrateTimer = window.setTimeout(() => {
      setOnline(navigator.onLine);
      const cachedMenu = localStorage.getItem("service-ears:menu");
      const savedDraft = localStorage.getItem("service-ears:draft");
      const savedTable = localStorage.getItem("service-ears:table");
      if (cachedMenu) {
        try { setMenuResponse(JSON.parse(cachedMenu) as MenuResponse); } catch { /* ignore corrupt cache */ }
      }
      if (savedDraft) {
        try { setDraft(JSON.parse(savedDraft) as DraftOrder); } catch { /* ignore corrupt cache */ }
      }
      if (savedTable) setTableId(savedTable);
    }, 0);

    void fetch("/api/menu")
      .then(async (response) => {
        if (!response.ok) throw new Error("Menu refresh failed; cached menu remains active.");
        return (await response.json()) as MenuResponse;
      })
      .then((result) => {
        setMenuResponse(result);
        localStorage.setItem("service-ears:menu", JSON.stringify(result));
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "Menu unavailable."));

    const updateOnline = () => setOnline(navigator.onLine);
    window.addEventListener("online", updateOnline);
    window.addEventListener("offline", updateOnline);
    if ("serviceWorker" in navigator) void navigator.serviceWorker.register("/sw.js");
    return () => {
      window.clearTimeout(hydrateTimer);
      window.removeEventListener("online", updateOnline);
      window.removeEventListener("offline", updateOnline);
    };
  }, []);

  useEffect(() => {
    if (draft) localStorage.setItem("service-ears:draft", JSON.stringify(draft));
  }, [draft]);

  useEffect(() => {
    localStorage.setItem("service-ears:table", tableId);
  }, [tableId]);

  const interpretTurns = useCallback(async (
    turns: ConversationTurn[],
    source: "text" | "audio" | "manual",
    priorLines?: DraftOrder["lines"],
  ) => {
    if (!menu || !selectedTable) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/interpret", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tenantId: menu.tenantId,
          tableId: selectedTable.id,
          tableLabel: selectedTable.label,
          waiterId: "waiter-demo",
          source,
          engine,
          turns,
          priorLines,
        }),
      });
      const result = (await response.json()) as { draft?: DraftOrder } & ApiFailure;
      if (!response.ok || !result.draft) throw new Error(result.error ?? "Interpretation failed.");
      setDraft(result.draft);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Interpretation failed.");
    } finally {
      setBusy(false);
    }
  }, [engine, menu, selectedTable]);

  const applyCorrection = useCallback(async (text: string) => {
    if (!draft || !text.trim()) return;
    await interpretTurns([{ speaker: "unknown", text: text.trim() }], "manual", draft.lines);
    setCorrection("");
  }, [draft, interpretTurns]);

  const uploadRecording = useCallback(async (blob: Blob, purpose: "conversation" | "correction") => {
    setBusy(true);
    setError(undefined);
    try {
      const extension = blob.type.includes("mp4") ? "m4a" : "webm";
      const data = new FormData();
      data.append("audio", new File([blob], `conversation.${extension}`, { type: blob.type }));
      const response = await fetch("/api/transcribe", { method: "POST", body: data });
      const result = (await response.json()) as { text?: string; turns?: ConversationTurn[] } & ApiFailure;
      if (!response.ok || !result.turns || !result.text) throw new Error(result.error ?? "Transcription failed.");
      if (purpose === "correction") {
        await applyCorrection(result.text);
      } else {
        setTranscript(formatTurns(result.turns));
        await interpretTurns(result.turns, "audio");
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Audio processing failed.");
    } finally {
      setBusy(false);
    }
  }, [applyCorrection, interpretTurns]);

  const startRecording = async (purpose: "conversation" | "correction") => {
    setError(undefined);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4"].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      recordingChunks.current = [];
      recorder.ondataavailable = (event) => { if (event.data.size) recordingChunks.current.push(event.data); };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunks.current, { type: recorder.mimeType || "audio/webm" });
        stream.getTracks().forEach((track) => track.stop());
        setRecording(undefined);
        void uploadRecording(blob, purpose);
      };
      recorder.start(500);
      mediaRecorder.current = recorder;
      setRecording(purpose);
    } catch (reason) {
      setError(reason instanceof Error ? `Microphone unavailable: ${reason.message}` : "Microphone permission denied.");
    }
  };

  const stopRecording = () => mediaRecorder.current?.state === "recording" && mediaRecorder.current.stop();

  const sendDraft = async () => {
    if (!draft) return;
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch("/api/pos/drafts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ draft: { ...draft, status: "NOT_SENT" }, idempotencyKey: `draft:${draft.id}`, sentBy: "waiter-demo" }),
      });
      const result = (await response.json()) as { draft?: DraftOrder } & ApiFailure;
      if (!response.ok || !result.draft) throw new Error(result.error ?? "POS submission failed.");
      setDraft(result.draft);
    } catch (reason) {
      setDraft((current) => current ? { ...current, status: "ERROR", updatedAt: new Date().toISOString() } : current);
      setError(reason instanceof Error ? reason.message : "POS submission failed.");
    } finally {
      setBusy(false);
    }
  };

  const groupedLines = useMemo(() => {
    if (!draft) return [];
    return (["drinks", "starter", "main", "dessert", "unspecified"] as Course[])
      .map((course) => ({ course, lines: draft.lines.filter((line) => line.course === course) }))
      .filter((group) => group.lines.length);
  }, [draft]);

  const hasBlockers = draft?.issues.some((issue) => issue.blocking) ?? true;

  return (
    <main>
      <header className="app-header">
        <div>
          <p className="eyebrow">VOICE → VALID POS OBJECTS</p>
          <h1>Service Ears</h1>
        </div>
        <div className="header-statuses">
          <DesktopSettings />
          <span className={`network ${online ? "online" : "offline"}`}>{online ? "Online" : "Offline"}</span>
          <button className={`shift-toggle ${shiftMode ? "active" : ""}`} onClick={() => setShiftMode((value) => !value)}>
            {shiftMode ? "Shift mode on" : "Start shift"}
          </button>
        </div>
      </header>

      <section className="hero-card">
        <div className="table-picker">
          <label htmlFor="table">Current table</label>
          <select id="table" value={tableId} onChange={(event) => setTableId(event.target.value)} disabled={!menu}>
            {menu?.tables.filter((table) => table.active).map((table) => <option key={table.id} value={table.id}>{table.label}</option>)}
          </select>
        </div>
        <div className="record-area">
          <button
            className={`record-button ${recording === "conversation" ? "recording" : ""}`}
            disabled={busy || !shiftMode}
            onClick={() => recording === "conversation" ? stopRecording() : void startRecording("conversation")}
            aria-label={recording === "conversation" ? "Stop recording" : "Record conversation"}
          >
            <span className="record-dot" />
            {recording === "conversation" ? "Stop & interpret" : "Listen to table"}
          </button>
          <p>{shiftMode ? "Manual stop remains available. Audio is discarded after processing." : "Start shift mode to enable the microphone."}</p>
        </div>
      </section>

      <section className="workspace-grid">
        <div className="panel capture-panel">
          <div className="panel-heading">
            <div><p className="step">01 · CAPTURE</p><h2>Conversation</h2></div>
            <select value={engine} onChange={(event) => setEngine(event.target.value as typeof engine)} aria-label="Order engine">
              <option value="deterministic">Demo engine</option>
              <option value="openai">OpenAI engine</option>
            </select>
          </div>
          <label htmlFor="demo">Load test conversation</label>
          <select id="demo" onChange={(event) => setTranscript(DEMOS[event.target.value as keyof typeof DEMOS])} defaultValue="core">
            <option value="core">Core Table 12 demo</option>
            <option value="ambiguity">Ambiguous Leffe</option>
            <option value="unknown">Unknown truffle pasta</option>
            <option value="question">Question then order</option>
            <option value="course">Course exception</option>
            <option value="mixed">Mixed-language steak</option>
          </select>
          <textarea value={transcript} onChange={(event) => setTranscript(event.target.value)} rows={10} aria-label="Conversation transcript" />
          <button className="primary-button" disabled={busy || !menu || !online} onClick={() => void interpretTurns(parseTranscript(transcript), "text")}>
            {busy ? "Working…" : "Interpret order"}
          </button>
          {!online && <p className="offline-help">Cloud interpretation is unavailable. Your cached menu and draft remain below for manual fallback.</p>}
        </div>

        <div className="panel order-panel">
          <div className="panel-heading">
            <div><p className="step">02 · REVIEW</p><h2>{draft?.tableLabel ?? "Order draft"}</h2></div>
            <span className={`order-status status-${draft?.status.toLowerCase() ?? "empty"}`}>{draft?.status ?? "EMPTY"}</span>
          </div>

          {!draft && <div className="empty-state"><span>⌁</span><p>The validated order will build here.</p></div>}
          {draft && (
            <>
              {groupedLines.map((group) => (
                <div className="course-group" key={group.course}>
                  <h3>{COURSE_LABELS[group.course]}</h3>
                  {group.lines.map((line) => (
                    <div className="order-line" key={line.lineId}>
                      <strong>{line.quantity} × {line.canonicalName}</strong>
                      <span className="pos-name">POS · {line.posName} · {line.sku}</span>
                      {line.modifiers.map((modifier) => <span className="modifier" key={modifier.optionId}>+ {modifier.canonicalName}</span>)}
                      {line.notes.map((note) => <span className="line-note" key={note}>Note · {note}</span>)}
                    </div>
                  ))}
                </div>
              ))}

              {draft.warnings.map((warning) => <div className="warning-card" key={warning.id}><strong>Manual safety check</strong><p>{warning.message}</p></div>)}

              {draft.issues.length > 0 && <p className="step issue-step">03 · RESOLVE</p>}
              {draft.issues.map((issue) => (
                <div className="issue-card" key={issue.id}>
                  <strong>{issue.message}</strong>
                  {issue.type === "ambiguous_product" && (
                    <div className="candidate-grid">
                      {issue.productCandidates?.map((candidate) => {
                        const product = menu?.products.find((item) => item.id === candidate.productId);
                        return <button key={candidate.productId} disabled={!product || !menu} onClick={() => product && menu && setDraft(resolveWithProduct(draft, issue.id, product, menu))}>
                          <span>{candidate.canonicalName}</span><small>{candidate.posName} · {price(candidate.priceCents)}</small>
                        </button>;
                      })}
                    </div>
                  )}
                  {issue.type === "unresolved_product" && menu && <UnresolvedChoice draft={draft} issue={issue} menu={menu} onChange={setDraft} />}
                  {issue.type === "missing_modifier" && (
                    <div className="candidate-grid">
                      {issue.modifierOptions?.map((option) => <button key={option.id} onClick={() => setDraft(resolveModifier(draft, issue.id, issue.modifierGroupId!, option))}>
                        <span>{option.canonicalName}</span><small>{option.posName}{option.priceCents ? ` · +${price(option.priceCents)}` : ""}</small>
                      </button>)}
                    </div>
                  )}
                  {issue.type === "course_exception" && <button className="small-button" onClick={() => setDraft(resolveIssueWithoutData(draft, issue.id))}>Confirm unusual timing</button>}
                </div>
              ))}

              <div className="correction-box">
                <label htmlFor="correction">Correct this draft</label>
                <div className="correction-row">
                  <input id="correction" value={correction} onChange={(event) => setCorrection(event.target.value)} placeholder="e.g. Verander die cola naar cola zero" />
                  <button className="small-button" disabled={!correction.trim() || busy || !online} onClick={() => void applyCorrection(correction)}>Apply</button>
                  <button className={`voice-button ${recording === "correction" ? "recording" : ""}`} disabled={busy || !online} onClick={() => recording === "correction" ? stopRecording() : void startRecording("correction")} aria-label="Speak correction">{recording === "correction" ? "■" : "◉"}</button>
                </div>
              </div>
            </>
          )}

          {menu && draft && (
            <div className="manual-fallback">
              <label htmlFor="manual-product">Manual fallback from cached POS menu</label>
              <div className="resolution-row">
                <select id="manual-product" value={manualProductId} onChange={(event) => setManualProductId(event.target.value)}>
                  <option value="">Add valid product…</option>
                  {menu.products.filter((product) => product.active).map((product) => <option value={product.id} key={product.id}>{product.canonicalName}</option>)}
                </select>
                <button className="small-button" disabled={!manualProductId} onClick={() => {
                  const product = menu.products.find((item) => item.id === manualProductId);
                  if (product) setDraft(addManualProduct(draft, product, menu));
                  setManualProductId("");
                }}>Add</button>
              </div>
            </div>
          )}

          {draft && (
            <div className="send-bar">
              <div><span>{draft.lines.reduce((sum, line) => sum + line.quantity, 0)} items</span><small>{draft.interpretationLatencyMs} ms interpretation</small></div>
              <button className="send-button" disabled={busy || hasBlockers || !online || draft.status === "SENT"} onClick={() => void sendDraft()}>
                {draft.status === "SENT" ? "Draft in mock POS" : draft.status === "ERROR" ? "Retry now" : hasBlockers ? "Resolve before sending" : "Create POS draft"}
              </button>
            </div>
          )}
        </div>
      </section>

      {error && <div className="error-toast" role="alert"><strong>Action needed</strong><span>{error}</span><button onClick={() => setError(undefined)}>×</button></div>}

      <footer>
        <span>{menuResponse?.adapter ?? "Loading POS…"}</span>
        <strong>AI prepares · Waiter confirms · POS executes</strong>
        <span>Raw conversation not retained</span>
      </footer>
    </main>
  );
}
