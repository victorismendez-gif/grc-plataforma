import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getUnits } from "@/lib/lookups";
import { ASSET_STATUS, CRITICALITY, label, levelTone } from "@/lib/labels";
import Flash from "@/components/flash";

export const metadata: Metadata = { title: "Activos" };

const PAGE = 50;
type SP = Record<string, string | undefined>;

export default async function AssetsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission("assets.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const [types, classes, units] = await Promise.all([getCatalog("asset_type"), getCatalog("info_classification"), getUnits()]);
  const typeName = new Map(types.map((t) => [t.id, t.label]));
  const className = new Map(classes.map((c) => [c.id, c.label]));
  const unitName = new Map(units.map((u) => [u.id, u.label]));

  const page = Math.max(1, Number(sp.pagina) || 1);
  let q = supabase
    .from("assets")
    .select("id, code, name, asset_type_id, classification_id, unit_id, criticality, status, owner:profiles!assets_organization_id_owner_id_fkey(full_name)", { count: "exact" })
    .order("code");
  const isId = (v?: string) => !!v && /^[0-9a-f-]{36}$/.test(v);
  if (sp.q) {
    const term = sp.q.replace(/[%,()*]/g, " ").trim().slice(0, 60);
    if (term) q = q.or(`code.ilike.%${term}%,name.ilike.%${term}%,serial_number.ilike.%${term}%`);
  }
  if (isId(sp.tipo)) q = q.eq("asset_type_id", sp.tipo!);
  if (isId(sp.clasificacion)) q = q.eq("classification_id", sp.clasificacion!);
  if (isId(sp.unidad)) q = q.eq("unit_id", sp.unidad!);
  if (sp.estado && sp.estado in ASSET_STATUS) q = q.eq("status", sp.estado);
  if (["1", "2", "3"].includes(sp.criticidad ?? "")) q = q.eq("criticality", Number(sp.criticidad));
  const { data, count } = await q.range((page - 1) * PAGE, page * PAGE - 1);

  // Indicadores generales (sobre todo el inventario)
  const [{ count: total }, { count: alta }, { count: sinDueno }, { count: sinClase }] = await Promise.all([
    supabase.from("assets").select("id", { count: "exact", head: true }).neq("status", "dado_de_baja"),
    supabase.from("assets").select("id", { count: "exact", head: true }).eq("criticality", 3).neq("status", "dado_de_baja"),
    supabase.from("assets").select("id", { count: "exact", head: true }).is("owner_id", null).neq("status", "dado_de_baja"),
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
          <p className="lead">Inventario con dueño, ubicación, clasificación y valoración de confidencialidad, integridad y disponibilidad.</p>
        </div>
        {ctx.can("assets.write") && (
          <div className="row">
            <Link className="btn ghost" href="/activos/importar">Importar Excel</Link>
            <Link className="btn" href="/activos/nuevo">Nuevo activo</Link>
          </div>
        )}
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="kpis">
        <div className="kpi"><b>{total ?? 0}</b><small>activos vigentes</small></div>
        <div className={`kpi ${alta ? "bad" : ""}`}><b>{alta ?? 0}</b><small>de criticidad alta</small></div>
        <div className={`kpi ${sinDueno ? "bad" : "ok"}`}><b>{sinDueno ?? 0}</b><small>sin dueño asignado</small></div>
        <div className={`kpi ${sinClase ? "bad" : "ok"}`}><b>{sinClase ?? 0}</b><small>sin clasificación</small></div>
      </div>

      <section className="panel">
        <form className="row" method="get">
          <label style={{ flex: 1, minWidth: 200 }}>
            Buscar
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Código, nombre o serial" />
          </label>
          <Filter name="tipo" label="Tipo" value={sp.tipo} options={types.map((t) => [t.id, t.label])} />
          <Filter name="clasificacion" label="Clasificación" value={sp.clasificacion} options={classes.map((c) => [c.id, c.label])} />
          <Filter name="criticidad" label="Criticidad" value={sp.criticidad} options={Object.entries(CRITICALITY)} />
          <Filter name="unidad" label="Unidad" value={sp.unidad} options={units.map((u) => [u.id, u.label])} />
          <Filter name="estado" label="Estado" value={sp.estado} options={Object.entries(ASSET_STATUS)} />
          <button type="submit">Filtrar</button>
        </form>
      </section>

      <section className="panel">
        <h2>{count ?? 0} activos</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>Código</th><th>Nombre</th><th>Tipo</th><th>Clasificación</th><th>Criticidad</th><th>Unidad</th><th>Dueño</th><th>Estado</th></tr>
            </thead>
            <tbody>
              {(data ?? []).map((a) => (
                <tr key={a.id as string}>
                  <td className="mono"><Link href={`/activos/${a.id}`}>{a.code as string}</Link></td>
                  <td>{a.name as string}</td>
                  <td className="small">{typeName.get(a.asset_type_id as string) ?? "—"}</td>
                  <td className="small">{className.get(a.classification_id as string) ?? <span className="tag warn">Sin clasificar</span>}</td>
                  <td>{a.criticality ? <span className={`tag ${levelTone(a.criticality as number)}`}>{label(CRITICALITY, a.criticality)}</span> : "—"}</td>
                  <td className="small">{unitName.get(a.unit_id as string) ?? "—"}</td>
                  <td className="small">{(a.owner as unknown as { full_name: string } | null)?.full_name ?? "—"}</td>
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
