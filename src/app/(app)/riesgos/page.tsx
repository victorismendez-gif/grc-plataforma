import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getProcesses } from "@/lib/lookups";
import { getMethodology, getRiskCatalogs } from "@/lib/risk-data";
import { inkFor, riskKpis, STRATEGIES } from "@/lib/risk";
import { label } from "@/lib/labels";
import Flash from "@/components/flash";
import HeatMap from "@/components/heat-map";
import RiskImport from "./risk-import";

export const metadata: Metadata = { title: "Riesgos" };

type SP = {
  error?: string; ok?: string; vista?: string; riesgo?: string; categoria?: string; proceso?: string;
  estado?: string; zona?: string; q?: string; p?: string; i?: string;
};

type EntryRow = {
  id: string; code: string; risk_code: string; risk_name: string; cause_code: string | null; cause: string | null; category: string | null;
  category_id: string | null; risk_id: string; process_id: string | null; threat_event: string | null;
  inherent_probability: number | null; inherent_impact: number | null; inherent_score: number | null; inherent_zone: string | null; inherent_color: string | null;
  residual_probability: number | null; residual_impact: number | null; residual_score: number | null; residual_zone: string | null; residual_color: string | null;
  out_of_tolerance: boolean; has_treatment: boolean; accepted_at: string | null; treatment_strategy: string | null; controls_count: number;
  materialized_count: number; owner_id: string | null; owner_text: string | null;
};

export default async function RisksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission("risks.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const [m, cats, processes, { data }] = await Promise.all([
    getMethodology(),
    getRiskCatalogs(),
    getProcesses(),
    supabase
      .from("risk_entries_view")
      .select("id, code, risk_code, risk_name, cause_code, cause, category, category_id, risk_id, process_id, threat_event, inherent_probability, inherent_impact, inherent_score, inherent_zone, inherent_color, residual_probability, residual_impact, residual_score, residual_zone, residual_color, out_of_tolerance, has_treatment, accepted_at, treatment_strategy, controls_count, materialized_count, owner_id, owner_text")
      .eq("active", true)
      .order("code")
      .limit(5000),
  ]);
  const all = (data ?? []) as EntryRow[];
  const vista = sp.vista === "inherente" ? "inherente" : "residual";
  const k = riskKpis(all);
  const processName = new Map(processes.map((p) => [p.id, p.label]));

  const q = (sp.q ?? "").trim().toLowerCase();
  const rows = all.filter((e) => {
    if (sp.riesgo && e.risk_id !== sp.riesgo) return false;
    if (sp.categoria && e.category_id !== sp.categoria) return false;
    if (sp.proceso && e.process_id !== sp.proceso) return false;
    if (sp.estado === "sin_valorar" && e.residual_score !== null) return false;
    if (sp.estado === "fuera" && !e.out_of_tolerance) return false;
    if (sp.estado === "sin_tratamiento" && !(e.out_of_tolerance && !e.has_treatment && !e.accepted_at)) return false;
    if (sp.zona && (vista === "inherente" ? e.inherent_zone : e.residual_zone) !== sp.zona) return false;
    if (sp.p && sp.i) {
      const [pp, ii] = vista === "inherente" ? [e.inherent_probability, e.inherent_impact] : [e.residual_probability, e.residual_impact];
      if (String(pp) !== sp.p || String(ii) !== sp.i) return false;
    }
    if (q && !`${e.code} ${e.risk_code} ${e.risk_name} ${e.cause_code ?? ""} ${e.cause ?? ""} ${e.threat_event ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const qs = (extra: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [key, v] of Object.entries({ ...sp, error: undefined, ok: undefined, ...extra })) if (v) p.set(key, v);
    return `/riesgos?${p.toString()}`;
  };

  return (
    <>
      <div className="head">
        <h1>Riesgos</h1>
        <p className="lead">
          Registro de riesgos con su causa, evento de amenaza y controles. La valoración inherente se hace con la
          metodología vigente (versión {m.version}); el riesgo residual lo calcula la plataforma con la efectividad de los
          controles. Por encima de la tolerancia ({m.tolerance}) el riesgo exige tratamiento o una aceptación aprobada.
        </p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="kpis">
        <div className="kpi"><b>{k.evaluados} / {k.total}</b><small>riesgos valorados</small></div>
        <div className="kpi"><b className={k.fueraTolerancia ? "txt-crit" : ""}>{k.pctFueraTolerancia} %</b><small>fuera de tolerancia ({k.fueraTolerancia})</small></div>
        <div className="kpi"><b>{k.pctConTratamiento === null ? "—" : `${k.pctConTratamiento} %`}</b><small>de los fuera de tolerancia con tratamiento</small></div>
        <div className="kpi"><b>{k.reduccion === null ? "—" : `${k.reduccion} %`}</b><small>reducción del riesgo por controles</small></div>
        <div className="kpi"><b>{k.materializados}</b><small>riesgos materializados</small></div>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Mapa de calor · riesgo {vista}</h2>
            <nav className="tabs" style={{ borderBottom: 0 }}>
              <a href={qs({ vista: undefined, p: undefined, i: undefined })} aria-current={vista === "residual" ? "page" : undefined}>Residual</a>
              <a href={qs({ vista: "inherente", p: undefined, i: undefined })} aria-current={vista === "inherente" ? "page" : undefined}>Inherente</a>
            </nav>
          </div>
          <HeatMap
            m={m}
            points={all.map((e) => vista === "inherente" ? { p: e.inherent_probability, i: e.inherent_impact } : { p: e.residual_probability, i: e.residual_impact })}
            hrefFor={(p, i) => qs({ p: String(p), i: String(i) }) + "#registro"}
          />
          <p className="small muted" style={{ marginTop: 6 }}>Filas: probabilidad · Columnas: impacto. Haz clic en un número para ver esos riesgos.</p>
        </section>
        <section className="panel stack">
          <h2>Acciones</h2>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            {ctx.can("risks.write") && <Link className="btn" href="/riesgos/nuevo">Registrar riesgo</Link>}
            <a className="btn ghost" href="/riesgos/exportar">Exportar a Excel</a>
            <Link className="btn ghost" href="/riesgos/metodologia">Metodología</Link>
            <Link className="btn ghost" href="/riesgos/catalogo">Catálogo de riesgos y causas</Link>
          </div>
          {ctx.can("risks.write") && <RiskImport />}
          <p className="small muted">
            Catálogo: {cats.risks.length} riesgos, {cats.causes.length} causas, {cats.categories.length} categorías.
          </p>
        </section>
      </div>

      <section className="panel" id="registro" style={{ marginTop: 16 }}>
        <h2>Registro</h2>
        <form className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 10 }}>
          {vista === "inherente" && <input type="hidden" name="vista" value="inherente" />}
          <label>Riesgo
            <select name="riesgo" defaultValue={sp.riesgo ?? ""}>
              <option value="">Todos</option>
              {cats.risks.map((r) => <option key={r.id} value={r.id}>{r.code}</option>)}
            </select>
          </label>
          <label>Tipo de riesgo
            <select name="categoria" defaultValue={sp.categoria ?? ""}>
              <option value="">Todos</option>
              {cats.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </label>
          {processes.length > 0 && (
            <label>Proceso
              <select name="proceso" defaultValue={sp.proceso ?? ""}>
                <option value="">Todos</option>
                {processes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </label>
          )}
          <label>Estado
            <select name="estado" defaultValue={sp.estado ?? ""}>
              <option value="">Todos</option>
              <option value="sin_valorar">Sin valorar</option>
              <option value="fuera">Fuera de tolerancia</option>
              <option value="sin_tratamiento">Fuera de tolerancia sin tratamiento</option>
            </select>
          </label>
          <label>Zona {vista}
            <select name="zona" defaultValue={sp.zona ?? ""}>
              <option value="">Todas</option>
              {m.zones.map((z) => <option key={z.name} value={z.name}>{z.name}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 180 }}>Buscar<input name="q" defaultValue={sp.q ?? ""} placeholder="Código, causa, evento…" /></label>
          <button type="submit" className="ghost">Filtrar</button>
          {(sp.riesgo || sp.categoria || sp.proceso || sp.estado || sp.zona || sp.q || sp.p) && <Link className="small" href="/riesgos#registro">Quitar filtros</Link>}
        </form>
        <p className="small muted">{rows.length} de {all.length} riesgos{sp.p && sp.i ? ` · celda probabilidad ${sp.p} × impacto ${sp.i}` : ""}.</p>
        <div className="tablewrap">
          <table>
            <thead>
              <tr><th>ID</th><th>Riesgo</th><th>Causa</th><th>Tipo</th><th>Proceso</th><th>Controles</th><th>Inherente</th><th>Residual</th><th>Tratamiento</th></tr>
            </thead>
            <tbody>
              {rows.slice(0, 1000).map((e) => (
                <tr key={e.id}>
                  <td className="mono"><Link href={`/riesgos/${e.id}`}>{e.code}</Link></td>
                  <td className="small"><b>{e.risk_code}</b> {e.risk_name.length > 70 ? `${e.risk_name.slice(0, 70)}…` : e.risk_name}</td>
                  <td className="small">{e.cause_code ? <b>{e.cause_code} </b> : null}{e.cause ?? "—"}</td>
                  <td className="small">{e.category ?? "—"}</td>
                  <td className="small">{e.process_id ? processName.get(e.process_id) : "—"}</td>
                  <td className="small">{e.controls_count}</td>
                  <td><Zone name={e.inherent_zone} color={e.inherent_color} score={e.inherent_score} /></td>
                  <td><Zone name={e.residual_zone} color={e.residual_color} score={e.residual_score} /></td>
                  <td className="small">
                    {e.accepted_at ? <span className="tag good">Aceptado</span>
                      : e.out_of_tolerance ? (e.has_treatment ? <span className="tag warn">En tratamiento</span> : <span className="tag crit">Requiere tratamiento</span>)
                      : e.treatment_strategy ? label(STRATEGIES, e.treatment_strategy) : "—"}
                  </td>
                </tr>
              ))}
              {!all.length && (
                <tr><td colSpan={9} className="small muted">No hay riesgos registrados. Carga tu archivo de causas y riesgos con «Cargar desde Excel» o registra uno.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > 1000 && <p className="small muted">Se muestran los primeros 1.000; usa los filtros o exporta a Excel.</p>}
      </section>
    </>
  );
}

function Zone({ name, color, score }: { name: string | null; color: string | null; score: number | null }) {
  if (!name || !color) return <span className="small muted">Sin valorar</span>;
  return <span className="zone" style={{ background: color, color: inkFor(color) }}>{name} · {Number(score)}</span>;
}
