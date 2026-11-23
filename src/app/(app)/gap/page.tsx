import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { compliance, pctTone } from "@/lib/gap";
import { GAP_ASSESSMENT_STATUS, label } from "@/lib/labels";
import Flash, { type FlashParams } from "@/components/flash";

export const metadata: Metadata = { title: "Diagnóstico GAP" };

type Row = {
  id: string; code: string; name: string; status: string; started_on: string; closed_on: string | null; partial_weight: number;
  leader_text: string | null; leader: { full_name: string } | null;
  gap_assessment_frameworks: { framework: { code: string; name: string } | null }[];
};

export default async function GapListPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("gap.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("gap_assessments")
    .select("id, code, name, status, started_on, closed_on, partial_weight, leader_text, leader:profiles!gap_assessments_organization_id_leader_id_fkey(full_name), gap_assessment_frameworks(framework:frameworks(code, name))")
    .order("started_on", { ascending: false });
  const rows = (data ?? []) as unknown as Row[];
  const { data: items } = rows.length
    ? await supabase.from("gap_items_effective").select("assessment_id, status").in("assessment_id", rows.map((r) => r.id))
    : { data: [] };
  const byAssessment = new Map<string, (string | null)[]>();
  for (const i of items ?? []) byAssessment.set(i.assessment_id as string, [...(byAssessment.get(i.assessment_id as string) ?? []), i.status as string | null]);

  return (
    <>
      <div className="head">
        <h1>Diagnóstico GAP</h1>
        <p className="lead">
          Evalúa cada requisito de las normas como cumple, cumple parcial, no cumple o no aplica, con su evidencia. El
          resultado muestra el porcentaje de cumplimiento por norma y cláusula, y genera el plan de trabajo para cerrar
          las brechas.
        </p>
      </div>
      <Flash {...sp} />
      {ctx.can("gap.write") && (
        <div className="row" style={{ justifyContent: "flex-end", marginBottom: 12 }}>
          <Link className="btn" href="/gap/nuevo">Nuevo diagnóstico</Link>
        </div>
      )}
      <div className="tablewrap">
        <table>
          <thead>
            <tr><th>Código</th><th>Diagnóstico</th><th>Normas</th><th>Líder</th><th>Avance</th><th>Cumplimiento</th><th>Estado</th></tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const c = compliance(byAssessment.get(r.id) ?? [], Number(r.partial_weight));
              const rated = c.total - c.pendientes;
              return (
                <tr key={r.id}>
                  <td className="mono"><Link href={`/gap/${r.id}`}>{r.code}</Link></td>
                  <td>{r.name}<div className="small muted">Desde {r.started_on}{r.closed_on ? ` · cerrado ${r.closed_on}` : ""}</div></td>
                  <td className="small">{r.gap_assessment_frameworks.map((f) => f.framework?.code).filter(Boolean).join(", ")}</td>
                  <td className="small">{r.leader?.full_name ?? r.leader_text ?? "—"}</td>
                  <td className="small">{rated} de {c.total} calificados</td>
                  <td>{c.pct === null ? "—" : <span className={`tag ${pctTone(c.pct)}`}>{c.pct} %</span>}</td>
                  <td className="small">{label(GAP_ASSESSMENT_STATUS, r.status)}</td>
                </tr>
              );
            })}
            {!rows.length && (
              <tr><td colSpan={7} className="small muted">Aún no hay diagnósticos. Crea el primero con «Nuevo diagnóstico».</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
