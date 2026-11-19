import { NextResponse, type NextRequest } from "next/server";
import { getSessionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { parseAuditFilters, toCsv, type AuditRow } from "@/lib/audit";
import { queryAudit } from "@/lib/audit-query";

const MAX_ROWS = 10000;
const BATCH = 1000;

export async function GET(request: NextRequest) {
  const state = await getSessionState();
  if (state.status !== "ok" || !state.ctx.can("audit_log.read")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const filters = parseAuditFilters(Object.fromEntries(request.nextUrl.searchParams));
  // La API entrega como máximo 1.000 filas por consulta: se lee por lotes.
  const rows: AuditRow[] = [];
  for (let offset = 0; offset < MAX_ROWS; offset += BATCH) {
    const { rows: batch, error } = await queryAudit(filters, offset, BATCH);
    if (error) return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });
    rows.push(...batch);
    if (batch.length < BATCH) break;
  }

  const supabase = await createClient();
  await supabase.rpc("log_event", { p_action: "EXPORT", p_detail: { objeto: "audit_log", filtros: filters, filas: rows.length } });

  const stamp = new Date().toISOString().slice(0, 10);
  return new NextResponse(toCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="trazabilidad-${stamp}.csv"`,
      "Cache-Control": "no-store",
    },
  });
}
