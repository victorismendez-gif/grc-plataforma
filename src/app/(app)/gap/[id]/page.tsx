import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/lookups";
import { compliance, groupBy, pctTone } from "@/lib/gap";
import { CRITICALITY, GAP_ASSESSMENT_STATUS, GAP_STATUS, gapTone, label, levelTone } from "@/lib/labels";
import Flash from "@/components/flash";
import ComboField from "@/components/combo-field";
import { generatePlan, rateItem, setGapStatus, syncGapItems, updateGap, validateItems } from "../actions";
import GapImport from "./gap-import";

export const metadata: Metadata = { title: "Diagnóstico GAP" };

type SP = { error?: string; ok?: string; norma?: string; estado?: string; q?: string; clausula?: string };
type Props = { params: Promise<{ id: string }>; searchParams: Promise<SP> };

type Item = {
  id: string; primary_item_id: string | null; status: string | null; justification: string | null; evidence_note: string | null;
  document_id: string | null; assessed_by: string | null; assessed_at: string | null; validated_by: string | null; validated_at: string | null;
  framework_id: string; clause: string; title: string; description: string | null; evidence_guidance: string | null;
  criticality: number; top_clause: string; top_title: string; has_action: boolean; gap_closed: boolean;
};

const FILTERS: Record<string, string> = { pendiente: "Sin calificar", ...GAP_STATUS, brecha: "Brechas (no cumple o parcial)", sin_validar: "Sin validar" };

export default async function GapPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("gap.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: gap } = await supabase
    .from("gap_assessments")
    .select("*, gap_assessment_frameworks(framework:frameworks(id, code, name, version, created_at)), gap_assessment_scope(unit:org_units(name), process:processes(name))")
    .eq("id", id)
    .maybeSingle();
  if (!gap) notFound();

  const [{ data: rawItems }, people, { data: docs }, { data: plan }] = await Promise.all([
    supabase
      .from("gap_items_effective")
      .select("id, primary_item_id, status, justification, evidence_note, document_id, assessed_by, assessed_at, validated_by, validated_at, framework_id, clause, title, description, evidence_guidance, criticality, top_clause, top_title, has_action, gap_closed, sort_key")
      .eq("assessment_id", id)
      .order("sort_key")
      .limit(5000),
    getPeople(),
    ctx.can("documents.read") ? supabase.from("documents").select("id, code, title").eq("active", true).order("code") : Promise.resolve({ data: [] }),
    ctx.can("plans.read") ? supabase.from("action_plans").select("id, code").eq("gap_assessment_id", id).maybeSingle() : Promise.resolve({ data: null }),
  ]);

  const frameworks = ((gap.gap_assessment_frameworks as { framework: { id: string; code: string; name: string; version: string; created_at: string } | null }[]) ?? [])
    .map((f) => f.framework!)
    .filter(Boolean)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.code.localeCompare(b.code));
  const fwById = new Map(frameworks.map((f) => [f.id, f]));
  const fwOrder = new Map(frameworks.map((f, i) => [f.id, i]));
  const items = ((rawItems ?? []) as Item[]).sort((a, b) => (fwOrder.get(a.framework_id) ?? 0) - (fwOrder.get(b.framework_id) ?? 0));
  const itemById = new Map(items.map((i) => [i.id, i]));
  const person = new Map(people.map((p) => [p.id, p.label]));
  const docById = new Map(((docs ?? []) as { id: string; code: string; title: string }[]).map((d) => [d.id, d]));
  const weight = Number(gap.partial_weight);
  const open = gap.status === "en_curso";
  const canRate = ctx.can("gap.write") && open;
  const canValidate = ctx.can("gap.validate");
  const scope = ((gap.gap_assessment_scope as { unit: { name: string } | null; process: { name: string } | null }[]) ?? [])
    .map((s) => s.unit?.name ?? s.process?.name)
    .filter(Boolean);

  // Indicadores (sobre todos los ítems, los comunes heredan el estado)
  const total = compliance(items.map((i) => i.status), weight);
  const primaries = items.filter((i) => !i.primary_item_id);
  const rated = primaries.filter((i) => i.status);
  const validated = rated.filter((i) => i.validated_at).length;
  const gaps = primaries.filter((i) => i.status === "no_cumple" || i.status === "parcial");
  const gapsClosed = gaps.filter((i) => i.gap_closed).length;
  const gapsWithAction = gaps.filter((i) => i.has_action).length;
  const pendingValidationByOthers = rated.filter((i) => !i.validated_at && i.assessed_by !== ctx.userId).length;

  // Filtros
  const q = (sp.q ?? "").trim().toLowerCase();
  const visible = items.filter((i) => {
    if (sp.norma && i.framework_id !== sp.norma) return false;
    if (sp.clausula && `${i.framework_id}|${i.top_clause}` !== sp.clausula) return false;
    if (sp.estado === "pendiente" && i.status) return false;
    if (sp.estado === "brecha" && i.status !== "no_cumple" && i.status !== "parcial") return false;
    if (sp.estado === "sin_validar" && (!i.status || i.validated_at)) return false;
    if (sp.estado && sp.estado in GAP_STATUS && i.status !== sp.estado) return false;
    if (q && !`${i.clause} ${i.title} ${i.description ?? ""}`.toLowerCase().includes(q)) return false;
    return true;
  });
  const qs = new URLSearchParams(Object.entries({ norma: sp.norma, estado: sp.estado, q: sp.q, clausula: sp.clausula }).filter(([, v]) => v) as [string, string][]).toString();
  const leaderValue = gap.leader_id ? person.get(gap.leader_id as string) ?? "" : (gap.leader_text as string | null) ?? "";

  return (
    <>
      <div className="head">
        <Link href="/gap" className="small">← Diagnóstico GAP</Link>
        <h1>
          <span className="mono">{gap.code as string}</span> · {gap.name as string}{" "}
          <span className={`tag ${open ? "warn" : "good"}`}>{label(GAP_ASSESSMENT_STATUS, gap.status)}</span>
        </h1>
        <p className="lead small">
          {frameworks.map((f) => `${f.code} ${f.version}`.trim()).join(" + ")}
          {gap.scope_description ? ` · Alcance: ${gap.scope_description as string}` : ""}
          {scope.length ? ` · ${scope.join(", ")}` : ""}
          {leaderValue ? ` · Líder: ${leaderValue}` : ""}
        </p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="kpis">
        <div className="kpi">
          <b className={total.pct === null ? "" : `txt-${pctTone(total.pct)}`}>{total.pct === null ? "—" : `${total.pct} %`}</b>
          <small>cumplimiento ({total.aplicables} requisitos aplicables)</small>
        </div>
        <div className="kpi"><b>{rated.length} / {primaries.length}</b><small>requisitos calificados</small></div>
        <div className="kpi"><b>{validated} / {rated.length}</b><small>calificaciones validadas</small></div>
        <div className="kpi"><b>{gaps.length}</b><small>brechas ({gapsWithAction} con actividad)</small></div>
        <div className="kpi"><b>{gaps.length ? Math.round((gapsClosed / gaps.length) * 100) : 0} %</b><small>cierre de brechas ({gapsClosed} cerradas)</small></div>
      </div>

      <div className="grid2" style={{ marginTop: 16 }}>
        <section className="panel">
          <h2>Cumplimiento por norma y cláusula</h2>
          <table>
            <thead><tr><th>Cláusula</th><th>Calificados</th><th>Brechas</th><th style={{ width: "34%" }}>Cumplimiento</th></tr></thead>
            <tbody>
              {groupBy(items, (i) => i.framework_id).map(([fwId, list]) => {
                const c = compliance(list.map((i) => i.status), weight);
                return [
                  <tr key={fwId}>
                    <th>{fwById.get(fwId)?.code} · {fwById.get(fwId)?.name}</th>
                    <td className="small">{c.total - c.pendientes} / {c.total}</td>
                    <td className="small">{c.noCumple + c.parcial}</td>
                    <td><Bar pct={c.pct} /></td>
                  </tr>,
                  ...groupBy(list, (i) => i.top_clause).map(([top, sub]) => {
                    const s = compliance(sub.map((i) => i.status), weight);
                    return (
                      <tr key={fwId + top}>
                        <td className="small" style={{ paddingLeft: 18 }}>
                          <Link href={`/gap/${id}?clausula=${encodeURIComponent(`${fwId}|${top}`)}#requisitos`}>{top} {sub[0].top_title}</Link>
                        </td>
                        <td className="small">{s.total - s.pendientes} / {s.total}</td>
                        <td className="small">{s.noCumple + s.parcial}</td>
                        <td><Bar pct={s.pct} /></td>
                      </tr>
                    );
                  }),
                ];
              })}
            </tbody>
          </table>
          <p className="small muted" style={{ marginTop: 8 }}>
            Cumplimiento = (cumple + {weight} × cumple parcial) ÷ requisitos aplicables × 100. «No aplica» y los pendientes no cuentan.
          </p>
        </section>

        <section className="panel stack">
          <h2>Acciones</h2>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <a className="btn ghost" href={`/gap/${id}/exportar`}>Exportar a Excel</a>
            {ctx.can("plans.write") && (
              <form action={generatePlan}>
                <input type="hidden" name="assessment_id" value={id} />
                <input type="hidden" name="qs" value={qs} />
                <button type="submit" disabled={!gaps.length} title={gaps.length ? "" : "No hay brechas calificadas"}>
                  {plan ? "Actualizar plan de trabajo" : "Generar plan de trabajo"}
                </button>
              </form>
            )}
            {plan && <Link className="btn ghost" href={`/plan/${plan.id}`}>Ver plan {plan.code}</Link>}
          </div>
          <p className="small muted">
            El plan crea una actividad por cada requisito que no cumple o cumple parcialmente. La prioridad sale de la
            criticidad del requisito: alta → 60 días, media → 120, baja → 180.
          </p>
          {canValidate && (
            <form action={validateItems}>
              <input type="hidden" name="assessment_id" value={id} />
              <input type="hidden" name="qs" value={qs} />
              <button type="submit" className="ghost" disabled={!pendingValidationByOthers}>
                Validar {pendingValidationByOthers} calificación(es) de otras personas
              </button>
            </form>
          )}
          {canRate && <GapImport assessmentId={id} />}
          {canValidate && (
            <form action={setGapStatus}>
              <input type="hidden" name="assessment_id" value={id} />
              <input type="hidden" name="qs" value={qs} />
              <input type="hidden" name="status" value={open ? "cerrado" : "en_curso"} />
              <button type="submit" className="ghost">{open ? "Cerrar diagnóstico" : "Reabrir diagnóstico"}</button>
              {open && <span className="small muted"> Requiere todos los requisitos calificados; luego no se pueden cambiar.</span>}
            </form>
          )}
          {ctx.can("gap.write") && (
            <details>
              <summary>Datos del diagnóstico</summary>
              <form action={updateGap} className="stack" style={{ marginTop: 8 }}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="qs" value={qs} />
                <div className="form-grid">
                  <label className="span-2">Nombre<input name="name" defaultValue={gap.name as string} required maxLength={160} /></label>
                  <ComboField name="leader" label="Líder" value={leaderValue} options={people} />
                  <label>
                    Peso del cumplimiento parcial
                    <input name="partial_weight" type="number" min={0} max={1} step={0.05} defaultValue={weight} />
                  </label>
                  <label className="span-all">Alcance<textarea name="scope_description" rows={2} defaultValue={(gap.scope_description as string | null) ?? ""} /></label>
                </div>
                <div><button type="submit">Guardar</button></div>
              </form>
              {open && (
                <form action={syncGapItems} style={{ marginTop: 8 }}>
                  <input type="hidden" name="assessment_id" value={id} />
                  <input type="hidden" name="qs" value={qs} />
                  <button type="submit" className="ghost">Agregar requisitos nuevos de las normas</button>
                </form>
              )}
            </details>
          )}
        </section>
      </div>

      <section className="panel" id="requisitos" style={{ marginTop: 16 }}>
        <h2>Requisitos</h2>
        <form className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end", marginBottom: 12 }}>
          {frameworks.length > 1 && (
            <label>
              Norma
              <select name="norma" defaultValue={sp.norma ?? ""}>
                <option value="">Todas</option>
                {frameworks.map((f) => <option key={f.id} value={f.id}>{f.code}</option>)}
              </select>
            </label>
          )}
          <label>
            Estado
            <select name="estado" defaultValue={sp.estado ?? ""}>
              <option value="">Todos</option>
              {Object.entries(FILTERS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label style={{ flex: 1, minWidth: 200 }}>
            Buscar
            <input name="q" defaultValue={sp.q ?? ""} placeholder="Cláusula o texto" />
          </label>
          {sp.clausula && <input type="hidden" name="clausula" value={sp.clausula} />}
          <button type="submit" className="ghost">Filtrar</button>
          {(sp.norma || sp.estado || sp.q || sp.clausula) && <Link href={`/gap/${id}#requisitos`} className="small">Quitar filtros</Link>}
        </form>
        <p className="small muted">{visible.length} de {items.length} requisitos.</p>

        {groupBy(visible, (i) => `${i.framework_id}|${i.top_clause}`).map(([key, list]) => {
          const fw = fwById.get(list[0].framework_id);
          return (
            <div key={key} style={{ marginTop: 14 }}>
              <h3 style={{ margin: "6px 0" }}>{fw?.code} · {list[0].top_clause} {list[0].top_title}</h3>
              <div className="stack" style={{ gap: 6 }}>
                {list.map((i) => {
                  const primary = i.primary_item_id ? itemById.get(i.primary_item_id) : undefined;
                  const doc = i.document_id ? docById.get(i.document_id) : undefined;
                  return (
                    <details key={i.id} id={`r-${i.id}`} className="gap-item">
                      <summary className="row" style={{ gap: 8, alignItems: "baseline" }}>
                        <span className="mono" style={{ minWidth: 56 }}>{i.clause}</span>
                        <span style={{ flex: 1 }}>{i.title}</span>
                        <span className={`tag ${levelTone(i.criticality)}`} title="Criticidad del requisito">{label(CRITICALITY, i.criticality)}</span>
                        <span className={`tag ${gapTone(i.status)}`}>{i.status ? label(GAP_STATUS, i.status) : "Sin calificar"}</span>
                        {i.status && <span className="small muted" title={i.validated_at ? `Validado por ${person.get(i.validated_by ?? "") ?? ""}` : "Pendiente de validación"}>{i.validated_at ? "✓ validado" : "sin validar"}</span>}
                      </summary>
                      <div className="stack" style={{ padding: "8px 0 12px 64px", gap: 8 }}>
                        {i.description && <p className="small" style={{ margin: 0 }}>{i.description}</p>}
                        {i.evidence_guidance && <p className="small muted" style={{ margin: 0 }}>Evidencia esperada: {i.evidence_guidance}</p>}
                        {primary ? (
                          <p className="small callout" style={{ margin: 0 }}>
                            Requisito común con <a href={`#r-${primary.id}`}>{fwById.get(primary.framework_id)?.code} {primary.clause}</a>: se califica allí y
                            hereda su estado.
                          </p>
                        ) : canRate ? (
                          <form action={rateItem} className="form-grid">
                            <input type="hidden" name="assessment_id" value={id} />
                            <input type="hidden" name="item_id" value={i.id} />
                            <input type="hidden" name="qs" value={qs} />
                            <label>
                              Estado
                              <select name="status" defaultValue={i.status ?? ""}>
                                <option value="">Sin calificar</option>
                                {Object.entries(GAP_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                              </select>
                            </label>
                            {(docs ?? []).length > 0 && (
                              <label>
                                Documento de evidencia
                                <select name="document_id" defaultValue={i.document_id ?? ""}>
                                  <option value="">—</option>
                                  {((docs ?? []) as { id: string; code: string; title: string }[]).map((d) => (
                                    <option key={d.id} value={d.id}>{d.code} · {d.title}</option>
                                  ))}
                                </select>
                              </label>
                            )}
                            <label className="span-2">
                              Evidencia
                              <textarea name="evidence_note" rows={2} defaultValue={i.evidence_note ?? ""} maxLength={4000}
                                placeholder="Documento, registro o lugar donde se verifica (obligatoria para cumple y cumple parcial)" />
                            </label>
                            <label className="span-2">
                              Justificación
                              <textarea name="justification" rows={2} defaultValue={i.justification ?? ""} maxLength={4000}
                                placeholder="Situación encontrada (obligatoria para cumple parcial, no cumple y no aplica)" />
                            </label>
                            <div className="span-all row" style={{ gap: 8 }}>
                              <button type="submit">Guardar calificación</button>
                              {i.assessed_at && (
                                <span className="small muted">
                                  Calificó {person.get(i.assessed_by ?? "") ?? "—"} el {i.assessed_at.slice(0, 10)}
                                </span>
                              )}
                            </div>
                          </form>
                        ) : (
                          <div className="small">
                            <p style={{ margin: 0 }}><b>Evidencia:</b> {doc ? `${doc.code} · ${doc.title}. ` : ""}{i.evidence_note ?? (doc ? "" : "—")}</p>
                            <p style={{ margin: 0 }}><b>Justificación:</b> {i.justification ?? "—"}</p>
                            {i.assessed_at && <p className="muted" style={{ margin: 0 }}>Calificó {person.get(i.assessed_by ?? "") ?? "—"} el {i.assessed_at.slice(0, 10)}</p>}
                          </div>
                        )}
                        {canValidate && !primary && i.status && !i.validated_at && i.assessed_by !== ctx.userId && (
                          <form action={validateItems}>
                            <input type="hidden" name="assessment_id" value={id} />
                            <input type="hidden" name="item_id" value={i.id} />
                            <input type="hidden" name="qs" value={qs} />
                            <button type="submit" className="ghost">Validar esta calificación</button>
                          </form>
                        )}
                      </div>
                    </details>
                  );
                })}
              </div>
            </div>
          );
        })}
      </section>
    </>
  );
}

function Bar({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="small muted">—</span>;
  return (
    <span className="row" style={{ gap: 8, alignItems: "center" }}>
      <span className="bar"><span className={`bar-fill ${pctTone(pct)}`} style={{ width: `${Math.max(2, pct)}%` }} /></span>
      <span className="small" style={{ minWidth: 44, textAlign: "right" }}>{pct} %</span>
    </span>
  );
}
