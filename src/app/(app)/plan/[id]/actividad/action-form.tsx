import { getPeople, getProcesses, getUnits } from "@/lib/lookups";
import { ACTION_STATUS, PRIORITY } from "@/lib/labels";
import ComboField from "@/components/combo-field";
import { saveAction } from "../../actions";

export type ActionValues = {
  id?: string; title?: string; description?: string | null; owner_id?: string | null; owner_text?: string | null;
  unit_id?: string | null; process_id?: string | null; priority?: string; start_on?: string | null; due_on?: string | null;
  status?: string; progress?: number; closure_evidence?: string | null; completed_on?: string | null;
};

export default async function ActionForm({ planId, action, back, readOnly, focusClose }: {
  planId: string; action?: ActionValues; back?: string; readOnly?: boolean; focusClose?: boolean;
}) {
  const [people, units, processes] = await Promise.all([getPeople(), getUnits(), getProcesses()]);
  const ownerValue = action?.owner_id ? people.find((p) => p.id === action.owner_id)?.label ?? "" : action?.owner_text ?? "";
  const processValue = action?.process_id ? processes.find((p) => p.id === action.process_id)?.label ?? "" : "";
  return (
    <form action={saveAction} className="stack">
      <fieldset disabled={readOnly} style={{ border: 0, padding: 0, margin: 0 }}>
        <input type="hidden" name="plan_id" value={planId} />
        {action?.id && <input type="hidden" name="id" value={action.id} />}
        {back && <input type="hidden" name="back" value={back} />}
        <div className="form-grid">
          <label className="span-all">Actividad *<input name="title" defaultValue={action?.title ?? ""} required minLength={3} maxLength={300} /></label>
          <label className="span-all">Descripción<textarea name="description" rows={4} defaultValue={action?.description ?? ""} maxLength={4000} /></label>
          <ComboField name="owner" label="Responsable" value={ownerValue} options={people} placeholder="Elige o escribe un nombre" />
          <label>
            Sede o área
            <select name="unit_id" defaultValue={action?.unit_id ?? ""}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{"  ".repeat(u.depth)}{u.label}</option>)}
            </select>
          </label>
          <ComboField name="process" label="Proceso" value={processValue} options={processes} placeholder="Elige o escribe un proceso" />
          <label>
            Prioridad
            <select name="priority" defaultValue={action?.priority ?? "media"}>
              {Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Inicio<input type="date" name="start_on" defaultValue={action?.start_on ?? ""} /></label>
          <label>Fecha límite<input type="date" name="due_on" defaultValue={action?.due_on ?? ""} /></label>
          <label>
            Estado
            <select name="status" defaultValue={focusClose ? "terminada" : action?.status ?? "pendiente"}>
              {Object.entries(ACTION_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Avance (%)<input type="number" name="progress" min={0} max={100} step={5} defaultValue={action?.progress ?? 0} /></label>
          <label className="span-all">
            Evidencia de cierre {focusClose && <span className="txt-crit">*</span>}
            <textarea name="closure_evidence" rows={3} defaultValue={action?.closure_evidence ?? ""} maxLength={4000} autoFocus={focusClose}
              placeholder="Qué se entregó y dónde se puede verificar (obligatoria para terminar la actividad)" />
          </label>
          {action?.completed_on && <p className="small muted span-all">Terminada el {action.completed_on}.</p>}
        </div>
      </fieldset>
      {!readOnly && <div><button type="submit">{action?.id ? "Guardar actividad" : "Agregar actividad"}</button></div>}
    </form>
  );
}
