import { NextResponse, type NextRequest } from "next/server";
import { getSessionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, getProcesses } from "@/lib/lookups";
import { buildControlTemplate, type ControlRow } from "@/lib/control-template";
import { buildXlsx } from "@/lib/xlsx-writer";
import { CONTROL_FIELDS } from "@/lib/control-fields";

/**
 * GET /controles/plantilla          → plantilla vacía con instrucciones
 * GET /controles/plantilla?datos=1  → controles actuales en el mismo formato
 */
export async function GET(request: NextRequest) {
  const state = await getSessionState();
  if (state.status !== "ok" || !state.ctx.can("controls.read")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const ctx = state.ctx;
  const withData = request.nextUrl.searchParams.get("datos") === "1";
  const [people, processes] = await Promise.all([getPeople(), getProcesses()]);

  let controls: ControlRow[] | undefined;
  if (withData) {
    const supabase = await createClient();
    const { data, error } = await supabase
      .from("controls")
      .select("code, name, description, owner_id, owner_text, process_id, control_type, nature, frequency, documentation, evidence, design_rating, application_rating, effectiveness_rating, implementation_status")
      .eq("active", true)
      .order("code")
      .limit(3000);
    if (error) return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });
    const email = new Map(people.map((p) => [p.id, p.code ?? p.label]));
    const processName = new Map(processes.map((p) => [p.id, p.label]));
    const opt = (field: string, v: unknown) => {
      if (v === null || v === undefined) return null;
      const d = CONTROL_FIELDS.find((x) => x.field === field);
      return d?.options ? (d.options as Record<string, string>)[String(v)] ?? String(v) : String(v);
    };
    controls = (data ?? []).map((c) => ({
      code: c.code as string,
      name: c.name as string,
      description: c.description as string | null,
      owner: c.owner_id ? email.get(c.owner_id as string) ?? null : (c.owner_text as string | null),
      process: c.process_id ? processName.get(c.process_id as string) ?? null : null,
      control_type: opt("control_type", c.control_type),
      nature: opt("nature", c.nature),
      frequency: opt("frequency", c.frequency),
      documentation: opt("documentation", c.documentation),
      evidence: opt("evidence", c.evidence),
      design_rating: opt("design_rating", c.design_rating),
      application_rating: opt("application_rating", c.application_rating),
      effectiveness_rating: opt("effectiveness_rating", c.effectiveness_rating),
      implementation_status: opt("implementation_status", c.implementation_status),
    }));
    await supabase.rpc("log_event", { p_action: "EXPORT", p_detail: { objeto: "controls", filas: controls.length } });
  }

  const bytes = buildXlsx(
    buildControlTemplate({
      orgName: ctx.organization.name,
      brandColor: ctx.organization.brand_color,
      people: people.map((p) => ({ name: p.label, email: p.code ?? "" })).filter((p) => p.email),
      processes: processes.map((p) => p.label),
      controls,
    }),
  );
  const stamp = new Date().toISOString().slice(0, 10);
  const name = withData ? `controles-${stamp}.xlsx` : "plantilla-carga-controles.xlsx";
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
