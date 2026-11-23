import { NextResponse, type NextRequest } from "next/server";
import { getSessionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { buildGapWorkbook, type GapSheetItem } from "@/lib/gap-sheet";
import { buildXlsx } from "@/lib/xlsx-writer";

/** GET /gap/:id/exportar → resumen + hoja para calificar desde Excel. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const state = await getSessionState();
  if (state.status !== "ok" || !state.ctx.can("gap.read")) return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data: gap } = await supabase
    .from("gap_assessments")
    .select("code, name, scope_description, partial_weight, gap_assessment_frameworks(framework:frameworks(id, code, name, created_at))")
    .eq("id", id)
    .maybeSingle();
  if (!gap) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const fws = ((gap.gap_assessment_frameworks as unknown as { framework: { id: string; code: string; name: string; created_at: string } | null }[]) ?? [])
    .map((f) => f.framework!)
    .filter(Boolean)
    .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.code.localeCompare(b.code));
  const fw = new Map(fws.map((f, i) => [f.id, { ...f, order: i }]));
  const { data } = await supabase
    .from("gap_items_effective")
    .select("id, primary_item_id, status, justification, evidence_note, validated_at, framework_id, clause, title, criticality, top_clause, top_title, sort_key")
    .eq("assessment_id", id)
    .order("sort_key")
    .limit(5000);
  const rows = (data ?? []).sort((a, b) => (fw.get(a.framework_id as string)?.order ?? 0) - (fw.get(b.framework_id as string)?.order ?? 0));
  const byId = new Map(rows.map((r) => [r.id as string, r]));
  const items: GapSheetItem[] = rows.map((r) => {
    const p = r.primary_item_id ? byId.get(r.primary_item_id as string) : undefined;
    return {
      framework: fw.get(r.framework_id as string)?.code ?? "",
      frameworkName: fw.get(r.framework_id as string)?.name ?? "",
      clause: r.clause as string,
      title: r.title as string,
      topClause: r.top_clause as string,
      topTitle: r.top_title as string,
      criticality: r.criticality as number,
      status: r.status as string | null,
      justification: r.justification as string | null,
      evidence: r.evidence_note as string | null,
      commonWith: p ? `${fw.get(p.framework_id as string)?.code ?? ""} ${p.clause as string}` : null,
      validated: Boolean(r.validated_at),
    };
  });
  await supabase.rpc("log_event", { p_action: "EXPORT", p_detail: { objeto: "gap", codigo: gap.code, filas: items.length } });
  const bytes = buildXlsx(
    buildGapWorkbook({
      orgName: state.ctx.organization.name,
      brandColor: state.ctx.organization.brand_color ?? undefined,
      code: gap.code as string,
      name: gap.name as string,
      scope: gap.scope_description as string | null,
      partialWeight: Number(gap.partial_weight),
      items,
    }),
  );
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${gap.code}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
