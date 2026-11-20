"use client";
import { useMemo, useState } from "react";
import {
  DIMENSIONS,
  fieldLabel,
  NAME_MAX,
  type OptionalField,
  type ScaleLevel,
} from "@/lib/asset-profiles";
import { ASSET_STATUS } from "@/lib/labels";
import type { AssetTypeOption } from "@/lib/asset-lookups";

type Option = { id: string; label: string };

export type AssetValues = {
  id?: string;
  code?: string | null;
  name?: string | null;
  asset_type_id?: string | null;
  description?: string | null;
  owner_id?: string | null;
  custodian?: string | null;
  custodian_email?: string | null;
  location?: string | null;
  classification_id?: string | null;
  confidentiality?: number | null;
  integrity?: number | null;
  availability?: number | null;
  status?: string | null;
  brand?: string | null;
  model?: string | null;
  serial_number?: string | null;
  operating_system?: string | null;
  ip_address?: string | null;
  acquired_on?: string | null;
};

type Props = {
  asset?: AssetValues;
  types: AssetTypeOption[];
  classes: Option[];
  people: Option[];
  processes: Option[];
  processIds: string[];
  scale: ScaleLevel[];
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
};

export default function AssetFormClient({ asset, types, classes, people, processes, processIds, scale, action, readOnly }: Props) {
  const [typeId, setTypeId] = useState(asset?.asset_type_id ?? "");
  const type = useMemo(() => types.find((t) => t.id === typeId), [types, typeId]);
  const selectedProcesses = new Set(processIds);

  return (
    <form action={action} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {asset?.id && <input type="hidden" name="id" value={asset.id} />}
        {!asset?.id && !readOnly && (
          <div className="callout">
            <span className="small">
              <b>¿Vas a registrar varios activos?</b> Descarga la plantilla, llénala en Excel y cárgala de una vez.
            </span>
            <span className="row">
              <a className="btn ghost" href="/activos/plantilla">Descargar plantilla</a>
              <a className="btn" href="/activos/importar">Cargar desde Excel</a>
            </span>
          </div>
        )}
        <div className="form-grid">
          <label>
            Tipo de activo *
            <select name="asset_type_id" value={typeId} onChange={(e) => setTypeId(e.target.value)} required>
              <option value="" disabled>Selecciona el tipo…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </select>
          </label>
        </div>

        {!type ? (
          <p className="small muted">Elige el tipo de activo para ver sus campos, o cárgalos desde Excel.</p>
        ) : (
          <>
            <fieldset className="form-section">
              <legend>Datos del activo</legend>
              <div className="form-grid">
              <label>
                {type.settings.identifier.label}
                {type.settings.identifier.required ? " *" : ""}
                <input
                  name="code"
                  defaultValue={asset?.code ?? ""}
                  required={type.settings.identifier.required}
                  maxLength={60}
                  inputMode={type.settings.identifier.kind === "imei" || type.settings.identifier.kind === "documento" ? "numeric" : undefined}
                  placeholder={type.settings.identifier.required ? "" : "Vacío = número automático"}
                />
              </label>
              {type.settings.fields.map((f) => (
                <Field key={f} field={f} label={fieldLabel(f, type.settings)} asset={asset} people={people} />
              ))}
              </div>
            </fieldset>

            <fieldset className="form-section">
              <legend>Clasificación y valoración</legend>
              <div className="form-grid">
                <label>
                  Clasificación de la información
                  <select name="classification_id" defaultValue={asset?.classification_id ?? ""}>
                    <option value="">Sin clasificar</option>
                    {classes.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                  </select>
                </label>
                {(Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).map((d) => (
                  <ScaleField key={d} dimension={d} levels={scale.filter((s) => s.dimension === d)} value={asset?.[d] ?? null} />
                ))}
              </div>
            </fieldset>

            {processes.length > 0 && (
              <fieldset className="form-section">
                <legend>Procesos que soporta</legend>
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
                  {processes.map((p) => (
                    <label key={p.id} className="check">
                      <input type="checkbox" name="process_ids" value={p.id} defaultChecked={selectedProcesses.has(p.id)} />
                      {p.label}
                    </label>
                  ))}
                </div>
              </fieldset>
            )}
            {!readOnly && (
              <div>
                <button type="submit">{asset?.id ? "Guardar cambios" : "Registrar activo"}</button>
              </div>
            )}
          </>
        )}
      </fieldset>
    </form>
  );
}

function Field({ field, label, asset, people }: { field: OptionalField; label: string; asset?: AssetValues; people: Option[] }) {
  switch (field) {
    case "name":
      return (
        <label>
          <span>{label} <span className="field-hint">(máx. {NAME_MAX})</span></span>
          <input name="name" defaultValue={asset?.name ?? ""} maxLength={NAME_MAX} />
        </label>
      );
    case "status":
      return (
        <label>
          {label}
          <select name="status" defaultValue={asset?.status ?? "activo"}>
            {Object.entries(ASSET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      );
    case "owner_id":
      return (
        <label>
          {label}
          <select name="owner_id" defaultValue={asset?.owner_id ?? ""}>
            <option value="">—</option>
            {people.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
          </select>
        </label>
      );
    case "description":
      return (
        <label className="span-all">
          {label}
          <textarea name="description" defaultValue={asset?.description ?? ""} rows={2} maxLength={2000} />
        </label>
      );
    case "acquired_on":
      return (
        <label>
          {label}
          <input type="date" name="acquired_on" defaultValue={asset?.acquired_on ?? ""} />
        </label>
      );
    case "custodian_email":
      return (
        <label>
          {label}
          <input type="email" name="custodian_email" defaultValue={asset?.custodian_email ?? ""} maxLength={200} placeholder="custodio@empresa.com" />
        </label>
      );
    case "ip_address":
      return (
        <label>
          {label}
          <input name="ip_address" defaultValue={asset?.ip_address ?? ""} placeholder="10.0.0.15" maxLength={45} />
        </label>
      );
    default:
      return (
        <label>
          {label}
          <input name={field} defaultValue={(asset?.[field] as string | null | undefined) ?? ""} maxLength={field === "custodian" || field === "location" ? 200 : 120} />
        </label>
      );
  }
}

function ScaleField({ dimension, levels, value }: { dimension: keyof typeof DIMENSIONS; levels: ScaleLevel[]; value: number | null }) {
  const [current, setCurrent] = useState<string>(value ? String(value) : "");
  const desc = levels.find((l) => String(l.level) === current)?.description;
  return (
    <label title={desc ?? undefined}>
      {DIMENSIONS[dimension]}
      <select name={dimension} value={current} onChange={(e) => setCurrent(e.target.value)}>
        <option value="">—</option>
        {levels.map((l) => (
          <option key={l.level} value={l.level} title={l.description ?? undefined}>
            {l.level} · {l.label}
          </option>
        ))}
      </select>
      <span className="field-hint" style={{ minHeight: 32 }}>{desc ?? "Elige un nivel de 1 a 5."}</span>
    </label>
  );
}
