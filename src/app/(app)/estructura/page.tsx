import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, getUnits } from "@/lib/lookups";
import Link from "next/link";
import { label, UNIT_TYPES } from "@/lib/labels";
import ComboField from "@/components/combo-field";
import Flash, { type FlashParams } from "@/components/flash";
import { EnumField, SelectField, TextField } from "@/components/fields";
import { saveUnit, toggleUnit } from "./actions";

export const metadata: Metadata = { title: "Estructura" };

type Unit = { id: string; code: string | null; name: string; unit_type: string; parent_id: string | null; employees: number | null; manager_id: string | null; manager_text: string | null; active: boolean };

export default async function StructurePage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("assets.read");
  const canWrite = ctx.can("assets.write");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: units }, { data: processes }, tree, people] = await Promise.all([
    supabase.from("org_units").select("id, code, name, unit_type, parent_id, employees, manager_id, manager_text, active"),
    supabase.from("processes").select("id").eq("active", true).limit(10000),
    getUnits(),
    getPeople(),
  ]);
  const unitById = new Map(((units ?? []) as Unit[]).map((u) => [u.id, u]));
  const personById = new Map(people.map((p) => [p.id, p.label]));
  const totalEmployees = ((units ?? []) as Unit[]).filter((u) => u.unit_type !== "area" && !u.parent_id).reduce((s, u) => s + (u.employees ?? 0), 0);

  return (
    <>
      <div className="head">
        <h1>Estructura de la organización</h1>
        <p className="lead">
          Sedes, sucursales y áreas. Todo lo demás (activos, riesgos, auditorías) se asigna a una unidad real.
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
        <p className="small" style={{ margin: 0 }}>
          {(processes ?? []).length} proceso(s) registrados. El mapa de procesos (macroprocesos, procesos y subprocesos), con su
          criticidad, documentos y riesgos, está en <Link href="/procesos">Procesos</Link>.
        </p>
      </section>
    </>
  );
}

