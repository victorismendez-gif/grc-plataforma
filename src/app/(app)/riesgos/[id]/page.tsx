import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/lookups";
import { getMethodology, getMethodologyById } from "@/lib/risk-data";
import { inkFor, score, zoneFor, type Methodology } from "@/lib/risk";
import { ACTION_STATUS, CONTROL_TYPES, IMPLEMENTATION, label, RATINGS } from "@/lib/labels";
import Flash from "@/components/flash";
import EntryForm, { type EntryValues } from "../entry-form";
import { acceptRisk, addTreatment, evaluateEntry, recordMaterialization, saveEntryControls, updateEntry } from "../actions";

export const metadata: Metadata = { title: "Riesgo" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };

type Ctrl = {
  id: string; code: string; name: string; control_type: string; design_rating: number | null; application_rating: number | null;
  effectiveness_rating: number | null; implementation_status: string;
};

export default async function RiskPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("risks.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: e } = await supabase.from("risk_entries_view").select("*").eq("id", id).maybeSingle();
  if (!e) notFound();
  const [current, used, people, { data: links }, { data: controls }, { data: acts }, { data: typeLinks }] = await Promise.all([
    getMethodology(),
    e.methodology_id ? getMethodologyById(e.methodology_id as string) : Promise.resolve(null),
    getPeople(),
    supabase.from("risk_entry_controls").select("control_id").eq("entry_id", id),
    ctx.can("controls.read") ? supabase.from("controls").select("id, code, name, control_type, design_rating, application_rating, effectiveness_rating, implementation_status").eq("active", true).order("code") : Promise.resolve({ data: [] }),
    ctx.can("plans.read") ? supabase.from("actions").select("id, plan_id, title, status, due_on").eq("risk_entry_id", id).order("created_at") : Promise.resolve({ data: [] }),
    supabase.from("risk_entry_asset_types").select("asset_type_id").eq("entry_id", id),
  ]);
  const asset_type_ids = (typeLinks ?? []).map((t) => t.asset_type_id as string);
  const m: Methodology = used ?? current;
  const linked = new Set((links ?? []).map((l) => l.control_id as string));
  const ctrlList = (controls ?? []) as Ctrl[];
  const person = new Map(people.map((p) => [p.id, p.label]));
  const canWrite = ctx.can("risks.write");
  const evaluated = e.residual_score !== null;
  const outdated = evaluated && used && used.id !== current.id;
  const reduction = (r: number | null) => (r ? Math.round((m.control_reduction[String(r)] ?? 0) * 100) : 0);

  return (
    <>
      <div className="head">
        <Link href="/riesgos" className="small">← Riesgos</Link>
        <h1><span className="mono">{e.code as string}</span> · {e.risk_code as string}{e.cause_code ? ` · ${e.cause_code as string}` : ""}</h1>
        <p className="lead small">{e.risk_name as string}{e.cause ? ` — Causa: ${e.cause as string}` : ""}{e.factor ? ` (${e.factor as string})` : ""}</p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="grid2">
        <section className="panel stack">
          <h2>Valoración</h2>
          <div className="row" style={{ gap: 16, flexWrap: "wrap" }}>
            <Score title="Inherente" p={e.inherent_probability} i={e.inherent_impact} s={e.inherent_score} zone={e.inherent_zone} color={e.inherent_color} m={m} />
            <Score title="Residual" p={e.residual_probability} i={e.residual_impact} s={e.residual_score} zone={e.residual_zone} color={e.residual_color} m={m} />
          </div>
          {evaluated && (
            <p className="small" style={{ margin: 0 }}>
              Tolerancia {Number(e.tolerance)} · apetito {Number(e.appetite)}{e.category ? ` (${e.category as string})` : ""}.{" "}
              {e.accepted_at ? <span className="tag good">Riesgo residual aceptado</span>
                : e.out_of_tolerance ? (e.has_treatment ? <span className="tag warn">Fuera de tolerancia · en tratamiento</span> : <span className="tag crit">Fuera de tolerancia: requiere tratamiento</span>)
                : e.within_appetite ? <span className="tag good">Dentro del apetito</span> : <span className="tag">Dentro de la tolerancia</span>}
            </p>
          )}
          {e.evaluated_at && (
            <p className="small muted" style={{ margin: 0 }}>
              Valoró {person.get(e.evaluated_by as string) ?? "—"} el {(e.evaluated_at as string).slice(0, 10)} con la metodología versión {Number(e.methodology_version)}.
              {outdated && " Hay una versión más nueva; vuelve a valorar para usarla."}
            </p>
          )}
          {canWrite && (
            <form action={evaluateEntry} className="form-grid">
              <input type="hidden" name="id" value={id} />
              <label>
                Probabilidad inherente
                <select name="probability" defaultValue={outdated ? "" : (e.inherent_probability as number | null) ?? ""}>
                  <option value="">Sin valorar</option>
                  {current.probability_levels.map((l) => <option key={l.level} value={l.level} title={l.description}>{l.level} · {l.name}</option>)}
                </select>
              </label>
              <label>
                Impacto inherente
                <select name="impact" defaultValue={outdated ? "" : (e.inherent_impact as number | null) ?? ""}>
                  <option value="">Sin valorar</option>
                  {current.impact_levels.map((l) => <option key={l.level} value={l.level} title={l.description}>{l.level} · {l.name}</option>)}
                </select>
              </label>
              <div className="span-all"><button type="submit">Guardar valoración</button> <Link className="small" href="/riesgos/metodologia">Ver escalas</Link></div>
            </form>
          )}
          <p className="small muted" style={{ margin: 0 }}>
            El residual lo calcula la plataforma: cada control implementado o en implementación reduce la probabilidad
            (preventivo o detectivo) o el impacto (correctivo) según su efectividad: Débil {reduction(1)} %, Moderado {reduction(2)} %, Fuerte {reduction(3)} %.
          </p>
        </section>

        <section className="panel stack">
          <h2>Tratamiento</h2>
          {(acts ?? []).length > 0 ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {(acts as { id: string; plan_id: string; title: string; status: string; due_on: string | null }[]).map((a) => (
                <li key={a.id}><Link href={`/plan/${a.plan_id}/actividad/${a.id}`}>{a.title}</Link> · {label(ACTION_STATUS, a.status)}{a.due_on ? ` · ${a.due_on}` : ""}</li>
              ))}
            </ul>
          ) : (
            <p className="small muted" style={{ margin: 0 }}>Sin actividades de tratamiento.</p>
          )}
          {ctx.can("plans.write") && (
            <form action={addTreatment}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className={e.out_of_tolerance && !e.has_treatment ? "" : "ghost"}>Agregar actividad de tratamiento</button>
            </form>
          )}
          {ctx.can("risks.configure") && evaluated && (
            <details open={Boolean(e.accepted_at)}>
              <summary>Aceptación del riesgo residual</summary>
              <form action={acceptRisk} className="stack" style={{ marginTop: 6 }}>
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="accept" value={e.accepted_at ? "0" : "1"} />
                {e.accepted_at ? (
                  <p className="small" style={{ margin: 0 }}>
                    Aprobó {person.get(e.accepted_by as string) ?? "—"} el {(e.accepted_at as string).slice(0, 10)}: {e.acceptance_note as string}
                  </p>
                ) : (
                  <label>Justificación<textarea name="note" rows={2} required maxLength={2000} placeholder="Por qué se acepta el riesgo residual y hasta cuándo" /></label>
                )}
                <div><button type="submit" className="ghost">{e.accepted_at ? "Retirar aceptación" : "Aprobar aceptación"}</button></div>
              </form>
            </details>
          )}
          {canWrite && (
            <form action={recordMaterialization} className="row" style={{ gap: 8, alignItems: "center" }}>
              <input type="hidden" name="id" value={id} />
              <button type="submit" className="ghost">Registrar que se materializó</button>
              <span className="small muted">{Number(e.materialized_count)} vez/veces{e.last_materialized_on ? ` · última ${e.last_materialized_on as string}` : ""}</span>
            </form>
          )}
        </section>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Controles que mitigan el riesgo</h2>
        {!ctrlList.length ? (
          <p className="small muted">No hay controles registrados. Créalos o cárgalos en <Link href="/controles">Controles</Link>.</p>
        ) : (
          <form action={saveEntryControls} className="stack">
            <input type="hidden" name="id" value={id} />
            <fieldset disabled={!canWrite} style={{ border: 0, padding: 0, margin: 0 }}>
              <div className="tablewrap">
                <table>
                  <thead><tr><th /><th>Control</th><th>Tipo</th><th>Efectividad</th><th>Estado</th><th>Reduce</th></tr></thead>
                  <tbody>
                    {ctrlList
                      .sort((a, b) => Number(linked.has(b.id)) - Number(linked.has(a.id)))
                      .map((c) => {
                        const r = c.effectiveness_rating ?? (c.design_rating && c.application_rating ? Math.min(c.design_rating, c.application_rating) : c.design_rating);
                        const counts = c.implementation_status === "implementado" || c.implementation_status === "en_implementacion";
                        return (
                          <tr key={c.id}>
                            <td><input type="checkbox" name="control_ids" value={c.id} defaultChecked={linked.has(c.id)} aria-label={c.code} /></td>
                            <td className="small"><b>{c.code}</b> {c.name}</td>
                            <td className="small">{label(CONTROL_TYPES, c.control_type)}</td>
                            <td className="small">{r ? label(RATINGS, r) : "Sin calificar"}</td>
                            <td className="small">{label(IMPLEMENTATION, c.implementation_status)}</td>
                            <td className="small">{counts && r ? `${c.control_type === "correctivo" ? "impacto" : "probabilidad"} ${reduction(r)} %` : <span className="muted">no reduce</span>}</td>
                          </tr>
                        );
                      })}
                  </tbody>
                </table>
              </div>
            </fieldset>
            {canWrite && <div><button type="submit">Guardar controles</button></div>}
          </form>
        )}
      </section>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Datos del riesgo</h2>
        <EntryForm entry={{ ...(e as EntryValues), asset_type_ids }} action={updateEntry} readOnly={!canWrite} />
      </section>
    </>
  );
}

function Score({ title, p, i, s, zone, color, m }: {
  title: string; p: unknown; i: unknown; s: unknown; zone: unknown; color: unknown; m: Methodology;
}) {
  if (p === null || i === null || s === null) {
    return <div className="kpi"><b className="muted">—</b><small>{title}: sin valorar</small></div>;
  }
  const z = zone ? { name: zone as string, color: color as string } : zoneFor(m.zones, score(m, Number(p), Number(i)));
  return (
    <div className="kpi">
      <b><span className="zone" style={{ background: z.color, color: inkFor(z.color), fontSize: 15 }}>{z.name} · {Number(s)}</span></b>
      <small>
        {title}: probabilidad {Number(p)} ({m.probability_levels[Number(p) - 1]?.name}) × impacto {Number(i)} ({m.impact_levels[Number(i) - 1]?.name})
      </small>
    </div>
  );
}
