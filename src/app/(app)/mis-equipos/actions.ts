"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { done, fail } from "@/lib/forms";
import { optUuid } from "@/lib/forms-parse";
import { assetDbMessage, assetRecord } from "@/lib/asset-record";
import { getAssetTypes } from "@/lib/asset-lookups";
import { SELF_TYPES } from "@/lib/asset-profiles";

const BASE = "/mis-equipos";
/** Campos de gestión: los define el área de activos, no el empleado. */
const MANAGED = ["owner_id", "owner_text", "process_id", "classification_id", "confidentiality", "integrity",
  "availability", "custodian", "custodian_email", "unit_id", "attributes"];

async function selfRecord(fd: FormData, path: string) {
  const { record, error } = assetRecord(fd);
  if (error) fail(path, error);
  for (const k of MANAGED) delete record[k];
  const types = await getAssetTypes();
  const type = types.find((t) => t.id === record.asset_type_id);
  if (!type || !(SELF_TYPES as readonly string[]).includes(type.code)) {
    fail(path, "Elige un tipo de equipo: computador portátil, computador de escritorio, tableta o celular.");
  }
  return record;
}

export async function createMyEquipment(formData: FormData) {
  const ctx = await requirePermission("assets.self");
  const record = await selfRecord(formData, `${BASE}/nuevo`);
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("assets")
    // la base asigna el equipo a quien lo registra (custodio = usuario actual)
    .insert({ ...record, organization_id: ctx.organization.id, custodian_email: ctx.email.toLowerCase(), custodian: ctx.fullName })
    .select("id, code")
    .single();
  if (error || !data) fail(`${BASE}/nuevo`, assetDbMessage(error));
  revalidatePath(BASE);
  redirect(`${BASE}/${data.id}?ok=${encodeURIComponent(`Equipo ${data.code} registrado.`)}`);
}

export async function updateMyEquipment(formData: FormData) {
  await requirePermission("assets.self");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Equipo no válido.");
  const path = `${BASE}/${id}`;
  const record = await selfRecord(formData, path);
  if (record.code === null) delete record.code;
  const supabase = await createClient();
  const { data, error } = await supabase.from("assets").update(record).eq("id", id).select("id");
  if (error) fail(path, assetDbMessage(error));
  if (!data?.length) fail(path, "No se pudo guardar: el equipo no está asignado a ti.");
  revalidatePath(BASE);
  done(path, "Cambios guardados.");
}

export async function retireMyEquipment(formData: FormData) {
  await requirePermission("assets.self");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Equipo no válido.");
  const supabase = await createClient();
  const { data, error } = await supabase.from("assets").update({ status: "dado_de_baja" }).eq("id", id).select("code");
  if (error || !data?.length) fail(`${BASE}/${id}`, assetDbMessage(error));
  revalidatePath(BASE);
  done(BASE, `Equipo ${data[0].code} dado de baja.`);
}
