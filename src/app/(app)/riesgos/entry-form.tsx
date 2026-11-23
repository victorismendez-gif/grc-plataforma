import { getPeople, getProcesses } from "@/lib/lookups";
import { getAssetTypes } from "@/lib/asset-lookups";
import { getRiskCatalogs } from "@/lib/risk-data";
import { STRATEGIES, type Methodology } from "@/lib/risk";
import ComboField from "@/components/combo-field";

export type EntryValues = {
  id?: string; risk_id?: string; cause_id?: string | null; category_id?: string | null; threat_event?: string | null;
  consequence?: string | null; process_id?: string | null; asset_type_id?: string | null; owner_id?: string | null;
  owner_text?: string | null; treatment_strategy?: string | null; treatment_description?: string | null;
};

export default async function EntryForm({ entry, action, readOnly, withEvaluation, m }: {
  entry?: EntryValues; action: (fd: FormData) => Promise<void>; readOnly?: boolean; withEvaluation?: boolean; m?: Methodology;
}) {
  const [cats, people, processes, types] = await Promise.all([getRiskCatalogs(), getPeople(), getProcesses(), getAssetTypes()]);
  const ownerValue = entry?.owner_id ? people.find((p) => p.id === entry.owner_id)?.label ?? "" : entry?.owner_text ?? "";
  const processValue = entry?.process_id ? processes.find((p) => p.id === entry.process_id)?.label ?? "" : "";
  return (
    <form action={action} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        {entry?.id && <input type="hidden" name="id" value={entry.id} />}
        <div className="form-grid">
          <label className="span-2">
            Riesgo *
            <select name="risk_id" defaultValue={entry?.risk_id ?? ""} required>
              <option value="" disabled>Elige…</option>
              {cats.risks.map((r) => <option key={r.id} value={r.id}>{r.code} · {r.name.slice(0, 110)}</option>)}
            </select>
          </label>
          <label className="span-2">
            Causa
            <select name="cause_id" defaultValue={entry?.cause_id ?? ""}>
              <option value="">—</option>
              {cats.causes.map((c) => <option key={c.id} value={c.id}>{c.code} · {c.description.slice(0, 100)}{c.factor ? ` (${c.factor.name})` : ""}</option>)}
            </select>
          </label>
          <label>
            Tipo de riesgo
            <select name="category_id" defaultValue={entry?.category_id ?? ""}>
              <option value="">—</option>
              {cats.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          <ComboField name="process" label="Proceso" value={processValue} options={processes} placeholder="Elige o escribe un proceso" />
          <label>
            Tipo de activo afectado
            <select name="asset_type_id" defaultValue={entry?.asset_type_id ?? ""}>
              <option value="">—</option>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </label>
          <ComboField name="owner" label="Responsable del riesgo" value={ownerValue} options={people} placeholder="Elige o escribe un nombre" />
          <label className="span-all">Evento de amenaza<textarea name="threat_event" rows={2} maxLength={2000} defaultValue={entry?.threat_event ?? ""} /></label>
          <label className="span-all">Consecuencia<textarea name="consequence" rows={2} maxLength={2000} defaultValue={entry?.consequence ?? ""} placeholder="Qué pasa si el riesgo se materializa" /></label>
          <label>
            Estrategia de tratamiento
            <select name="treatment_strategy" defaultValue={entry?.treatment_strategy ?? ""}>
              <option value="">—</option>
              {Object.entries(STRATEGIES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label className="span-all">Descripción del tratamiento<textarea name="treatment_description" rows={3} maxLength={4000} defaultValue={entry?.treatment_description ?? ""} /></label>
          {withEvaluation && m && (
            <>
              <label>
                Probabilidad inherente
                <select name="probability" defaultValue="">
                  <option value="">Sin valorar</option>
                  {m.probability_levels.map((l) => <option key={l.level} value={l.level}>{l.level} · {l.name}</option>)}
                </select>
              </label>
              <label>
                Impacto inherente
                <select name="impact" defaultValue="">
                  <option value="">Sin valorar</option>
                  {m.impact_levels.map((l) => <option key={l.level} value={l.level}>{l.level} · {l.name}</option>)}
                </select>
              </label>
            </>
          )}
        </div>
      </fieldset>
      {!readOnly && <div><button type="submit">{entry?.id ? "Guardar datos" : "Registrar riesgo"}</button></div>}
    </form>
  );
}
