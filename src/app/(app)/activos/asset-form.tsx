import { getCatalog, getPeople, getProcesses, getUnits } from "@/lib/lookups";
import { ASSET_STATUS, LEVELS } from "@/lib/labels";
import { EnumField, SelectField, TextArea, TextField } from "@/components/fields";

export type AssetData = {
  id: string;
  code: string;
  name: string;
  asset_type_id: string;
  description: string | null;
  owner_id: string | null;
  custodian: string | null;
  unit_id: string | null;
  location: string | null;
  classification_id: string | null;
  confidentiality: number | null;
  integrity: number | null;
  availability: number | null;
  status: string;
  brand: string | null;
  model: string | null;
  serial_number: string | null;
  acquired_on: string | null;
};

export default async function AssetForm({
  asset,
  processIds = [],
  action,
  readOnly,
}: {
  asset?: AssetData;
  processIds?: string[];
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
}) {
  const [types, classes, units, people, processes] = await Promise.all([
    getCatalog("asset_type"),
    getCatalog("info_classification"),
    getUnits(),
    getPeople(),
    getProcesses(),
  ]);
  const selected = new Set(processIds);
  return (
    <form action={action} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {asset && <input type="hidden" name="id" value={asset.id} />}
        <div className="row">
          <TextField name="code" label="Código o placa" value={asset?.code} required maxLength={60} />
          <TextField name="name" label="Nombre" value={asset?.name} required wide maxLength={200} />
          <SelectField name="asset_type_id" label="Tipo" options={types} value={asset?.asset_type_id} required />
          <EnumField name="status" label="Estado" map={ASSET_STATUS} value={asset?.status ?? "activo"} />
        </div>
        <TextArea name="description" label="Descripción" value={asset?.description} rows={2} />
        <div className="row">
          <SelectField name="owner_id" label="Dueño" options={people} value={asset?.owner_id} />
          <TextField name="custodian" label="Custodio" value={asset?.custodian} />
          <SelectField name="unit_id" label="Unidad" options={units} value={asset?.unit_id} />
          <TextField name="location" label="Ubicación física" value={asset?.location} />
        </div>
        <div className="row">
          <SelectField name="classification_id" label="Clasificación de la información" options={classes} value={asset?.classification_id} />
          <EnumField name="confidentiality" label="Confidencialidad" map={LEVELS} value={asset?.confidentiality} empty="—" />
          <EnumField name="integrity" label="Integridad" map={LEVELS} value={asset?.integrity} empty="—" />
          <EnumField name="availability" label="Disponibilidad" map={LEVELS} value={asset?.availability} empty="—" />
        </div>
        <div className="row">
          <TextField name="brand" label="Marca" value={asset?.brand} />
          <TextField name="model" label="Modelo" value={asset?.model} />
          <TextField name="serial_number" label="Serial" value={asset?.serial_number} />
          <TextField name="acquired_on" label="Fecha de adquisición" type="date" value={asset?.acquired_on} />
        </div>
        {processes.length > 0 && (
          <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
            <legend className="small">Procesos que soporta</legend>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
              {processes.map((p) => (
                <label key={p.id} className="check">
                  <input type="checkbox" name="process_ids" value={p.id} defaultChecked={selected.has(p.id)} />
                  {p.label}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        {!readOnly && (
          <div>
            <button type="submit">{asset ? "Guardar cambios" : "Registrar activo"}</button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
