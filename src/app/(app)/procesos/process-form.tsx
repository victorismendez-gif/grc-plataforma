import { getPeople, getUnits } from "@/lib/lookups";
import { ASSET_CRITICALITY, PROCESS_TYPES, PROCESS_TYPOLOGY } from "@/lib/labels";
import { EnumField, TextArea, TextField } from "@/components/fields";
import ComboField from "@/components/combo-field";
import { saveProcess } from "./actions";

export type ProcessValues = {
  id: string; code: string | null; name: string; typology: string; parent_id: string | null; process_type: string | null;
  criticality: number | null; lead_area: string | null; version: string | null; valid_from: string | null;
  owner_id: string | null; owner_text: string | null; description: string | null;
};

type Parent = { id: string; code: string | null; name: string; typology: string };

export default async function ProcessForm({
  process,
  parents,
  selectedUnits,
}: {
  process?: ProcessValues;
  parents: Parent[];
  selectedUnits?: Set<string>;
}) {
  const [people, tree] = await Promise.all([getPeople(), getUnits()]);
  const ownerValue = process?.owner_id ? people.find((x) => x.id === process.owner_id)?.label ?? "" : process?.owner_text ?? "";
  const options = parents
    .filter((p) => p.id !== process?.id)
    .sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, "es"));
  return (
    <form action={saveProcess} className="stack">
      {process && <input type="hidden" name="id" value={process.id} />}
      <div className="row">
        <TextField name="name" label="Nombre" value={process?.name} required wide maxLength={160} />
        <TextField name="code" label="Código" value={process?.code} maxLength={60} placeholder="PROC-GSI-004" />
        <EnumField name="typology" label="Tipología" map={PROCESS_TYPOLOGY} value={process?.typology ?? "proceso"} />
      </div>
      <div className="row">
        <label style={{ flex: 1, minWidth: 260 }}>
          Proceso padre
          <select name="parent_id" defaultValue={process?.parent_id ?? ""}>
            <option value="">(ninguno)</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.name}</option>
            ))}
          </select>
        </label>
        <EnumField name="criticality" label="Criticidad" map={ASSET_CRITICALITY} value={process?.criticality} empty="Sin calificar" />
        <EnumField name="process_type" label="Clasificación en el mapa de procesos" map={PROCESS_TYPES} value={process?.process_type} empty="Sin clasificar" />
      </div>
      <div className="row">
        <ComboField name="owner" label="Responsable del proceso" options={people} value={ownerValue} placeholder="Elige o escribe un nombre" />
        <TextField name="lead_area" label="Área líder" value={process?.lead_area} maxLength={160} />
        <TextField name="version" label="Versión" value={process?.version} maxLength={20} />
        <TextField name="valid_from" label="Vigente desde" type="date" value={process?.valid_from} />
      </div>
      <TextArea name="description" label="Objetivo o descripción" value={process?.description} rows={2} />
      {tree.length > 0 && (
        <fieldset className="checks">
          <legend>Unidades donde opera</legend>
          <input type="hidden" name="units_present" value="1" />
          {tree.map((u) => (
            <label key={u.id} className="check" style={{ paddingLeft: u.depth * 18 }}>
              <input type="checkbox" name="unit_ids" value={u.id} defaultChecked={selectedUnits?.has(u.id)} />
              {u.label}
            </label>
          ))}
        </fieldset>
      )}
      <div><button type="submit">{process ? "Guardar" : "Crear proceso"}</button></div>
    </form>
  );
}
