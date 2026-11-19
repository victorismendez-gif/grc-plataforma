"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optDate, optLevel, optText, optUuid } from "@/lib/forms-parse";
import { CONTROL_NATURE, CONTROL_TYPES, FREQUENCIES, IMPLEMENTATION, keysOf } from "@/lib/labels";

function controlRecord(fd: FormData) {
  return {
    code: str(fd, "code").replace(/\s+/g, "").slice(0, 30),
    name: str(fd, "name").slice(0, 200),
    description: optText(fd, "description"),
    control_type: oneOf(fd, "control_type", keysOf(CONTROL_TYPES), "preventivo"),
    nature: oneOf(fd, "nature", keysOf(CONTROL_NATURE), "manual"),
    frequency: oneOf(fd, "frequency", keysOf(FREQUENCIES), "continuo"),
    owner_id: optUuid(fd, "owner_id"),
    process_id: optUuid(fd, "process_id"),
    implementation_status: oneOf(fd, "implementation_status", keysOf(IMPLEMENTATION), "planeado"),
    design_rating: optLevel(fd, "design_rating"),
    effectiveness_rating: optLevel(fd, "effectiveness_rating"),
    last_evaluated_on: optDate(fd, "last_evaluated_on"),
    evidence_notes: optText(fd, "evidence_notes"),
  };
}

export async function createControl(formData: FormData) {
  const ctx = await requirePermission("controls.write");
  const rec = controlRecord(formData);
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(rec.code) || rec.name.length < 2) fail("/controles", "Escribe un código (sin espacios) y un nombre.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("controls")
    .insert({ ...rec, organization_id: ctx.organization.id })
    .select("id")
    .single();
  if (error || !data) fail("/controles", dbMessage(error, "No se pudo crear el control."));
  revalidatePath("/controles");
  redirect(`/controles/${data.id}?ok=${encodeURIComponent("Control creado. Asócialo a requisitos y activos.")}`);
}

export async function updateControl(formData: FormData) {
  await requirePermission("controls.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/controles", "Control no válido.");
  const rec = controlRecord(formData);
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(rec.code) || rec.name.length < 2) fail(`/controles/${id}`, "Código y nombre son obligatorios.");
  const supabase = await createClient();
  const { error } = await supabase.from("controls").update(rec).eq("id", id);
  if (error) fail(`/controles/${id}`, dbMessage(error, "No se pudo guardar."));
  revalidatePath("/controles");
  done(`/controles/${id}`, "Control actualizado.");
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
