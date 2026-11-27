import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/lookups";
import { ASSET_CRITICALITY, label, level5Tone, PROCESS_TYPOLOGY } from "@/lib/labels";
import { normalize } from "@/lib/text";
import Flash from "@/components/flash";
import MasterImport from "./master-import";
import ProcessForm from "./process-form";

export const metadata: Metadata = { title: "Procesos" };

type SP = { error?: string; ok?: string; q?: string; tipologia?: string; area?: string; criticidad?: string; estado?: string };
type ProcessRow = {
  id: string; code: string | null; name: string; typology: keyof typeof PROCESS_TYPOLOGY; parent_id: string | null;
  criticality: number | null; lead_area: string | null; owner_id: string | null; owner_text: string | null; active: boolean;
  documents_count: number; causes_count: number; assets_count: number; children_count: number;
};

export default async function ProcessesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission("assets.read");
  const sp = await searchParams;
  const canWrite = ctx.can("assets.write");
  const supabase = await createClient();
  const [{ data }, people] = await Promise.all([
    supabase.from("process_overview")
      .select("id, code, name, typology, parent_id, criticality, lead_area, owner_id, owner_text, active, documents_count, causes_count, assets_count, children_count")
      .order("name").limit(10000),
    getPeople(),
  ]);
  const all = (data ?? []) as ProcessRow[];
  const person = new Map(people.map((p) => [p.id, p.label]));
  const areas = [...new Set(all.map((p) => p.lead_area).filter((a): a is string => Boolean(a)))].sort((a, b) => a.localeCompare(b, "es"));

  const estado = sp.estado ?? "activos";
  const term = normalize(sp.q);
  const filtered = Boolean(term || sp.tipologia || sp.area || sp.criticidad);
  const visible = all.filter((p) => {
    if (estado === "activos" && !p.active) return false;
    if (estado === "inactivos" && p.active) return false;
    if (term && !normalize(`${p.code ?? ""} ${p.name}`).includes(term)) return false;
    if (sp.tipologia && p.typology !== sp.tipologia) return false;
    if (sp.area && p.lead_area !== sp.area) return false;
    if (sp.criticidad === "sin" ? p.criticality !== null : sp.criticidad && String(p.criticality) !== sp.criticidad) return false;
    return true;
  });

  // Árbol macroproceso › proceso › subproceso (sin filtros) o lista plana (con filtros)
  const byParent = new Map<string | null, ProcessRow[]>();
  const ids = new Set(visible.map((p) => p.id));
  for (const p of visible) {
    const key = p.parent_id && ids.has(p.parent_id) ? p.parent_id : null;
    byParent.set(key, [...(byParent.get(key) ?? []), p]);
  }
  const order = (a: ProcessRow, b: ProcessRow) => (a.code ?? a.name).localeCompare(b.code ?? b.name, "es");
  const rows: { p: ProcessRow; depth: number }[] = [];
  if (filtered) {
    rows.push(...[...visible].sort(order).map((p) => ({ p, depth: 0 })));
  } else {
    const walk = (parent: string | null, depth: number) => {
      for (const p of (byParent.get(parent) ?? []).sort(order)) {
        rows.push({ p, depth });
        if (depth < 6) walk(p.id, depth + 1);
      }
    };
    walk(null, 0);
  }

  const count = (t: string) => all.filter((p) => p.active && p.typology === t).length;
  const sinCriticidad = all.filter((p) => p.active && p.criticality === null).length;

  return (
    <>
      <div className="head">
        <h1>Procesos</h1>
        <p className="lead">
          Mapa de procesos: macroprocesos, procesos y subprocesos, con sus documentos, causas de riesgo y activos.
          Cada documento queda en el proceso de su documento padre.
        </p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="kpis">
        <div className="kpi"><b>{count("macroproceso")}</b><small>macroprocesos</small></div>
        <div className="kpi"><b>{count("proceso")}</b><small>procesos</small></div>
        <div className="kpi"><b>{count("subproceso")}</b><small>subprocesos</small></div>
        <div className={`kpi ${sinCriticidad ? "warn" : ""}`}><b>{sinCriticidad}</b><small>sin criticidad</small></div>
      </div>

      <section className="panel">
        <form method="get" className="row">
          <label style={{ flex: 1, minWidth: 200 }}>Buscar<input name="q" defaultValue={sp.q ?? ""} placeholder="Código o nombre" /></label>
          <label>Tipología
            <select name="tipologia" defaultValue={sp.tipologia ?? ""}>
              <option value="">Todas</option>
              {Object.entries(PROCESS_TYPOLOGY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>Área líder
            <select name="area" defaultValue={sp.area ?? ""} style={{ maxWidth: 260 }}>
              <option value="">Todas</option>
              {areas.map((a) => <option key={a} value={a}>{a}</option>)}
            </select>
          </label>
          <label>Criticidad
            <select name="criticidad" defaultValue={sp.criticidad ?? ""}>
              <option value="">Todas</option>
              {Object.entries(ASSET_CRITICALITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
              <option value="sin">Sin calificar</option>
            </select>
          </label>
          <label>Estado
            <select name="estado" defaultValue={estado}>
              <option value="activos">Activos</option>
              <option value="inactivos">Inactivos</option>
              <option value="todos">Todos</option>
            </select>
          </label>
          <button type="submit">Filtrar</button>
          {filtered && <Link href="/procesos" className="small">Quitar filtros</Link>}
        </form>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Proceso</th><th>Tipología</th><th>Área líder</th><th>Criticidad</th><th>Responsable</th><th>Docs.</th><th>Causas</th><th>Activos</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 1500).map(({ p, depth }) => (
                <tr key={p.id}>
                  <td style={{ paddingLeft: 10 + depth * 22 }}>
                    {depth > 0 && <span className="muted">└ </span>}
                    <Link href={`/procesos/${p.id}`}>{p.name}</Link>{" "}
                    {p.code && <span className="mono muted small">{p.code}</span>}
                    {!p.active && <span className="tag crit">Inactivo</span>}
                  </td>
                  <td className="small">{label(PROCESS_TYPOLOGY, p.typology)}</td>
                  <td className="small">{p.lead_area ?? "—"}</td>
                  <td>{p.criticality ? <span className={`tag ${level5Tone(p.criticality)}`}>{label(ASSET_CRITICALITY, p.criticality)}</span> : <span className="small muted">—</span>}</td>
                  <td className="small">{(p.owner_id ? person.get(p.owner_id) : p.owner_text) || "—"}</td>
                  <td>{p.documents_count || "—"}</td>
                  <td>{p.causes_count || "—"}</td>
                  <td>{p.assets_count || "—"}</td>
                </tr>
              ))}
              {rows.length === 0 && <tr><td colSpan={8} className="muted">{all.length ? "Ningún proceso coincide con los filtros." : "Aún no hay procesos. Carga el listado maestro o crea el primero."}</td></tr>}
            </tbody>
          </table>
          {rows.length > 1500 && <p className="small muted">Se muestran 1.500 de {rows.length}. Usa los filtros para acotar.</p>}
        </div>
      </section>

      {canWrite && ctx.can("documents.write") && (
        <section className="panel">
          <h2>Listado maestro</h2>
          <MasterImport />
        </section>
      )}
      {canWrite && (
        <section className="panel">
          <details>
            <summary>Nuevo proceso</summary>
            <div style={{ marginTop: 10 }}><ProcessForm parents={all.filter((p) => p.active && p.typology !== "subproceso")} /></div>
          </details>
        </section>
      )}
    </>
  );
}
