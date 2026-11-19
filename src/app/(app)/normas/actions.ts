"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optLevel, optText, optUuid } from "@/lib/forms-parse";
import { FRAMEWORK_TYPES, keysOf } from "@/lib/labels";
import { mapRequirementRows } from "@/lib/requirements-import";
import { ISO27001_TEMPLATE } from "@/lib/templates/iso27001";

export async function createFramework(formData: FormData) {
  const ctx = await requirePermission("frameworks.write");
  const code = str(formData, "code").replace(/\s+/g, "").slice(0, 40);
  const name = str(formData, "name");
  if (!/^[A-Za-z0-9._-]{2,40}$/.test(code) || name.length < 2) fail("/normas", "Escribe un código (sin espacios) y un nombre.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("frameworks")
    .insert({
      organization_id: ctx.organization.id,
      code,
      name,
      version: str(formData, "version").slice(0, 20),
      framework_type: oneOf(formData, "framework_type", keysOf(FRAMEWORK_TYPES), "certificable"),
      description: optText(formData, "description"),
    })
    .select("id")
    .single();
  if (error || !data) fail("/normas", dbMessage(error, "No se pudo crear la norma."));
  revalidatePath("/normas");
  redirect(`/normas/${data.id}?ok=${encodeURIComponent("Norma creada. Ahora importa o agrega sus requisitos.")}`);
}

export async function loadIso27001() {
  const ctx = await requirePermission("frameworks.write");
  const t = ISO27001_TEMPLATE;
  const supabase = await createClient();
  const { data: existing } = await supabase.from("frameworks").select("id").eq("code", t.code).eq("version", t.version).maybeSingle();
  let id = existing?.id as string | undefined;
  if (!id) {
    const { data, error } = await supabase
      .from("frameworks")
      .insert({
        organization_id: ctx.organization.id,
        code: t.code,
        name: t.name,
        version: t.version,
        framework_type: t.framework_type,
        description: t.description,
        source: "plantilla",
      })
      .select("id")
      .single();
    if (error || !data) fail("/normas", dbMessage(error, "No se pudo crear la norma."));
    id = data.id as string;
  }
  const { error } = await supabase.rpc("import_requirements", { p_framework_id: id, p_rows: t.rows });
  if (error) fail("/normas", error.message || "No se pudo cargar la estructura.");
  revalidatePath("/normas");
  redirect(`/normas/${id}?ok=${encodeURIComponent(`Estructura de ISO/IEC 27001:2022 cargada (${t.rows.length} requisitos).`)}`);
}

export type RequirementImportResult = {
  ok: boolean;
  errors?: string[];
  result?: { nuevos: number; actualizados: number; total: number };
};

export async function importRequirements(
  frameworkId: string,
  rawRows: Record<string, unknown>[],
): Promise<RequirementImportResult> {
  await requirePermission("frameworks.write");
  if (!/^[0-9a-f-]{36}$/.test(frameworkId)) return { ok: false, errors: ["Norma no válida."] };
  const { rows, errors } = mapRequirementRows(Array.isArray(rawRows) ? rawRows.slice(0, 3001) : []);
  if (errors.length) return { ok: false, errors };
  if (!rows.length) return { ok: false, errors: ["El archivo no tiene requisitos."] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_requirements", { p_framework_id: frameworkId, p_rows: rows });
  if (error) return { ok: false, errors: [error.message] };
  revalidatePath(`/normas/${frameworkId}`);
  return { ok: true, result: data as { nuevos: number; actualizados: number; total: number } };
}

export async function saveRequirement(formData: FormData) {
  await requirePermission("frameworks.write");
  const frameworkId = optUuid(formData, "framework_id");
  if (!frameworkId) fail("/normas", "Norma no válida.");
  const path = `/normas/${frameworkId}`;
  const id = optUuid(formData, "id");
  const clause = str(formData, "clause").replace(/\s+/g, "").replace(/\.$/, "");
  const title = str(formData, "title");
  if (!clause || !title) fail(path, "La cláusula y el título son obligatorios.");
  const supabase = await createClient();
  const row = {
    clause: clause.slice(0, 30),
    title: title.slice(0, 300),
    description: optText(formData, "description", 5000),
    evidence_guidance: optText(formData, "evidence_guidance", 3000),
    criticality: optLevel(formData, "criticality") ?? 2,
    is_auditable: formData.get("is_auditable") === "on",
  };
  if (id) {
    const { error } = await supabase.from("requirements").update(row).eq("id", id);
    if (error) fail(path, dbMessage(error, "No se pudo guardar el requisito."));
  } else {
    // Pasa por la importación para calcular la jerarquía
    const { error } = await supabase.rpc("import_requirements", { p_framework_id: frameworkId, p_rows: [row] });
    if (error) fail(path, error.message || "No se pudo crear el requisito.");
  }
  revalidatePath(path);
  done(path, id ? "Requisito actualizado." : `Requisito ${clause} agregado.`);
}

export async function toggleFramework(formData: FormData) {
  await requirePermission("frameworks.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/normas", "Norma no válida.");
  const supabase = await createClient();
  const { error } = await supabase.from("frameworks").update({ active: str(formData, "active") === "true" }).eq("id", id);
  if (error) fail(`/normas/${id}`, dbMessage(error, "No se pudo cambiar el estado."));
  revalidatePath("/normas");
  done(`/normas/${id}`, "Estado de la norma actualizado.");
}
