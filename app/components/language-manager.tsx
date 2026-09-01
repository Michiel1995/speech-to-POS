"use client";

import { useRef, useState } from "react";

import type { TenantMenu } from "@/src/domain/schemas";
import {
  addApprovedMapping,
  approveMapping,
  exportLanguageLearning,
  parseLanguageLearning,
  removeMapping,
  type LanguageLearningState,
} from "@/src/learning/local-language-learning";

export function LanguageManager({ menu, state, onChange }: { menu?: TenantMenu; state: LanguageLearningState; onChange: (state: LanguageLearningState) => void }) {
  const [open, setOpen] = useState(false);
  const [fragment, setFragment] = useState("");
  const [productId, setProductId] = useState("");
  const importRef = useRef<HTMLInputElement>(null);

  const exportFile = () => {
    const url = URL.createObjectURL(new Blob([exportLanguageLearning(state)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `service-ears-taalregels-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return <>
    <button className="settings-button" onClick={() => setOpen(true)}>Taalbeheer</button>
    {open && <div className="settings-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}>
      <section className="settings-dialog language-dialog" role="dialog" aria-modal="true" aria-label="Taalbeheer">
        <div className="settings-title-row"><div><p className="eyebrow">LOKAAL EN CONTROLEERBAAR</p><h2>Taalbeheer</h2></div><button className="settings-close" onClick={() => setOpen(false)} aria-label="Sluiten">×</button></div>
        <p>Correcties worden alleen als korte taalregel bewaard. Gesprekken of audio worden niet opgeslagen. Een regel wordt na drie identieke, conflictvrije correcties automatisch actief; bij twijfel blijft goedkeuring nodig.</p>
        <div className="language-add-row">
          <input value={fragment} onChange={(event) => setFragment(event.target.value)} placeholder="Gehoorde variant, bv. leven blond" aria-label="Gehoorde variant" />
          <select value={productId} onChange={(event) => setProductId(event.target.value)} aria-label="Juiste product">
            <option value="">Kies juist product…</option>
            {menu?.products.filter((product) => product.active).map((product) => <option value={product.id} key={product.id}>{product.canonicalName}</option>)}
          </select>
          <button className="small-button" disabled={!fragment.trim() || !productId} onClick={() => { onChange(addApprovedMapping(state, fragment, productId)); setFragment(""); setProductId(""); }}>Toevoegen</button>
        </div>
        <div className="mapping-list">
          {!state.mappings.length && <p className="muted-copy">Nog geen lokale taalregels.</p>}
          {state.mappings.map((mapping) => <div className="mapping-row" key={mapping.id}>
            <div><strong>“{mapping.spokenFragment}”</strong><span>→ {menu?.products.find((product) => product.id === mapping.productId)?.canonicalName ?? mapping.productId} · {mapping.evidenceCount}× gehoord</span></div>
            <div>{mapping.status === "PENDING" && <button className="small-button" onClick={() => onChange(approveMapping(state, mapping.id))}>Goedkeuren</button>}<button className="danger-button compact" onClick={() => onChange(removeMapping(state, mapping.id))}>Verwijderen</button></div>
          </div>)}
        </div>
        <div className="settings-actions">
          <button className="danger-button" disabled={!state.mappings.length} onClick={() => onChange({ version: 2, mappings: [] })}>Alles wissen</button>
          <button className="small-button" onClick={() => importRef.current?.click()}>Importeren</button>
          <button className="small-button" disabled={!state.mappings.length} onClick={exportFile}>Exporteren</button>
          <button className="primary-button" onClick={() => setOpen(false)}>Klaar</button>
        </div>
        <input ref={importRef} hidden type="file" accept="application/json" onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) void file.text().then((text) => onChange(parseLanguageLearning(text)));
          event.target.value = "";
        }} />
      </section>
    </div>}
  </>;
}
