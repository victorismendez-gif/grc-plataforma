import { NextResponse, type NextRequest } from "next/server";
import { getSessionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog, getPeople, getProcesses } from "@/lib/lookups";
import { getAssetTypes, getScale } from "@/lib/asset-lookups";
import { buildAssetTemplate, type TemplateAsset } from "@/lib/asset-template";
import { buildXlsx } from "@/lib/xlsx-writer";
import { ASSET_STATUS } from "@/lib/labels";

const BATCH = 1000;
const MAX = 10000;

/**
 * GET /activos/plantilla          → plantilla vacía con instrucciones
 * GET /activos/plantilla?datos=1  → inventario actual en el mismo formato
 */
export async function GET(request: NextRequest) {
  const state = await getSessionState();
  if (state.status !== "ok" || !state.ctx.can("assets.read")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  const ctx = state.ctx;
  const withData = request.nextUrl.searchParams.get("datos") === "1";
  const [types, classes, people, scale, processes] = await Promise.all([
    getAssetTypes(),
    getCatalog("info_classification"),
    getPeople(),
    getScale(),
    getProcesses(),
  ]);

  let assets: TemplateAsset[] | undefined;
  if (withData) {
    const supabase = await createClient();
    const typeName = new Map(types.map((t) => [t.id, t.label]));
    const className = new Map(classes.map((c) => [c.id, c.label]));
    const email = new Map(people.map((p) => [p.id, p.code ?? ""]));
    const processName = new Map(processes.map((p) => [p.id, p.label]));
    assets = [];
    for (let offset = 0; offset < MAX; offset += BATCH) {
      const { data, error } = await supabase
        .from("assets")
        .select("code, asset_type_id, name, ip_address, status, brand, model, operating_system, serial_number, owner_id, owner_text, process_id, custodian, custodian_email, location, acquired_on, description, classification_id, confidentiality, integrity, availability, attributes")
        .order("code")
        .range(offset, offset + BATCH - 1);
      if (error) return NextResponse.json({ error: "No se pudo exportar" }, { status: 500 });
      for (const a of data ?? []) {
        assets.push({
          code: a.code as string,
          type: typeName.get(a.asset_type_id as string) ?? "Otro",
          name: a.name as string,
          ip_address: (a.ip_address as string | null) ?? null,
          status: ASSET_STATUS[a.status as keyof typeof ASSET_STATUS] ?? null,
          brand: a.brand as string | null,
          model: a.model as string | null,
          operating_system: a.operating_system as string | null,
          serial_number: a.serial_number as string | null,
          owner_email: a.owner_id ? email.get(a.owner_id as string) ?? null : (a.owner_text as string | null) ?? null,
          custodian: a.custodian as string | null,
          custodian_email: (a.custodian_email as string | null) ?? null,
          location: a.location as string | null,
          acquired_on: a.acquired_on as string | null,
          description: a.description as string | null,
          process: a.process_id ? processName.get(a.process_id as string) ?? null : null,
          classification: a.classification_id ? className.get(a.classification_id as string) ?? null : null,
          confidentiality: a.confidentiality as number | null,
          integrity: a.integrity as number | null,
          availability: a.availability as number | null,
          attributes: (a.attributes as Record<string, string>) ?? {},
        });
      }
      if ((data ?? []).length < BATCH) break;
    }
    await supabase.rpc("log_event", { p_action: "EXPORT", p_detail: { objeto: "assets", filas: assets.length } });
  }

  const workbook = buildAssetTemplate({
    orgName: ctx.organization.name,
    brandColor: ctx.organization.brand_color,
    types,
    classifications: classes.map((c) => c.label),
    scale,
    people: people.map((p) => ({ name: p.label, email: p.code ?? "" })).filter((p) => p.email),
    processes: processes.map((p) => p.label),
    assets,
  });
  const bytes = buildXlsx(workbook);
  const stamp = new Date().toISOString().slice(0, 10);
  const name = withData ? `inventario-activos-${stamp}.xlsx` : `plantilla-carga-activos.xlsx`;
  return new NextResponse(Buffer.from(bytes), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${name}"`,
      "Cache-Control": "no-store",
    },
  });
}
