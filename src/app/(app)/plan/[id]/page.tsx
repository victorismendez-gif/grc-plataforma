import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, getProcesses, getUnits } from "@/lib/lookups";
import { groupBy, planKpis } from "@/lib/gap";
import { ACTION_STATUS, label, PLAN_ORIGIN, PRIORITY, priorityTone } from "@/lib/labels";
import Flash from "@/components/flash";
import ComboField from "@/components/combo-field";
import { moveAction, updatePlan } from "../actions";

export const metadata: Metadata = { title: "Plan de trabajo" };

type SP = { error?: string; ok?: string; vista?: string; area?: string; estado?: string; prioridad?: string; agrupar?: string };
type Props = { params: Promise<{ id: string }>; searchParams: Promise<SP> };

type Act = {
  id: string; title: string; owner_id: string | null; owner_text: string | null; unit_id: string | null; process_id: string | null;
  priority: string; start_on: string | null; due_on: string | null; status: string; progress: number; completed_on: string | null;
  requirement: { clause: string } | null;
};

const PRIORITY_ORDER: Record<string, number> = { alta: 0, media: 1, baja: 2 };

export default async function PlanPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("plans.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: plan } = await supabase
    .from("action_plans")
    .select("*, gap:gap_assessments(id, code, name)")
    .eq("id", id)
    .maybeSingle();
  if (!plan) notFound();
  const [{ data }, people, units, processes] = await Promise.all([
    supabase
      .from("actions")
      .select("id, title, owner_id, owner_text, unit_id, process_id, priority, start_on, due_on, status, progress, completed_on, requirement:requirements(clause)")
      .eq("plan_id", id)
      .order("due_on", { nullsFirst: false })
      .limit(3000),
    getPeople(),
    getUnits(),
    getProcesses(),
  ]);
  const all = ((data ?? []) as unknown as Act[]).sort(
    (a, b) => (PRIORITY_ORDER[a.priority] ?? 9) - (PRIORITY_ORDER[b.priority] ?? 9) || (a.due_on ?? "9").localeCompare(b.due_on ?? "9"),
  );
  const today = new Date().toISOString().slice(0, 10);
  const k = planKpis(all, today);
  const person = new Map(people.map((p) => [p.id, p.label]));
  const unitName = new Map(units.map((u) => [u.id, u.label]));
  const processName = new Map(processes.map((p) => [p.id, p.label]));
  const owner = (a: Act) => (a.owner_id ? person.get(a.owner_id) ?? "" : a.owner_text) || "Sin responsable";
  const canWrite = ctx.can("plans.write");
  const vista = sp.vista === "tablero" || sp.vista === "cronograma" ? sp.vista : "lista";
  const agrupar = sp.agrupar === "responsable" || sp.agrupar === "proceso" || sp.agrupar === "ninguno" ? sp.agrupar : "area";

  const acts = all.filter(
    (a) =>
      (!sp.area || (sp.area === "_" ? !a.unit_id : a.unit_id === sp.area)) &&
      (!sp.estado || (sp.estado === "vencida" ? (a.status === "pendiente" || a.status === "en_curso") && !!a.due_on && a.due_on < today : a.status === sp.estado)) &&
      (!sp.prioridad || a.priority === sp.prioridad),
  );
  const filterQs = new URLSearchParams(Object.entries({ area: sp.area, estado: sp.estado, prioridad: sp.prioridad, agrupar: sp.agrupar }).filter(([, v]) => v) as [string, string][]);
  const viewHref = (v: string) => {
    const q = new URLSearchParams(filterQs);
    if (v !== "lista") q.set("vista", v);
    return `/plan/${id}?${q.toString()}`;
  };
  const back = new URLSearchParams(filterQs);
  if (vista !== "lista") back.set("vista", vista);
  const ownerValue = plan.owner_id ? person.get(plan.owner_id as string) ?? "" : (plan.owner_text as string | null) ?? "";
  const overdue = (a: Act) => (a.status === "pendiente" || a.status === "en_curso") && !!a.due_on && a.due_on < today;
  const gap = plan.gap as { id: string; code: string; name: string } | null;

  return (
    <>
      <div className="head">
        <Link href="/plan" className="small">← Planes de trabajo</Link>
        <h1><span className="mono">{plan.code as string}</span> · {plan.title as string}</h1>
        <p className="lead small">
          {label(PLAN_ORIGIN, plan.origin)}
          {gap ? <> · <Link href={`/gap/${gap.id}`}>{gap.code} {gap.name}</Link></> : null}
          {ownerValue ? ` · Responsable: ${ownerValue}` : ""}
          {plan.status === "cerrado" ? " · Cerrado" : ""}
        </p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />

      <div className="kpis">
        <div className="kpi"><b>{k.avance} %</b><small>avance promedio</small></div>
        <div className="kpi"><b>{k.avanceFecha === null ? "—" : `${k.avanceFecha} %`}</b><small>avance a la fecha (terminadas ÷ planeadas a hoy)</small></div>
        <div className="kpi"><b>{k.terminadas} / {k.total}</b><small>actividades terminadas</small></div>
        <div className="kpi"><b className={k.vencidas ? "txt-crit" : ""}>{k.vencidas}</b><small>vencidas ({k.pctVencidas} % de las abiertas)</small></div>
      </div>

      <section className="panel" style={{ marginTop: 16 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <nav className="tabs" style={{ borderBottom: 0 }}>
            {(["lista", "tablero", "cronograma"] as const).map((v) => (
              <a key={v} href={viewHref(v)} aria-current={vista === v ? "page" : undefined}>
                {v === "lista" ? "Lista" : v === "tablero" ? "Tablero" : "Cronograma"}
              </a>
            ))}
          </nav>
          {canWrite && <Link className="btn" href={`/plan/${id}/actividad/nueva`}>Agregar actividad</Link>}
        </div>
        <form className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "flex-end", margin: "10px 0" }}>
          {vista !== "lista" && <input type="hidden" name="vista" value={vista} />}
          <label>
            Sede o área
            <select name="area" defaultValue={sp.area ?? ""}>
              <option value="">Todas</option>
              <option value="_">Sin área asignada</option>
              {units.map((u) => <option key={u.id} value={u.id}>{"  ".repeat(u.depth)}{u.label}</option>)}
            </select>
          </label>
          <label>
            Estado
            <select name="estado" defaultValue={sp.estado ?? ""}>
              <option value="">Todos</option>
              {Object.entries(ACTION_STATUS).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
              <option value="vencida">Vencidas</option>
            </select>
          </label>
          <label>
            Prioridad
            <select name="prioridad" defaultValue={sp.prioridad ?? ""}>
              <option value="">Todas</option>
              {Object.entries(PRIORITY).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
            </select>
          </label>
          {vista === "lista" && (
            <label>
              Agrupar por
              <select name="agrupar" defaultValue={agrupar}>
                <option value="area">Área</option>
                <option value="responsable">Responsable</option>
                <option value="proceso">Proceso</option>
                <option value="ninguno">Sin agrupar</option>
              </select>
            </label>
          )}
          <button type="submit" className="ghost">Aplicar</button>
        </form>

        {vista === "lista" && (
          <>
            {groupBy(acts, (a) =>
              agrupar === "area" ? (a.unit_id ? unitName.get(a.unit_id) ?? "—" : "Sin área asignada")
                : agrupar === "responsable" ? owner(a)
                : agrupar === "proceso" ? (a.process_id ? processName.get(a.process_id) ?? "—" : "Sin proceso")
                : "",
            )
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([group, list]) => (
                <div key={group} style={{ marginTop: 10 }}>
                  {group && <h3 style={{ margin: "6px 0" }}>{group} <span className="small muted">· {list.length}</span></h3>}
                  <div className="tablewrap">
                    <table>
                      <thead><tr><th>Actividad</th><th>Responsable</th><th>Prioridad</th><th>Inicio</th><th>Límite</th><th>Avance</th><th>Estado</th></tr></thead>
                      <tbody>
                        {list.map((a) => (
                          <tr key={a.id}>
                            <td>
                              <Link href={`/plan/${id}/actividad/${a.id}?back=${encodeURIComponent(back.toString())}`}>{a.title}</Link>
                            </td>
                            <td className="small">{owner(a)}</td>
                            <td><span className={`tag ${priorityTone(a.priority)}`}>{label(PRIORITY, a.priority)}</span></td>
                            <td className="small">{a.start_on ?? "—"}</td>
                            <td className={`small ${overdue(a) ? "txt-crit" : ""}`}>{a.due_on ?? "—"}{overdue(a) ? " · vencida" : ""}</td>
                            <td className="small">{a.status === "terminada" ? 100 : a.progress} %</td>
                            <td className="small">{label(ACTION_STATUS, a.status)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            {!acts.length && <p className="small muted">No hay actividades con estos filtros.</p>}
          </>
        )}

        {vista === "tablero" && (
          <div className="board">
            {Object.entries(ACTION_STATUS).map(([st, title]) => {
              const list = acts.filter((a) => a.status === st);
              return (
                <div key={st} className="board-col">
                  <h3>{title} <span className="small muted">· {list.length}</span></h3>
                  {list.slice(0, 200).map((a) => (
                    <div key={a.id} className="card">
                      <Link href={`/plan/${id}/actividad/${a.id}?back=${encodeURIComponent(back.toString())}`} className="small">{a.title}</Link>
                      <span className="small muted">{owner(a)}</span>
                      <span className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <span className={`tag ${priorityTone(a.priority)}`}>{label(PRIORITY, a.priority)}</span>
                        {a.due_on && <span className={`small ${overdue(a) ? "txt-crit" : "muted"}`}>{a.due_on}</span>}
                      </span>
                      {canWrite && (
                        <form action={moveAction} className="row" style={{ gap: 4 }}>
                          <input type="hidden" name="plan_id" value={id} />
                          <input type="hidden" name="id" value={a.id} />
                          <select name="status" defaultValue={a.status} style={{ flex: 1, fontSize: 12 }}>
                            {Object.entries(ACTION_STATUS).map(([k2, v]) => <option key={k2} value={k2}>{v}</option>)}
                          </select>
                          <button type="submit" className="ghost" style={{ fontSize: 12, padding: "2px 8px" }}>Mover</button>
                        </form>
                      )}
                    </div>
                  ))}
                  {list.length > 200 && <span className="small muted">…y {list.length - 200} más (usa filtros).</span>}
                </div>
              );
            })}
          </div>
        )}

        {vista === "cronograma" && <Gantt acts={acts} today={today} planId={id} back={back.toString()} owner={owner} />}
      </section>

      {canWrite && (
        <details className="panel" style={{ marginTop: 16 }}>
          <summary>Datos del plan</summary>
          <form action={updatePlan} className="form-grid" style={{ marginTop: 10 }}>
            <input type="hidden" name="id" value={id} />
            <label className="span-2">Nombre<input name="title" defaultValue={plan.title as string} required maxLength={200} /></label>
            <ComboField name="owner" label="Responsable" value={ownerValue} options={people} />
            <label>
              Estado
              <select name="status" defaultValue={plan.status as string}>
                <option value="abierto">Abierto</option>
                <option value="cerrado">Cerrado</option>
              </select>
            </label>
            <label className="span-all">Descripción<textarea name="description" rows={2} defaultValue={(plan.description as string | null) ?? ""} /></label>
            <div><button type="submit">Guardar</button></div>
          </form>
        </details>
      )}
    </>
  );
}

function Gantt({ acts, today, planId, back, owner }: { acts: Act[]; today: string; planId: string; back: string; owner: (a: Act) => string }) {
  const dated = acts.filter((a) => a.start_on || a.due_on);
  if (!dated.length) return <p className="small muted">Las actividades no tienen fechas. Asigna inicio y fecha límite para verlas en el cronograma.</p>;
  const day = (d: string) => Date.parse(d + "T00:00:00Z") / 86400000;
  const starts = dated.map((a) => day(a.start_on ?? a.due_on!));
  const ends = dated.map((a) => day(a.due_on ?? a.start_on!));
  const min = Math.min(...starts, day(today));
  const max = Math.max(...ends, day(today)) + 1;
  const span = Math.max(1, max - min);
  const pos = (d: number) => ((d - min) / span) * 100;
  // marcas de meses
  const months: { label: string; left: number }[] = [];
  const first = new Date(min * 86400000);
  for (let m = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1)); m.getTime() / 86400000 < max; m = new Date(Date.UTC(m.getUTCFullYear(), m.getUTCMonth() + 1, 1))) {
    months.push({ label: m.toISOString().slice(0, 7), left: pos(m.getTime() / 86400000) });
  }
  return (
    <div className="tablewrap">
      <table className="gantt">
        <thead>
          <tr>
            <th style={{ width: "34%" }}>Actividad</th>
            <th>
              <div className="gantt-track" style={{ background: "transparent", height: 16 }}>
                {months.map((m) => (
                  <span key={m.label} className="small muted" style={{ position: "absolute", left: `${m.left}%`, borderLeft: "1px solid var(--line)", paddingLeft: 3 }}>{m.label}</span>
                ))}
              </div>
            </th>
          </tr>
        </thead>
        <tbody>
          {dated.map((a) => {
            const s = day(a.start_on ?? a.due_on!);
            const e = day(a.due_on ?? a.start_on!) + 1;
            const late = (a.status === "pendiente" || a.status === "en_curso") && !!a.due_on && a.due_on < today;
            return (
              <tr key={a.id}>
                <td className="small">
                  <Link href={`/plan/${planId}/actividad/${a.id}?back=${encodeURIComponent(back)}`}>{a.title}</Link>
                  <div className="muted">{owner(a)} · {a.start_on ?? "?"} → {a.due_on ?? "?"}</div>
                </td>
                <td>
                  <div className="gantt-track" title={`${a.start_on ?? ""} → ${a.due_on ?? ""}`}>
                    <span className={`gantt-bar ${a.status === "terminada" ? "good" : late ? "crit" : ""}`}
                      style={{ left: `${pos(s)}%`, width: `${Math.max(0.8, pos(e) - pos(s))}%` }} />
                    <span className="gantt-today" style={{ left: `${pos(day(today))}%` }} title="Hoy" />
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p className="small muted">Verde: terminada · Rojo: vencida · La línea vertical marca hoy.</p>
    </div>
  );
}
