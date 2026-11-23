"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/forms";
import { optUuid } from "@/lib/forms-parse";
import { assetDbMessage, assetRecord } from "@/lib/asset-record";
import { mapAssetRows } from "@/lib/asset-import";
import { getCatalog, getPeople } from "@/lib/lookups";
import { getAssetTypes, getScale } from "@/lib/asset-lookups";
import { humanizeChanges, lookupNames, resolveImportProcesses, resolveProcess, resolveResponsible } from "@/lib/resolve";

export async function createAsset(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const { record, error: formError } = assetRecord(formData);
  if (formError) fail("/activos/nuevo", formError);
  if (!record.asset_type_id) fail("/activos/nuevo", "Selecciona el tipo de activo.");
  const linkError = await linkFields(formData, record);
  if (linkError) fail("/activos/nuevo", linkError);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    .insert({ ...record, organization_id: ctx.organization.id })
    .select("id, code")
    .single();
  if (error || !data) fail("/activos/nuevo", assetDbMessage(error));
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
  const linkError = await linkFields(formData, record);
  if (linkError) fail(path, linkError);
  const supabase = await createClient();
  const { error } = await supabase.from("assets").update(record).eq("id", id);
  if (error) fail(path, assetDbMessage(error));
  revalidatePath("/activos");
  done(path, "Cambios guardados.");
}

/** Responsable (usuario o texto) y proceso (existente o nuevo). */
async function linkFields(fd: FormData, record: Record<string, unknown>): Promise<string | null> {
  if (fd.has("owner")) {
    const owner = await resolveResponsible(fd.get("owner")?.toString());
    record.owner_id = owner.id;
    record.owner_text = owner.text;
  }
  if (fd.has("process")) {
    const proc = await resolveProcess(fd.get("process")?.toString());
    if (proc.error) return proc.error;
    record.process_id = proc.id;
  }
  return null;
}

// ---------------------------------------------------------------------
// Importación masiva
// ---------------------------------------------------------------------
export type ImportPreview = {
  ok: boolean;
  message?: string;
  /** encabezado del archivo → campo de la plataforma */
  mapping?: Record<string, string>;
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

  const procs = await resolveImportProcesses(mapped.rows, apply);
  if (procs.error) return { ok: false, mapping: mapped.mapping, errors: [procs.error] };
  const warnings = [...mapped.warnings];
  if (procs.created.length) {
    warnings.unshift(`${apply ? "Se crearon" : "Se crearán"} ${procs.created.length} proceso(s) nuevo(s) en Estructura: ${procs.created.slice(0, 15).join(", ")}${procs.created.length > 15 ? "…" : ""}.`);
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_assets", {
    p_file_name: String(fileName).slice(0, 200),
    p_fields: mapped.fields,
    p_rows: mapped.rows,
    p_apply: apply,
  });
  if (error) return { ok: false, mapping: mapped.mapping, message: error.message || "No se pudo procesar el archivo." };
  if (apply) revalidatePath("/activos");
  const summary = data as ImportPreview["summary"];
  const names = await lookupNames([assetTypes.map((t) => ({ id: t.id, label: t.label })), classifications]);
  for (const [k, v] of procs.names) names.set(k, v);
  humanizeChanges(summary, names);
  return { ok: true, mapping: mapped.mapping, warnings, summary };
}
