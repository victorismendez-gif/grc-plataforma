import { getCatalog, getPeople, getProcesses } from "@/lib/lookups";
import { DOC_TYPES } from "@/lib/labels";
import { EnumField, SelectField, TextArea, TextField } from "@/components/fields";
import ComboField from "@/components/combo-field";

export type DocData = {
  id: string;
  code: string;
  title: string;
  doc_type: string;
  description: string | null;
  process_id: string | null;
  owner_id: string | null;
  owner_text?: string | null;
  classification_id: string | null;
  review_months: number;
  requires_acknowledgment: boolean;
};

export default async function DocForm({
  doc,
  action,
  readOnly,
}: {
  doc?: DocData;
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
}) {
  const [people, processes, classes] = await Promise.all([getPeople(), getProcesses(), getCatalog("info_classification")]);
  const ownerValue = doc?.owner_id ? people.find((p) => p.id === doc.owner_id)?.label ?? "" : doc?.owner_text ?? "";
  const processValue = doc?.process_id ? processes.find((p) => p.id === doc.process_id)?.label ?? "" : "";
  return (
    <form action={action} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {doc && <input type="hidden" name="id" value={doc.id} />}
        <div className="row">
          {!doc && <TextField name="code" label="Código" required maxLength={40} placeholder="POL-SI-01" />}
          <TextField name="title" label="Título" value={doc?.title} required wide maxLength={250} />
          <EnumField name="doc_type" label="Tipo" map={DOC_TYPES} value={doc?.doc_type ?? "procedimiento"} />
        </div>
        <TextArea name="description" label="Objetivo o alcance" value={doc?.description} rows={2} />
        <div className="row">
          <ComboField name="process" label="Proceso" value={processValue} options={processes} placeholder="Elige o escribe un proceso"
            title="Si escribes un proceso nuevo, se crea en Estructura." />
          <ComboField name="owner" label="Responsable" value={ownerValue} options={people} placeholder="Elige o escribe un nombre" />
          <SelectField name="classification_id" label="Clasificación" options={classes} value={doc?.classification_id} />
          <TextField name="review_months" label="Revisar cada (meses)" type="number" value={doc?.review_months ?? 12} />
        </div>
        <label className="check">
          <input type="checkbox" name="requires_acknowledgment" defaultChecked={doc?.requires_acknowledgment ?? false} />
          Las personas deben leerla y aceptarla (políticas)
        </label>
        {!readOnly && <div><button type="submit">{doc ? "Guardar datos" : "Crear documento"}</button></div>}
      </fieldset>
    </form>
  );
}
