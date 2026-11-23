import { NextResponse } from "next/server";
import { getSessionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, getProcesses } from "@/lib/lookups";
import { getMethodology } from "@/lib/risk-data";
import { buildRiskWorkbook, type RiskSheetEntry } from "@/lib/risk-sheet";
import { buildXlsx } from "@/lib/xlsx-writer";

/** GET /riesgos/exportar → registro de riesgos con escalas para valorar en Excel. */
export async function GET() {
  const state = await getSessionState();
  if (state.status !== "ok" || !state.ctx.can("risks.read")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const supabase = await createClient();
  const [m, people, processes, { data }, { data: links }] = await Promise.all([
    getMethodology(),
    getPeople(),
    getProcesses(),
    supabase.from("risk_entries_view").select("*").eq("active", true).order("code").limit(5000),
    supabase.from("risk_entry_controls").select("entry_id, control:controls(code)").limit(50000),
  ]);
  const person = new Map(people.map((p) => [p.id, p.label]));
  const proc = new Map(processes.map((p) => [p.id, p.label]));
  const ctrl = new Map<string, string[]>();
  for (const l of (links ?? []) as unknown as { entry_id: string; control: { code: string } | null }[]) {
    if (l.control) ctrl.set(l.entry_id, [...(ctrl.get(l.entry_id) ?? []), l.control.code]);
  }
  const entries: RiskSheetEntry[] = (data ?? []).map((e) => ({
    code: e.code, risk_code: e.risk_code, risk_name: e.risk_name, cause_code: e.cause_code, cause: e.cause,
    category: e.category, factor: e.factor, threat_event: e.threat_event,
    controls: (ctrl.get(e.id) ?? []).sort((a, b) => a.localeCompare(b, "es", { numeric: true })),
    treatment_description: e.treatment_description, treatment_strategy: e.treatment_strategy,
    process: e.process_id ? proc.get(e.process_id) ?? null : null,
    owner: e.owner_id ? person.get(e.owner_id) ?? null : e.owner_text,
    inherent_probability: e.inherent_probability, inherent_impact: e.inherent_impact,
    inherent_score: e.inherent_score === null ? null : Number(e.inherent_score), inherent_zone: e.inherent_zone,
    residual_probability: e.residual_probability, residual_impact: e.residual_impact,
    residual_score: e.residual_score === null ? null : Number(e.residual_score), residual_zone: e.residual_zone,
    out_of_tolerance: Boolean(e.out_of_tolerance), accepted: Boolean(e.accepted_at),
  }));
  await supabase.rpc("log_event", { p_action: "EXPORT", p_detail: { objeto: "riesgos", filas: entries.length } });
  const bytes = buildXlsx(buildRiskWorkbook({
    orgName: state.ctx.organization.name, brandColor: state.ctx.organization.brand_color ?? undefined, m, entries,
  }));
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="registro-riesgos-${date}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
