"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optDate, optInt, optText, optUuid } from "@/lib/forms-parse";
import { keysOf, PROCESS_TYPES, PROCESS_TYPOLOGY } from "@/lib/labels";
import { resolveResponsible } from "@/lib/resolve";
import { mapMasterRows } from "@/lib/process-master";

const BASE = "/procesos";

export async function saveProcess(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  const path = id ? `${BASE}/${id}` : BASE;
  const name = str(formData, "name").replace(/\s+/g, " ").slice(0, 160);
  if (name.length < 2) fail(path, "El nombre del proceso debe tener al menos 2 caracteres.");
  const code = str(formData, "code").replace(/\s+/g, "").slice(0, 60) || null;
  const owner = await resolveResponsible(str(formData, "owner"));
  const classification = str(formData, "process_type");
  const record = {
    name,
    code,
    typology: oneOf(formData, "typology", keysOf(PROCESS_TYPOLOGY), "proceso"),
    parent_id: optUuid(formData, "parent_id"),
    process_type: classification && classification in PROCESS_TYPES ? classification : null,
    criticality: optInt(formData, "criticality", 1, 5),
    lead_area: optText(formData, "lead_area", 160),
    version: optText(formData, "version", 20),
    valid_from: optDate(formData, "valid_from"),
    owner_id: owner.id,
    owner_text: owner.text,
    description: optText(formData, "description"),
  };
  if (record.parent_id && record.parent_id === id) fail(path, "Un proceso no puede depender de sí mismo.");
  const supabase = await createClient();
  let processId = id;
  if (id) {
    const { error } = await supabase.from("processes").update(record).eq("id", id);
    if (error) fail(path, error.code === "23514" && /depender/.test(error.message) ? "Un proceso no puede depender de sí mismo ni de uno de sus subprocesos." : dbMessage(error, "No se pudo guardar el proceso."));
  } else {
    const { data, error } = await supabase.from("processes").insert({ ...record, organization_id: ctx.organization.id }).select("id").single();
    if (error || !data) fail(path, dbMessage(error, "No se pudo crear el proceso."));
    processId = data.id as string;
  }
  // Unidades donde opera el proceso
  if (formData.has("units_present")) {
    const units = formData.getAll("unit_ids").map(String).filter(Boolean);
    await supabase.from("process_units").delete().eq("process_id", processId!)
      .not("unit_id", "in", `(${units.join(",") || "00000000-0000-0000-0000-000000000000"})`);
    if (units.length) {
      const { error } = await supabase.from("process_units").upsert(
        units.map((unit_id) => ({ organization_id: ctx.organization.id, process_id: processId!, unit_id })),
        { onConflict: "process_id,unit_id", ignoreDuplicates: true },
      );
      if (error) fail(path, dbMessage(error, "Proceso guardado, pero no se pudieron asociar las unidades."));
    }
  }
  revalidatePath(BASE);
  if (!id) redirect(`${BASE}/${processId}?ok=${encodeURIComponent(`Proceso «${name}» creado.`)}`);
  done(path, "Proceso actualizado.");
}

export async function toggleProcess(formData: FormData) {
  await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Proceso no válido.");
  const supabase = await createClient();
  const { error } = await supabase.from("processes").update({ active: str(formData, "active") === "true" }).eq("id", id);
  if (error) fail(`${BASE}/${id}`, dbMessage(error, "No se pudo cambiar el estado."));
  revalidatePath(BASE);
  done(`${BASE}/${id}`, "Estado del proceso actualizado.");
}

export type MasterImportResult = {
  ok: boolean;
  errors?: string[];
  warnings?: string[];
  procesos_nuevos?: number;
  procesos_existentes?: number;
  documentos_nuevos?: number;
  documentos_existentes?: number;
  sin_padre?: number;
  omitidos?: number;
};

/** Carga el listado maestro: vista previa (apply=false) o aplicar. */
export async function importMaster(raw: Record<string, unknown>[], apply: boolean, headerLine = 1): Promise<MasterImportResult> {
  await requirePermission("assets.write");
  await requirePermission("documents.write");
  if (!Array.isArray(raw) || raw.length > 20000) return { ok: false, errors: ["El archivo debe tener entre 1 y 20.000 filas."] };
  const mapped = mapMasterRows(raw, headerLine);
  if (mapped.errors.length) return { ok: false, errors: mapped.errors, warnings: mapped.warnings, omitidos: mapped.skipped };
  if (!mapped.rows.length) return { ok: false, errors: ["No hay filas vigentes para cargar."], omitidos: mapped.skipped };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("process_master_import", { p_rows: mapped.rows, p_apply: apply });
  if (error) return { ok: false, errors: [dbMessage(error, "No se pudo cargar el archivo.")] };
  const r = data as Record<string, unknown>;
  const errs = (r.errores as string[]) ?? [];
  const avisos = ((r.avisos as string[]) ?? []).map((a) => `Sin padre en la plataforma: ${a}`);
  if (apply) revalidatePath(BASE);
  return {
    ok: errs.length === 0,
    errors: errs,
    warnings: [...mapped.warnings, ...avisos].slice(0, 150),
    procesos_nuevos: Number(r.procesos_nuevos ?? 0),
    procesos_existentes: Number(r.procesos_existentes ?? 0),
    documentos_nuevos: Number(r.documentos_nuevos ?? 0),
    documentos_existentes: Number(r.documentos_existentes ?? 0),
    sin_padre: Number(r.sin_padre ?? 0),
    omitidos: mapped.skipped,
  };
}
