"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { isUuid, oneOf, optDate, optLevel, optText, optUuid } from "@/lib/forms-parse";
import { ASSET_STATUS, keysOf } from "@/lib/labels";
import { mapAssetRows, type MappingResult } from "@/lib/asset-import";
import { getCatalog, getPeople, getUnits } from "@/lib/lookups";

function assetRecord(fd: FormData) {
  return {
    code: str(fd, "code").slice(0, 60),
    name: str(fd, "name").slice(0, 200),
    asset_type_id: optUuid(fd, "asset_type_id"),
    description: optText(fd, "description"),
    owner_id: optUuid(fd, "owner_id"),
    custodian: optText(fd, "custodian", 200),
    unit_id: optUuid(fd, "unit_id"),
    location: optText(fd, "location", 200),
    classification_id: optUuid(fd, "classification_id"),
    confidentiality: optLevel(fd, "confidentiality"),
    integrity: optLevel(fd, "integrity"),
    availability: optLevel(fd, "availability"),
    status: oneOf(fd, "status", keysOf(ASSET_STATUS), "activo"),
    brand: optText(fd, "brand", 200),
    model: optText(fd, "model", 200),
    serial_number: optText(fd, "serial_number", 200),
    acquired_on: optDate(fd, "acquired_on"),
  };
}

export async function createAsset(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const rec = assetRecord(formData);
  if (!rec.code || !rec.name || !rec.asset_type_id) fail("/activos/nuevo", "Código, nombre y tipo son obligatorios.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .insert({ ...rec, organization_id: ctx.organization.id })
    .select("id")
    .single();
  if (error || !data) fail("/activos/nuevo", dbMessage(error, "No se pudo registrar el activo."));
  await saveAssetProcesses(data.id as string, formData, ctx.organization.id);
  revalidatePath("/activos");
  redirect(`/activos/${data.id}?ok=${encodeURIComponent("Activo registrado.")}`);
}

export async function updateAsset(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/activos", "Activo no válido.");
  const path = `/activos/${id}`;
  const rec = assetRecord(formData);
  if (!rec.code || !rec.name || !rec.asset_type_id) fail(path, "Código, nombre y tipo son obligatorios.");
  const supabase = await createClient();
  const { error } = await supabase.from("assets").update(rec).eq("id", id);
  if (error) fail(path, dbMessage(error, "No se pudo guardar el activo."));
  await saveAssetProcesses(id, formData, ctx.organization.id);
  revalidatePath("/activos");
  done(path, "Cambios guardados.");
}

async function saveAssetProcesses(assetId: string, formData: FormData, orgId: string) {
  const wanted = formData.getAll("process_ids").map(String).filter(isUuid);
  const supabase = await createClient();
  const { data: current } = await supabase.from("asset_processes").select("process_id").eq("asset_id", assetId);
  const have = new Set((current ?? []).map((r) => r.process_id as string));
  const toRemove = [...have].filter((p) => !wanted.includes(p));
  const toAdd = wanted.filter((p) => !have.has(p));
  if (toRemove.length) await supabase.from("asset_processes").delete().eq("asset_id", assetId).in("process_id", toRemove);
  if (toAdd.length)
    await supabase.from("asset_processes").insert(toAdd.map((process_id) => ({ organization_id: orgId, asset_id: assetId, process_id })));
}

// ---------------------------------------------------------------------
// Importación masiva
// ---------------------------------------------------------------------
export type ImportPreview = {
  ok: boolean;
  message?: string;
  mapping?: MappingResult["mapping"];
  warnings?: string[];
  errors?: string[];
  summary?: {
    import_id: string | null;
    total: number;
    nuevos: number;
    modificados: number;
    sin_cambios: number;
    ausentes: number;
    lista_nuevos: string[];
    lista_modificados: { code: string; cambios: Record<string, { antes: unknown; ahora: unknown }> }[];
    lista_ausentes: string[];
  };
};

const MAX_ROWS = 5000;

/** Analiza (apply=false) o aplica (apply=true) un archivo ya leído en el navegador. */
export async function processAssetImport(
  fileName: string,
  rawRows: Record<string, unknown>[],
  apply: boolean,
): Promise<ImportPreview> {
  await requirePermission("assets.write");
  if (!Array.isArray(rawRows) || rawRows.length === 0) return { ok: false, message: "El archivo no tiene filas." };
  if (rawRows.length > MAX_ROWS) return { ok: false, message: "El archivo supera 5.000 filas." };

  const [assetTypes, classifications, units, people] = await Promise.all([
    getCatalog("asset_type"),
    getCatalog("info_classification"),
    getUnits(),
    getPeople(),
  ]);
  const mapped = mapAssetRows(rawRows, {
    assetTypes,
    classifications,
    units: units.map((u) => ({ id: u.id, code: u.code, name: u.label })),
    profiles: people.map((p) => ({ id: p.id, name: p.label, email: p.code })),
  });
  if (mapped.errors.length) return { ok: false, mapping: mapped.mapping, warnings: mapped.warnings, errors: mapped.errors };

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_assets", {
    p_file_name: String(fileName).slice(0, 200),
    p_fields: mapped.fields,
    p_rows: mapped.rows,
    p_apply: apply,
  });
  if (error) return { ok: false, mapping: mapped.mapping, message: error.message || "No se pudo procesar el archivo." };
  if (apply) revalidatePath("/activos");
  return { ok: true, mapping: mapped.mapping, warnings: mapped.warnings, summary: data as ImportPreview["summary"] };
}
