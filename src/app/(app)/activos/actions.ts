"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { isUuid, oneOf, optDate, optText, optUuid } from "@/lib/forms-parse";
import { isIp, NAME_MAX } from "@/lib/asset-profiles";
import { ASSET_STATUS, keysOf } from "@/lib/labels";
import { mapAssetRows, type MappingResult } from "@/lib/asset-import";
import { getCatalog, getPeople } from "@/lib/lookups";
import { getAssetTypes, getScale } from "@/lib/asset-lookups";

/** Solo incluye los campos que el formulario envió (los ocultos por el tipo no se tocan). */
function assetRecord(fd: FormData): { record: Record<string, unknown>; error?: string } {
  const r: Record<string, unknown> = {};
  const has = (k: string) => fd.has(k);
  if (has("code")) r.code = str(fd, "code").slice(0, 60) || null;
  if (has("asset_type_id")) r.asset_type_id = optUuid(fd, "asset_type_id");
  if (has("name")) {
    const name = str(fd, "name");
    if (name.length > NAME_MAX) return { record: r, error: `El nombre del activo admite máximo ${NAME_MAX} caracteres.` };
    r.name = name || null;
  }
  if (has("description")) r.description = optText(fd, "description");
  if (has("owner_id")) r.owner_id = optUuid(fd, "owner_id");
  if (has("custodian")) r.custodian = optText(fd, "custodian", 200);
  if (has("location")) r.location = optText(fd, "location", 200);
  if (has("classification_id")) r.classification_id = optUuid(fd, "classification_id");
  for (const k of ["confidentiality", "integrity", "availability"] as const) if (has(k)) r[k] = optLevel5(fd, k);
  if (has("status")) r.status = oneOf(fd, "status", keysOf(ASSET_STATUS), "activo");
  if (has("brand")) r.brand = optText(fd, "brand", 120);
  if (has("model")) r.model = optText(fd, "model", 120);
  if (has("serial_number")) r.serial_number = optText(fd, "serial_number", 120);
  if (has("operating_system")) r.operating_system = optText(fd, "operating_system", 120);
  if (has("acquired_on")) r.acquired_on = optDate(fd, "acquired_on");
  if (has("ip_address")) {
    const ip = str(fd, "ip_address");
    if (ip && !isIp(ip)) return { record: r, error: `«${ip}» no es una dirección IP válida.` };
    r.ip_address = ip || null;
  }
  return { record: r };
}

function optLevel5(fd: FormData, key: string): number | null {
  const v = Number(fd.get(key));
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

/** Mensaje claro para errores de la base (identificador faltante, duplicado…). */
function assetDbMessage(error: { code?: string; message?: string } | null): string {
  if (error?.code === "23502" && error.message?.startsWith("Falta el identificador")) return error.message + ".";
  if (error?.code === "23505") return "Ya existe un activo con ese identificador.";
  return dbMessage(error, "No se pudo guardar el activo.");
}

export async function createAsset(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const { record, error: formError } = assetRecord(formData);
  if (formError) fail("/activos/nuevo", formError);
  if (!record.asset_type_id) fail("/activos/nuevo", "Selecciona el tipo de activo.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .insert({ ...record, organization_id: ctx.organization.id })
    .select("id, code")
    .single();
  if (error || !data) fail("/activos/nuevo", assetDbMessage(error));
  await saveAssetProcesses(data.id as string, formData, ctx.organization.id);
  revalidatePath("/activos");
  redirect(`/activos/${data.id}?ok=${encodeURIComponent(`Activo ${data.code} registrado.`)}`);
}

export async function updateAsset(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/activos", "Activo no válido.");
  const path = `/activos/${id}`;
  const { record, error: formError } = assetRecord(formData);
  if (formError) fail(path, formError);
  if (!record.asset_type_id) fail(path, "Selecciona el tipo de activo.");
  if (record.code === null) delete record.code; // conserva el identificador actual
  const supabase = await createClient();
  const { error } = await supabase.from("assets").update(record).eq("id", id);
  if (error) fail(path, assetDbMessage(error));
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

  const [assetTypes, classifications, people, scale] = await Promise.all([
    getAssetTypes(),
    getCatalog("info_classification"),
    getPeople(),
    getScale(),
  ]);
  const mapped = mapAssetRows(rawRows, {
    assetTypes,
    classifications,
    profiles: people.map((p) => ({ id: p.id, name: p.label, email: p.code })),
    scale,
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
