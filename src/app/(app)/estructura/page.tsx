import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, getUnits } from "@/lib/lookups";
import { label, PROCESS_TYPES, UNIT_TYPES } from "@/lib/labels";
import ComboField from "@/components/combo-field";
import Flash, { type FlashParams } from "@/components/flash";
import { EnumField, SelectField, TextArea, TextField } from "@/components/fields";
import { saveProcess, saveUnit, toggleUnit } from "./actions";

export const metadata: Metadata = { title: "Estructura" };

type Unit = { id: string; code: string | null; name: string; unit_type: string; parent_id: string | null; employees: number | null; manager_id: string | null; manager_text: string | null; active: boolean };
type Process = { id: string; code: string | null; name: string; process_type: string; owner_id: string | null; owner_text: string | null; description: string | null; active: boolean; process_units: { unit_id: string }[] };

export default async function StructurePage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("assets.read");
  const canWrite = ctx.can("assets.write");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: units }, { data: processes }, tree, people] = await Promise.all([
    supabase.from("org_units").select("id, code, name, unit_type, parent_id, employees, manager_id, manager_text, active"),
    supabase.from("processes").select("id, code, name, process_type, owner_id, owner_text, description, active, process_units(unit_id)").order("name"),
    getUnits(),
    getPeople(),
  ]);
  const unitById = new Map(((units ?? []) as Unit[]).map((u) => [u.id, u]));
  const personById = new Map(people.map((p) => [p.id, p.label]));
  const unitName = new Map(tree.map((u) => [u.id, u.label]));
  const totalEmployees = ((units ?? []) as Unit[]).filter((u) => u.unit_type !== "area" && !u.parent_id).reduce((s, u) => s + (u.employees ?? 0), 0);

  return (
    <>
      <div className="head">
        <h1>Estructura de la organización</h1>
        <p className="lead">
          Sedes, sucursales, áreas y procesos. Todo lo demás (activos, riesgos, auditorías) se asigna a una unidad real.
        </p>
      </div>
      <Flash {...sp} />
      <div className="kpis">
        <div className="kpi"><b>{tree.length}</b><small>unidades</small></div>
        <div className="kpi"><b>{(processes ?? []).length}</b><small>procesos</small></div>
        <div className="kpi"><b>{totalEmployees.toLocaleString("es-CO")}</b><small>empleados en sedes principales</small></div>
      </div>

      <section className="panel">
        <h2>Unidades</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Unidad</th><th>Tipo</th><th>Código</th><th>Empleados</th><th>Responsable</th><th>Estado</th>{canWrite && <th></th>}</tr>
            </thead>
            <tbody>
              {tree.map((t) => {
                const u = unitById.get(t.id)!;
                return (
                  <tr key={u.id}>
                    <td style={{ paddingLeft: 10 + t.depth * 22 }}>{t.depth > 0 && <span className="muted">└ </span>}{u.name}</td>
                    <td>{label(UNIT_TYPES, u.unit_type)}</td>
                    <td className="mono">{u.code ?? "—"}</td>
                    <td>{u.employees ?? "—"}</td>
                    <td className="small">{(u.manager_id ? personById.get(u.manager_id) : u.manager_text) || "—"}</td>
                    <td><span className={`tag ${u.active ? "good" : "crit"}`}>{u.active ? "Activa" : "Inactiva"}</span></td>
                    {canWrite && (
                      <td>
                        <details>
                          <summary className="small">Editar</summary>
                          <form action={saveUnit} className="stack" style={{ marginTop: 8, minWidth: 280 }}>
                            <input type="hidden" name="id" value={u.id} />
                            <TextField name="name" label="Nombre" value={u.name} required />
                            <TextField name="code" label="Código" value={u.code} maxLength={30} />
                            <EnumField name="unit_type" label="Tipo" map={UNIT_TYPES} value={u.unit_type} />
                            <SelectField name="parent_id" label="Depende de" options={tree.filter((x) => x.id !== u.id)} value={u.parent_id} empty="(ninguna)" />
                            <TextField name="employees" label="Número de empleados" type="number" value={u.employees} />
                            <ComboField name="manager" label="Responsable" options={people} value={u.manager_id ? personById.get(u.manager_id) : u.manager_text} placeholder="Elige o escribe un nombre" />
                            <button type="submit">Guardar</button>
                          </form>
                          <form action={toggleUnit} style={{ marginTop: 6 }}>
                            <input type="hidden" name="id" value={u.id} />
                            <input type="hidden" name="active" value={String(!u.active)} />
                            <button type="submit" className={u.active ? "danger" : "ghost"}>{u.active ? "Desactivar" : "Activar"}</button>
                          </form>
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
              {tree.length === 0 && <tr><td colSpan={7} className="muted">Aún no hay unidades. Empieza por las sedes.</td></tr>}
            </tbody>
          </table>
        </div>
        {canWrite && (
          <details>
            <summary>Nueva unidad</summary>
            <form action={saveUnit} className="row" style={{ marginTop: 10 }}>
              <TextField name="name" label="Nombre" required />
              <TextField name="code" label="Código" maxLength={30} placeholder="BOG" />
              <EnumField name="unit_type" label="Tipo" map={UNIT_TYPES} value="sede" />
              <SelectField name="parent_id" label="Depende de" options={tree} empty="(ninguna)" />
              <TextField name="employees" label="Empleados" type="number" />
              <ComboField name="manager" label="Responsable" options={people} placeholder="Elige o escribe un nombre" />
              <button type="submit">Crear unidad</button>
            </form>
          </details>
        )}
      </section>

      <section className="panel">
        <h2>Procesos</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Proceso</th><th>Tipo</th><th>Dueño</th><th>Unidades</th>{canWrite && <th></th>}</tr>
            </thead>
            <tbody>
              {((processes ?? []) as Process[]).map((p) => {
                const selected = new Set(p.process_units.map((pu) => pu.unit_id));
                return (
                  <tr key={p.id}>
                    <td><b>{p.name}</b> {p.code && <span className="mono muted">{p.code}</span>}<div className="small muted">{p.description}</div></td>
                    <td>{label(PROCESS_TYPES, p.process_type)}</td>
                    <td className="small">{(p.owner_id ? personById.get(p.owner_id) : p.owner_text) || "—"}</td>
                    <td className="small">{[...selected].map((id) => unitName.get(id)).filter(Boolean).join(", ") || "—"}</td>
                    {canWrite && (
                      <td>
                        <details>
                          <summary className="small">Editar</summary>
                          <ProcessForm process={p} selected={selected} tree={tree} people={people} />
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
              {(processes ?? []).length === 0 && <tr><td colSpan={5} className="muted">Aún no hay procesos.</td></tr>}
            </tbody>
          </table>
        </div>
        {canWrite && (
          <details>
            <summary>Nuevo proceso</summary>
            <ProcessForm tree={tree} people={people} selected={new Set()} />
          </details>
        )}
      </section>
    </>
  );
}

function ProcessForm({
  process,
  selected,
  tree,
  people,
}: {
  process?: Process;
  selected: Set<string>;
  tree: Awaited<ReturnType<typeof getUnits>>;
  people: Awaited<ReturnType<typeof getPeople>>;
}) {
  return (
    <form action={saveProcess} className="stack" style={{ marginTop: 10, minWidth: 300 }}>
      {process && <input type="hidden" name="id" value={process.id} />}
      <div className="row">
        <TextField name="name" label="Nombre" value={process?.name} required wide />
        <TextField name="code" label="Código" value={process?.code} maxLength={30} />
        <EnumField name="process_type" label="Tipo" map={PROCESS_TYPES} value={process?.process_type ?? "apoyo"} />
        <ComboField name="owner" label="Responsable del proceso" options={people} value={process?.owner_id ? people.find((x) => x.id === process.owner_id)?.label : process?.owner_text} placeholder="Elige o escribe un nombre" />
      </div>
      <TextArea name="description" label="Descripción" value={process?.description} rows={2} />
      {tree.length > 0 && (
        <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
          <legend className="small">Unidades donde opera</legend>
          {tree.map((u) => (
            <label key={u.id} className="check" style={{ paddingLeft: u.depth * 18 }}>
              <input type="checkbox" name="unit_ids" value={u.id} defaultChecked={selected.has(u.id)} />
              {u.label}
            </label>
          ))}
        </fieldset>
      )}
      <button type="submit">{process ? "Guardar" : "Crear proceso"}</button>
    </form>
  );
}
