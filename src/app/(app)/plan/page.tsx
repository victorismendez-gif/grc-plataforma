import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/lookups";
import { planKpis } from "@/lib/gap";
import { label, PLAN_ORIGIN } from "@/lib/labels";
import Flash, { type FlashParams } from "@/components/flash";
import ComboField from "@/components/combo-field";
import { createPlan } from "./actions";

export const metadata: Metadata = { title: "Planes de trabajo" };

type Row = {
  id: string; code: string; title: string; origin: string; status: string; owner_text: string | null;
  owner: { full_name: string } | null; gap: { code: string } | null;
  actions: { status: string; due_on: string | null; progress: number }[];
};

export default async function PlansPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("plans.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("action_plans")
    .select("id, code, title, origin, status, owner_text, owner:profiles!action_plans_organization_id_owner_id_fkey(full_name), gap:gap_assessments(code), actions(status, due_on, progress)")
    .order("created_at", { ascending: false });
  const plans = (data ?? []) as unknown as Row[];
  const today = new Date().toISOString().slice(0, 10);
  const people = ctx.can("plans.write") ? await getPeople() : [];

  return (
    <>
      <div className="head">
        <h1>Planes de trabajo</h1>
        <p className="lead">Actividades para cerrar brechas del GAP y, más adelante, hallazgos de auditoría y tratamiento de riesgos.</p>
      </div>
      <Flash {...sp} />
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Código</th><th>Plan</th><th>Origen</th><th>Responsable</th><th>Actividades</th><th>Avance</th><th>Vencidas</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {plans.map((p) => {
              const k = planKpis(p.actions, today);
              return (
                <tr key={p.id}>
                  <td className="mono"><Link href={`/plan/${p.id}`}>{p.code}</Link></td>
                  <td>{p.title}</td>
                  <td className="small">{label(PLAN_ORIGIN, p.origin)}{p.gap ? ` · ${p.gap.code}` : ""}</td>
                  <td className="small">{p.owner?.full_name ?? p.owner_text ?? "—"}</td>
                  <td className="small">{k.terminadas} de {k.total} terminadas</td>
                  <td>
                    <span className="row" style={{ gap: 8, alignItems: "center" }}>
                      <span className="bar"><span className="bar-fill" style={{ width: `${Math.max(2, k.avance)}%` }} /></span>
                      <span className="small">{k.avance} %</span>
                    </span>
                  </td>
                  <td>{k.vencidas ? <span className="tag crit">{k.vencidas}</span> : <span className="small muted">0</span>}</td>
                  <td className="small">{p.status === "cerrado" ? "Cerrado" : "Abierto"}</td>
                </tr>
              );
            })}
            {!plans.length && (
              <tr><td colSpan={8} className="small muted">No hay planes. Genera uno desde un diagnóstico GAP o crea un plan manual.</td></tr>
            )}
          </tbody>
        </table>
      </div>
      {ctx.can("plans.write") && (
        <details className="panel" style={{ marginTop: 16 }}>
          <summary>Crear plan manual</summary>
          <form action={createPlan} className="form-grid" style={{ marginTop: 10 }}>
            <label className="span-2">Nombre del plan *<input name="title" required minLength={3} maxLength={200} /></label>
            <ComboField name="owner" label="Responsable" options={people} placeholder="Elige o escribe un nombre" />
            <label className="span-all">Descripción<textarea name="description" rows={2} maxLength={4000} /></label>
            <div><button type="submit">Crear plan</button></div>
          </form>
        </details>
      )}
    </>
  );
}
