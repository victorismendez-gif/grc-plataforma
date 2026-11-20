import { getPeople } from "@/lib/lookups";
import { CONTROL_FIELDS, type ControlField } from "@/lib/control-fields";

export type ControlData = {
  id: string;
  code: string;
  name: string;
  description: string | null;
  owner_id: string | null;
  owner_text: string | null;
  control_type: string;
  nature: string;
  frequency: string;
  documentation: string | null;
  evidence: string | null;
  design_rating: number | null;
  application_rating: number | null;
  effectiveness_rating: number | null;
  implementation_status: string;
};

/** Formulario de control: ID, Control, Descripción, Responsable, Tipo, Clase, Periodicidad,
 *  Documentación, Evidencia, Diseño, Aplicación, Efectividad, Estado. */
export default async function ControlForm({
  control,
  action,
  readOnly,
}: {
  control?: ControlData;
  action: (fd: FormData) => Promise<void>;
  readOnly?: boolean;
}) {
  const people = await getPeople();
  const ownerValue = control?.owner_id ? people.find((p) => p.id === control.owner_id)?.label ?? "" : control?.owner_text ?? "";
  const def = (f: ControlField) => CONTROL_FIELDS.find((d) => d.field === f)!;
  const value = (f: ControlField): string => {
    const v = control?.[f as keyof ControlData];
    return v === null || v === undefined ? "" : String(v);
  };
  const select = (f: ControlField, empty?: string) => {
    const d = def(f);
    const defaults: Partial<Record<ControlField, string>> = {
      control_type: "preventivo",
      nature: "manual",
      frequency: "continuo",
      implementation_status: "planeado",
    };
    return (
      <label key={f} title={d.help}>
        {d.header}
        {d.required ? " *" : ""}
        <select name={f} defaultValue={value(f) || defaults[f] || ""}>
          {empty !== undefined && <option value="">{empty}</option>}
          {Object.entries(d.options!).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </label>
    );
  };

  return (
    <form action={action} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0, display: "flex", flexDirection: "column", gap: 16 }}>
        {control && <input type="hidden" name="id" value={control.id} />}
        <fieldset className="form-section">
          <legend>Identificación</legend>
          <div className="form-grid">
            <label title={def("code").help}>
              <span>ID * <span className="field-hint">(sin espacios)</span></span>
              <input name="code" defaultValue={control?.code ?? ""} required maxLength={30} pattern="[A-Za-z0-9._\-]{1,30}" placeholder="CTL-001" />
            </label>
            <label className="span-2">
              Control *
              <input name="name" defaultValue={control?.name ?? ""} required minLength={2} maxLength={200} />
            </label>
            <label title={def("owner").help}>
              Responsable
              <input name="owner" defaultValue={ownerValue} list="responsables" maxLength={120} placeholder="Usuario o nombre" />
              <datalist id="responsables">
                {people.map((p) => <option key={p.id} value={p.label}>{p.code}</option>)}
              </datalist>
            </label>
            <label className="span-all" title={def("description").help}>
              Descripción
              <textarea name="description" defaultValue={control?.description ?? ""} rows={3} maxLength={5000}
                placeholder="Qué se hace, quién, cómo, con qué frecuencia y qué pasa si se detecta una desviación." />
            </label>
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Características</legend>
          <div className="form-grid">
            {select("control_type")}
            {select("nature")}
            {select("frequency")}
            {select("documentation", "—")}
            {select("evidence", "—")}
          </div>
        </fieldset>

        <fieldset className="form-section">
          <legend>Calificación y estado</legend>
          <div className="form-grid">
            {select("design_rating", "Sin evaluar")}
            {select("application_rating", "Sin evaluar")}
            {select("effectiveness_rating", "Calcular")}
            {select("implementation_status")}
          </div>
          <p className="field-hint" style={{ marginTop: 8 }}>
            Si dejas la efectividad en «Calcular», se toma el menor valor entre diseño y aplicación.
          </p>
        </fieldset>

        {!readOnly && <div><button type="submit">{control ? "Guardar cambios" : "Crear control"}</button></div>}
      </fieldset>
    </form>
  );
}
