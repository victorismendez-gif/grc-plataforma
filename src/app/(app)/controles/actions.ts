"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optLevel, optText, optUuid } from "@/lib/forms-parse";
import { CONTROL_NATURE, CONTROL_TYPES, DOCUMENTATION, EVIDENCE, FREQUENCIES, IMPLEMENTATION, keysOf } from "@/lib/labels";
import { CONTROL_CODE_RE, defaultEffectiveness } from "@/lib/control-fields";
import { mapControlRows } from "@/lib/control-import";
import { getPeople } from "@/lib/lookups";
import { normalize } from "@/lib/text";
import type { ImportPreview } from "../activos/actions";

async function controlRecord(fd: FormData) {
  const design = optLevel(fd, "design_rating");
  const application = optLevel(fd, "application_rating");
  // Responsable: si coincide con un usuario se enlaza; si no, se guarda el texto
  const ownerText = str(fd, "owner").slice(0, 120);
  let owner_id: string | null = null;
  let owner_text: string | null = null;
  if (ownerText) {
    const people = await getPeople();
    const n = normalize(ownerText);
    const hit = people.find((p) => normalize(p.label) === n || normalize(p.code) === n);
    if (hit) owner_id = hit.id;
    else owner_text = ownerText;
  }
  return {
    code: str(fd, "code").replace(/\s+/g, "").slice(0, 30),
    name: str(fd, "name").slice(0, 200),
    description: optText(fd, "description", 5000),
    owner_id,
    owner_text,
    control_type: oneOf(fd, "control_type", keysOf(CONTROL_TYPES), "preventivo"),
    nature: oneOf(fd, "nature", keysOf(CONTROL_NATURE), "manual"),
    frequency: oneOf(fd, "frequency", keysOf(FREQUENCIES), "continuo"),
    documentation: (fd.get("documentation")?.toString() || null) as string | null,
    evidence: (fd.get("evidence")?.toString() || null) as string | null,
    design_rating: design,
    application_rating: application,
    effectiveness_rating: defaultEffectiveness(design, application, optLevel(fd, "effectiveness_rating")),
    implementation_status: oneOf(fd, "implementation_status", keysOf(IMPLEMENTATION), "planeado"),
  };
}

function validControl(rec: Awaited<ReturnType<typeof controlRecord>>): string | null {
  if (!CONTROL_CODE_RE.test(rec.code)) return "El ID solo admite letras, números, punto, guion y guion bajo, sin espacios (máx. 30).";
  if (rec.name.length < 2) return "Escribe el nombre del control.";
  if (rec.documentation && !(rec.documentation in DOCUMENTATION)) return "Documentación no válida.";
  if (rec.evidence && !(rec.evidence in EVIDENCE)) return "Evidencia no válida.";
  return null;
}

export async function createControl(formData: FormData) {
  const ctx = await requirePermission("controls.write");
  const rec = await controlRecord(formData);
  const problem = validControl(rec);
  if (problem) fail("/controles/nuevo", problem);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("controls")
    .insert({ ...rec, organization_id: ctx.organization.id })
    .select("id")
    .single();
  if (error || !data) fail("/controles/nuevo", error?.code === "23505" ? `Ya existe un control con el ID ${rec.code}.` : dbMessage(error, "No se pudo crear el control."));
  revalidatePath("/controles");
  redirect(`/controles/${data.id}?ok=${encodeURIComponent("Control creado. Asócialo a requisitos y activos.")}`);
}

export async function updateControl(formData: FormData) {
  await requirePermission("controls.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/controles", "Control no válido.");
  const rec = await controlRecord(formData);
  const problem = validControl(rec);
  if (problem) fail(`/controles/${id}`, problem);
  const supabase = await createClient();
  const { error } = await supabase.from("controls").update(rec).eq("id", id);
  if (error) fail(`/controles/${id}`, error.code === "23505" ? `Ya existe un control con el ID ${rec.code}.` : dbMessage(error, "No se pudo guardar."));
  revalidatePath("/controles");
  done(`/controles/${id}`, "Control actualizado.");
}

/** Analiza (apply=false) o aplica (apply=true) un archivo de controles leído en el navegador. */
export async function processControlImport(
  fileName: string,
  rawRows: Record<string, unknown>[],
  apply: boolean,
): Promise<ImportPreview> {
  await requirePermission("controls.write");
  if (!Array.isArray(rawRows) || rawRows.length === 0) return { ok: false, message: "El archivo no tiene filas." };
  if (rawRows.length > 3000) return { ok: false, errors: ["El archivo supera 3.000 controles."] };
  const people = await getPeople();
  const mapped = mapControlRows(rawRows, people.map((p) => ({ id: p.id, name: p.label, email: p.code })));
  if (mapped.errors.length) return { ok: false, mapping: mapped.mapping, warnings: mapped.warnings, errors: mapped.errors };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("import_controls", { p_fields: mapped.fields, p_rows: mapped.rows, p_apply: apply });
  if (error) return { ok: false, errors: [error.message || "No se pudo procesar el archivo."] };
  if (apply) revalidatePath("/controles");
  void fileName;
  return { ok: true, mapping: mapped.mapping, warnings: mapped.warnings, summary: data as ImportPreview["summary"] };
}

export async function linkRequirement(formData: FormData) {
  const ctx = await requirePermission("controls.write");
  const controlId = optUuid(formData, "control_id");
  const requirementIds = formData.getAll("requirement_id").map(String).filter((v) => /^[0-9a-f-]{36}$/.test(v));
  if (!controlId) fail("/controles", "Control no válido.");
  if (!requirementIds.length) fail(`/controles/${controlId}`, "Selecciona al menos un requisito.");
  const supabase = await createClient();
  const { error } = await supabase.from("control_requirements").upsert(
    requirementIds.map((requirement_id) => ({ organization_id: ctx.organization.id, control_id: controlId, requirement_id })),
    { onConflict: "control_id,requirement_id", ignoreDuplicates: true },
  );
  if (error) fail(`/controles/${controlId}`, dbMessage(error, "No se pudo asociar."));
  revalidatePath(`/controles/${controlId}`);
  done(`/controles/${controlId}`, `${requirementIds.length} requisito(s) asociado(s).`);
}

export async function unlinkRequirement(formData: FormData) {
  await requirePermission("controls.write");
  const controlId = optUuid(formData, "control_id");
  const requirementId = optUuid(formData, "requirement_id");
  if (!controlId || !requirementId) fail("/controles", "Datos no válidos.");
  const supabase = await createClient();
  await supabase.from("control_requirements").delete().eq("control_id", controlId).eq("requirement_id", requirementId);
  revalidatePath(`/controles/${controlId}`);
  done(`/controles/${controlId}`, "Requisito retirado.");
}

export async function linkAssets(formData: FormData) {
  const ctx = await requirePermission("controls.write");
  const controlId = optUuid(formData, "control_id");
  if (!controlId) fail("/controles", "Control no válido.");
  const path = `/controles/${controlId}`;
  const codes = str(formData, "codes").split(/[\s,;]+/).map((c) => c.trim()).filter(Boolean).slice(0, 500);
  if (!codes.length) fail(path, "Escribe uno o más códigos de activo.");
  const supabase = await createClient();
  const { data: assets } = await supabase.from("assets").select("id, code").in("code", codes);
  const found = assets ?? [];
  if (!found.length) fail(path, "No se encontró ningún activo con esos códigos.");
  const { error } = await supabase.from("control_assets").upsert(
    found.map((a) => ({ organization_id: ctx.organization.id, control_id: controlId, asset_id: a.id as string })),
    { onConflict: "control_id,asset_id", ignoreDuplicates: true },
  );
  if (error) fail(path, dbMessage(error, "No se pudo asociar."));
  const missing = codes.filter((c) => !found.some((a) => a.code === c));
  revalidatePath(path);
  if (missing.length) fail(path, `${found.length} activo(s) asociado(s). No existen: ${missing.slice(0, 20).join(", ")}.`);
  done(path, `${found.length} activo(s) asociado(s).`);
}

export async function unlinkAsset(formData: FormData) {
  await requirePermission("controls.write");
  const controlId = optUuid(formData, "control_id");
  const assetId = optUuid(formData, "asset_id");
  if (!controlId || !assetId) fail("/controles", "Datos no válidos.");
  const supabase = await createClient();
  await supabase.from("control_assets").delete().eq("control_id", controlId).eq("asset_id", assetId);
  revalidatePath(`/controles/${controlId}`);
  done(`/controles/${controlId}`, "Activo retirado.");
}
