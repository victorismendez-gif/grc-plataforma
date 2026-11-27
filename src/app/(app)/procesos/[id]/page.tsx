import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/lookups";
import { ASSET_CRITICALITY, DOC_TYPES, label, level5Tone, PROCESS_TYPES, PROCESS_TYPOLOGY } from "@/lib/labels";
import Flash from "@/components/flash";
import Zone from "@/components/zone-tag";
import ProcessForm, { type ProcessValues } from "../process-form";
import { toggleProcess } from "../actions";

export const metadata: Metadata = { title: "Proceso" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };
type Doc = { id: string; code: string; title: string; doc_type: string; parent_id: string | null; version_label: string | null; active: boolean };
type Entry = {
  id: string; code: string; active: boolean; inherent_score: number | null; inherent_zone: string | null; inherent_color: string | null;
  residual_score: number | null; residual_zone: string | null; residual_color: string | null; risk: { code: string; name: string } | null;
};
type Cause = { id: string; code: string; description: string; risk_entries: Entry[] };

export default async function ProcessPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("assets.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: p } = await supabase.from("processes").select("*, process_units(unit_id)").eq("id", id).maybeSingle();
  if (!p) notFound();
  const canWrite = ctx.can("assets.write");

  const [{ data: all }, people, docsRes, causesRes, { data: assets, count: assetsCount }] = await Promise.all([
    supabase.from("processes").select("id, code, name, typology, parent_id, active").order("name").limit(10000),
    getPeople(),
    ctx.can("documents.read")
      ? supabase.from("documents").select("id, code, title, doc_type, parent_id, version_label, active").eq("process_id", id).order("code").limit(5000)
      : Promise.resolve({ data: null }),
    ctx.can("risks.read")
      ? supabase.from("risk_cause_processes")
          .select("cause:risk_causes(id, code, description, risk_entries(id, code, active, inherent_score, inherent_zone, inherent_color, residual_score, residual_zone, residual_color, risk:risks(code, name)))")
          .eq("process_id", id).limit(2000)
      : Promise.resolve({ data: null }),
    supabase.from("assets").select("id, code, name", { count: "exact" }).eq("process_id", id).order("code").limit(20),
  ]);
  const procs = (all ?? []) as { id: string; code: string | null; name: string; typology: string; parent_id: string | null; active: boolean }[];
  const byId = new Map(procs.map((x) => [x.id, x]));

  // Cadena de padres (macroproceso › proceso)
  const chain: typeof procs = [];
  for (let cur = p.parent_id as string | null, i = 0; cur && i < 8; i++) {
    const x = byId.get(cur);
    if (!x) break;
    chain.unshift(x);
    cur = x.parent_id;
  }
  const children = procs.filter((x) => x.parent_id === id).sort((a, b) => (a.code ?? a.name).localeCompare(b.code ?? b.name, "es"));

  // Documentos en árbol: documento › anexos, formatos, diagramas…
  const docs = (docsRes.data ?? []) as Doc[];
  const docIds = new Set(docs.map((d) => d.id));
  const docKids = new Map<string | null, Doc[]>();
  for (const d of docs) {
    const k = d.parent_id && docIds.has(d.parent_id) ? d.parent_id : null;
    docKids.set(k, [...(docKids.get(k) ?? []), d]);
  }
  const docRows: { d: Doc; depth: number }[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const d of docKids.get(parent) ?? []) {
      docRows.push({ d, depth });
      if (depth < 6) walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  const docTypes = [...new Set(docs.map((d) => d.doc_type))].map((t) => `${docs.filter((d) => d.doc_type === t).length} ${label(DOC_TYPES, t).toLowerCase()}`);

  const causes = ((causesRes.data ?? []) as unknown as { cause: Cause | null }[])
    .map((c) => c.cause).filter((c): c is Cause => Boolean(c))
    .sort((a, b) => a.code.localeCompare(b.code, "es", { numeric: true }));
  const entries = causes.flatMap((c) => c.risk_entries.filter((e) => e.active).map((e) => ({ ...e, cause: c })));

  const owner = p.owner_id ? people.find((x) => x.id === p.owner_id)?.label : p.owner_text;
  return (
    <>
      <div className="head">
        <Link href="/procesos" className="small">← Procesos</Link>
        {chain.length > 0 && (
          <p className="small muted" style={{ margin: "4px 0 0" }}>
            {chain.map((c, i) => <span key={c.id}>{i > 0 && " › "}<Link href={`/procesos/${c.id}`}>{c.name}</Link></span>)}
          </p>
        )}
        <h1>{p.code && <span className="mono">{p.code} · </span>}{p.name}</h1>
        <p className="lead">
          {label(PROCESS_TYPOLOGY, p.typology)}
          {p.process_type && <> · {label(PROCESS_TYPES, p.process_type)}</>}
          {p.lead_area && <> · {p.lead_area}</>}
          {owner && <> · Responsable: {owner}</>}
          {p.version && <> · versión {p.version}</>}
          {p.criticality && <> · <span className={`tag ${level5Tone(p.criticality)}`}>Criticidad {label(ASSET_CRITICALITY, p.criticality).toLowerCase()}</span></>}
          {!p.active && <> · <span className="tag crit">Inactivo</span></>}
        </p>
      </div>
      <Flash {...sp} />
      <div className="kpis">
        <div className="kpi"><b>{children.length}</b><small>{p.typology === "macroproceso" ? "procesos" : "subprocesos"}</small></div>
        <div className="kpi"><b>{docs.length}</b><small>documentos</small></div>
        <div className="kpi"><b>{causes.length}</b><small>causas de riesgo</small></div>
        <div className="kpi"><b>{assetsCount ?? 0}</b><small>activos</small></div>
      </div>

      {children.length > 0 && (
        <section className="panel">
          <h2>{p.typology === "macroproceso" ? "Procesos" : "Subprocesos"}</h2>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {children.map((c) => (
              <li key={c.id}>
                <Link href={`/procesos/${c.id}`}>{c.name}</Link> {c.code && <span className="mono muted small">{c.code}</span>}
                {" "}<span className="small muted">({label(PROCESS_TYPOLOGY, c.typology).toLowerCase()})</span>
                {!c.active && <span className="tag crit">Inactivo</span>}
              </li>
            ))}
          </ul>
        </section>
      )}

      {docsRes.data && (
        <section className="panel">
          <h2>Documentos del proceso</h2>
          {docs.length ? (
            <>
              <p className="small muted" style={{ marginTop: 0 }}>{docTypes.join(" · ")}. Los anexos, formatos y diagramas aparecen bajo su documento padre.</p>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>Documento</th><th>Tipología</th><th>Versión</th></tr></thead>
                  <tbody>
                    {docRows.map(({ d, depth }) => (
                      <tr key={d.id}>
                        <td style={{ paddingLeft: 10 + depth * 22 }}>
                          {depth > 0 && <span className="muted">└ </span>}
                          <Link href={`/documentos/${d.id}`} className="mono small">{d.code}</Link> {d.title}
                          {!d.active && <span className="tag crit">Inactivo</span>}
                        </td>
                        <td className="small">{label(DOC_TYPES, d.doc_type)}</td>
                        <td className="small">{d.version_label ?? "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          ) : <p className="small muted">Ningún documento está asociado a este proceso.</p>}
        </section>
      )}

      {causesRes.data && (
        <section className="panel">
          <h2>Riesgos del proceso</h2>
          {entries.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>ID</th><th>Riesgo</th><th>Causa</th><th>Inherente</th><th>Residual</th></tr></thead>
                <tbody>
                  {entries.map((e) => (
                    <tr key={e.id}>
                      <td className="mono"><Link href={`/riesgos/${e.id}`}>{e.code}</Link></td>
                      <td className="small"><b>{e.risk?.code}</b> {e.risk && e.risk.name.length > 70 ? `${e.risk.name.slice(0, 70)}…` : e.risk?.name}</td>
                      <td className="small"><b>{e.cause.code}</b> {e.cause.description}</td>
                      <td><Zone name={e.inherent_zone} color={e.inherent_color} score={e.inherent_score} /></td>
                      <td><Zone name={e.residual_zone} color={e.residual_color} score={e.residual_score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">{causes.length} causa(s) relacionadas con el proceso; {entries.length} escenario(s) de riesgo. Los procesos de cada causa se editan en el catálogo de riesgos.</p>
            </div>
          ) : <p className="small muted">Ninguna causa de riesgo está relacionada con este proceso.</p>}
        </section>
      )}

      <section className="panel">
        <h2>Activos</h2>
        {(assets ?? []).length ? (
          <>
            <ul style={{ margin: 0, paddingLeft: 18 }}>
              {(assets ?? []).map((a) => <li key={a.id as string}><Link href={`/activos/${a.id}`}>{a.code as string}</Link> {a.name as string}</li>)}
            </ul>
            {(assetsCount ?? 0) > 20 && <p className="small"><Link href={`/activos?proceso=${id}`}>Ver los {assetsCount} activos →</Link></p>}
          </>
        ) : <p className="small muted">Ningún activo tiene este proceso.</p>}
      </section>

      {canWrite && (
        <section className="panel">
          <details>
            <summary>Editar el proceso</summary>
            <div style={{ marginTop: 10 }}>
              <ProcessForm
                process={p as ProcessValues}
                parents={procs.filter((x) => x.active && x.typology !== "subproceso")}
                selectedUnits={new Set(((p.process_units ?? []) as { unit_id: string }[]).map((u) => u.unit_id))}
              />
            </div>
          </details>
          <form action={toggleProcess} style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={p.id} />
            <input type="hidden" name="active" value={String(!p.active)} />
            <button type="submit" className={p.active ? "danger" : "ghost"}>{p.active ? "Desactivar el proceso" : "Activar el proceso"}</button>
          </form>
        </section>
      )}
    </>
  );
}
