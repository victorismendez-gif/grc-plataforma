import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CONTROL_NATURE, CONTROL_TYPES, FREQUENCIES, IMPLEMENTATION, label, RATINGS } from "@/lib/labels";
import Flash from "@/components/flash";
import { getProcesses } from "@/lib/lookups";

export const metadata: Metadata = { title: "Controles" };

type SP = { error?: string; ok?: string; estado?: string; q?: string; proceso?: string };

export default async function ControlsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission("controls.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const processes = await getProcesses();
  const processName = new Map(processes.map((p) => [p.id, p.label]));
  let q = supabase
    .from("controls")
    .select("id, code, name, control_type, nature, frequency, implementation_status, design_rating, application_rating, effectiveness_rating, owner_text, process_id, owner:profiles!controls_organization_id_owner_id_fkey(full_name), control_requirements(count), control_assets(count)")
    .order("code");
  if (sp.proceso && /^[0-9a-f-]{36}$/.test(sp.proceso)) q = q.eq("process_id", sp.proceso);
  if (sp.estado && sp.estado in IMPLEMENTATION) q = q.eq("implementation_status", sp.estado);
  if (sp.q) {
    const term = sp.q.replace(/[%,()*]/g, " ").trim().slice(0, 60);
    if (term) q = q.or(`code.ilike.%${term}%,name.ilike.%${term}%`);
  }
  const { data } = await q;
  const rows = data ?? [];
  const implemented = rows.filter((c) => c.implementation_status === "implementado").length;
  const effective = rows.filter((c) => c.effectiveness_rating === 3).length;
  const evaluated = rows.filter((c) => c.effectiveness_rating !== null).length;

  return (
    <>
      <div className="head" style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div className="head">
        <h1>Controles</h1>
        <p className="lead">
          Medidas que la organización aplica. Un mismo control puede cumplir requisitos de varias normas y proteger varios
          activos; su calificación de diseño, aplicación y efectividad alimenta la valoración del riesgo residual.
        </p>
        </div>
        <div className="row">
          <a className="btn ghost" href="/controles/plantilla">Descargar plantilla</a>
          <a className="btn ghost" href="/controles/plantilla?datos=1">Exportar controles</a>
          {ctx.can("controls.write") && <Link className="btn ghost" href="/controles/importar">Cargar desde Excel</Link>}
          {ctx.can("controls.write") && <Link className="btn" href="/controles/nuevo">Nuevo control</Link>}
        </div>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="kpis">
        <div className="kpi"><b>{rows.length}</b><small>controles</small></div>
        <div className="kpi"><b>{rows.length ? Math.round((implemented / rows.length) * 100) : 0}%</b><small>implementados</small></div>
        <div className="kpi"><b>{evaluated ? Math.round((effective / evaluated) * 100) : 0}%</b><small>con efectividad fuerte (de los evaluados)</small></div>
      </div>
      <section className="panel">
        <form method="get" className="row">
          <label style={{ flex: 1 }}>Buscar<input name="q" defaultValue={sp.q ?? ""} placeholder="ID o nombre" /></label>
          <label>
            Proceso
            <select name="proceso" defaultValue={sp.proceso ?? ""}>
              <option value="">Todos</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
            </select>
          </label>
          <label>
            Estado
            <select name="estado" defaultValue={sp.estado ?? ""}>
              <option value="">Todas</option>
              {Object.entries(IMPLEMENTATION).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <button type="submit">Filtrar</button>
        </form>
        <div className="tablewrap">
          <table>
            <thead><tr><th>ID</th><th>Control</th><th>Responsable</th><th>Proceso</th><th>Tipo</th><th>Clase</th><th>Periodicidad</th><th>Diseño</th><th>Aplicación</th><th>Efectividad</th><th>Estado</th><th>Requisitos</th><th>Activos</th></tr></thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id as string}>
                  <td className="mono"><Link href={`/controles/${c.id}`}>{c.code as string}</Link></td>
                  <td>{c.name as string}</td>
                  <td className="small">{(c.owner as unknown as { full_name: string } | null)?.full_name ?? (c.owner_text as string | null) ?? "—"}</td>
                  <td className="small">{processName.get(c.process_id as string) ?? "—"}</td>
                  <td className="small">{label(CONTROL_TYPES, c.control_type)}</td>
                  <td className="small">{label(CONTROL_NATURE, c.nature)}</td>
                  <td className="small">{label(FREQUENCIES, c.frequency)}</td>
                  <td className="small">{label(RATINGS, c.design_rating)}</td>
                  <td className="small">{label(RATINGS, c.application_rating)}</td>
                  <td className="small">{label(RATINGS, c.effectiveness_rating)}</td>
                  <td><span className={`tag ${c.implementation_status === "implementado" ? "good" : "warn"}`}>{label(IMPLEMENTATION, c.implementation_status)}</span></td>
                  <td>{(c.control_requirements as unknown as { count: number }[])[0]?.count ?? 0}</td>
                  <td>{(c.control_assets as unknown as { count: number }[])[0]?.count ?? 0}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={13} className="muted">Aún no hay controles. Créalos uno a uno o cárgalos desde Excel con la plantilla.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
