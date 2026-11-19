import { getPeople, getProcesses } from "@/lib/lookups";
import { CONTROL_NATURE, CONTROL_TYPES, FREQUENCIES, IMPLEMENTATION, RATINGS } from "@/lib/labels";
import { EnumField, SelectField, TextArea, TextField } from "@/components/fields";

export type ControlData = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  control_type: string;
  nature: string;
  frequency: string;
  owner_id: string | null;
  process_id: string | null;
  implementation_status: string;
  design_rating: number | null;
  effectiveness_rating: number | null;
  last_evaluated_on: string | null;
  evidence_notes: string | null;
};

export default async function ControlForm({
  control,
  action,
  readOnly,
}: {
  control?: ControlData;
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
}) {
  const [people, processes] = await Promise.all([getPeople(), getProcesses()]);
  return (
    <form action={action} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 14 }}>
        {control && <input type="hidden" name="id" value={control.id} />}
        <div className="row">
          <TextField name="code" label="Código" value={control?.code} required maxLength={30} placeholder="CTL-001" />
          <TextField name="name" label="Nombre" value={control?.name} required wide maxLength={200} />
        </div>
        <TextArea name="description" label="Descripción (qué se hace, cómo y con qué evidencia)" value={control?.description} rows={3} />
        <div className="row">
          <EnumField name="control_type" label="Tipo" map={CONTROL_TYPES} value={control?.control_type ?? "preventivo"} />
          <EnumField name="nature" label="Naturaleza" map={CONTROL_NATURE} value={control?.nature ?? "manual"} />
          <EnumField name="frequency" label="Frecuencia" map={FREQUENCIES} value={control?.frequency ?? "continuo"} />
          <SelectField name="owner_id" label="Responsable" options={people} value={control?.owner_id} />
          <SelectField name="process_id" label="Proceso" options={processes} value={control?.process_id} />
        </div>
        <div className="row">
          <EnumField name="implementation_status" label="Implementación" map={IMPLEMENTATION} value={control?.implementation_status ?? "planeado"} />
          <EnumField name="design_rating" label="Calificación del diseño" map={RATINGS} value={control?.design_rating} empty="Sin evaluar" />
          <EnumField name="effectiveness_rating" label="Calificación de la eficacia" map={RATINGS} value={control?.effectiveness_rating} empty="Sin evaluar" />
          <TextField name="last_evaluated_on" label="Última evaluación" type="date" value={control?.last_evaluated_on} />
        </div>
        <TextArea name="evidence_notes" label="Evidencia de operación" value={control?.evidence_notes} rows={2} />
        {!readOnly && <div><button type="submit">{control ? "Guardar cambios" : "Crear control"}</button></div>}
      </fieldset>
    </form>
  );
}
