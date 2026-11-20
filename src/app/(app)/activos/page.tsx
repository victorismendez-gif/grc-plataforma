import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getProcesses } from "@/lib/lookups";
import { ASSET_CRITICALITY, ASSET_STATUS, label, level5Tone } from "@/lib/labels";
import Flash from "@/components/flash";

export const metadata: Metadata = { title: "Activos" };

const PAGE = 50;
type SP = Record<string, string | undefined>;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission("assets.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const [types, classes, processes] = await Promise.all([getCatalog("asset_type"), getCatalog("info_classification"), getProcesses()]);
  const processName = new Map(processes.map((p) => [p.id, p.label]));
  const typeName = new Map(types.map((t) => [t.id, t.label]));
  const className = new Map(classes.map((c) => [c.id, c.label]));

  const page = Math.max(1, Number(sp.pagina) || 1);
  let q = supabase
    .from("assets")
    .select("id, code, name, asset_type_id, classification_id, criticality, status, process_id, owner_text, owner:profiles!assets_organization_id_owner_id_fkey(full_name)", { count: "exact" })
    .order("code");
  const isId = (v?: string) => !!v && /^[0-9a-f-]{36}$/.test(v);
  if (sp.q) {
    const term = sp.q.replace(/[%,()*]/g, " ").trim().slice(0, 60);
    if (term) q = q.or(`code.ilike.%${term}%,name.ilike.%${term}%,serial_number.ilike.%${term}%`);
  }
  if (isId(sp.tipo)) q = q.eq("asset_type_id", sp.tipo!);
  if (isId(sp.proceso)) q = q.eq("process_id", sp.proceso!);
  if (isId(sp.clasificacion)) q = q.eq("classification_id", sp.clasificacion!);
  if (sp.estado && sp.estado in ASSET_STATUS) q = q.eq("status", sp.estado);
  if (["1", "2", "3", "4", "5"].includes(sp.criticidad ?? "")) q = q.eq("criticality", Number(sp.criticidad));
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);

  // Indicadores generales (sobre todo el inventario)
  const [{ count: total }, { count: alta }, { count: sinDueno }, { count: sinClase }] = await Promise.all([
    supabase.from("assets").select("id", { count: "exact", head: true }).neq("status", "dado_de_baja"),
    supabase.from("assets").select("id", { count: "exact", head: true }).gte("criticality", 4).neq("status", "dado_de_baja"),
    supabase.from("assets").select("id", { count: "exact", head: true }).is("owner_id", null).is("owner_text", null).neq("status", "dado_de_baja"),
    supabase.from("assets").select("id", { count: "exact", head: true }).is("classification_id", null).neq("status", "dado_de_baja"),
  ]);

  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const qs = (p: number) => {
    const u = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "pagina") as [string, string][]);
    u.set("pagina", String(p));
    return `?${u}`;
  };

  return (
    <>
      <div className="head" style={{ flexDirection: "row", justifyContent: "space-between", flexWrap: "wrap", gap: 12 }}>
        <div className="head">
          <h1>Activos de información</h1>
          <p className="lead">Inventario con responsable, clasificación y valoración de confidencialidad, integridad y disponibilidad (1 a 5).</p>
        </div>
        {ctx.can("assets.write") && (
          <div className="row">
            <a className="btn ghost" href="/activos/plantilla">Descargar plantilla</a>
            <a className="btn ghost" href="/activos/plantilla?datos=1">Exportar inventario</a>
            <Link className="btn ghost" href="/activos/importar">Cargar desde Excel</Link>
            <Link className="btn" href="/activos/nuevo">Nuevo activo</Link>
          </div>
        )}
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="kpis">
        <div className="kpi"><b>{total ?? 0}</b><small>activos vigentes</small></div>
        <div className={`kpi ${alta ? "bad" : ""}`}><b>{alta ?? 0}</b><small>de criticidad alta o muy alta</small></div>
        <div className={`kpi ${sinDueno ? "bad" : "ok"}`}><b>{sinDueno ?? 0}</b><small>sin responsable asignado</small></div>
        <div className={`kpi ${sinClase ? "bad" : "ok"}`}><b>{sinClase ?? 0}</b><small>sin clasificación</small></div>
      </div>

      <section className="panel">
        <form className="row" method="get">
          <label style={{ flex: 1, minWidth: 200 }}>
            Buscar
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Identificador, nombre o serial" />
          </label>
          <Filter name="tipo" label="Tipo" value={sp.tipo} options={types.map((t) => [t.id, t.label])} />
          <Filter name="proceso" label="Proceso" value={sp.proceso} options={processes.map((p) => [p.id, p.label])} />
          <Filter name="clasificacion" label="Clasificación" value={sp.clasificacion} options={classes.map((c) => [c.id, c.label])} />
          <Filter name="criticidad" label="Criticidad" value={sp.criticidad} options={Object.entries(ASSET_CRITICALITY)} />
          <Filter name="estado" label="Estado" value={sp.estado} options={Object.entries(ASSET_STATUS)} />
          <button type="submit">Filtrar</button>
        </form>
      </section>

      <section className="panel">
        <h2>{count ?? 0} activos</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Identificador</th><th>Nombre del activo</th><th>Tipo</th><th>Proceso</th><th>Clasificación</th><th>Criticidad</th><th>Responsable</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {(data ?? []).map((a) => (
                <tr key={a.id as string}>
                  <td className="mono"><Link href={`/activos/${a.id}`}>{a.code as string}</Link></td>
                  <td>{a.name as string}</td>
                  <td className="small">{typeName.get(a.asset_type_id as string) ?? "—"}</td>
                  <td className="small">{processName.get(a.process_id as string) ?? "—"}</td>
                  <td className="small">{className.get(a.classification_id as string) ?? <span className="tag warn">Sin clasificar</span>}</td>
                  <td>{a.criticality ? <span className={`tag ${level5Tone(a.criticality as number)}`}>{a.criticality as number} · {label(ASSET_CRITICALITY, a.criticality)}</span> : "—"}</td>
                  <td className="small">{(a.owner as unknown as { full_name: string } | null)?.full_name ?? (a.owner_text as string | null) ?? "—"}</td>
                  <td className="small">{label(ASSET_STATUS, a.status)}</td>
                </tr>
              ))}
              {(data ?? []).length === 0 && <tr><td colSpan={8} className="muted">No hay activos con esos filtros.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="row small">
          {page > 1 && <Link href={qs(page - 1)}>← Anterior</Link>}
          <span className="muted">Página {page} de {pages}</span>
          {page < pages && <Link href={qs(page + 1)}>Siguiente →</Link>}
        </div>
      </section>
    </>
  );
}

function Filter({ name, label: text, value, options }: { name: string; label: string; value?: string; options: [string, string][] }) {
  return (
    <label>
      {text}
      <select name={name} defaultValue={value ?? ""}>
        <option value="">Todos</option>
        {options.map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
}
