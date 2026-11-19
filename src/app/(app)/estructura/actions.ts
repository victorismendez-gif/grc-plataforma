"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optInt, optText, optUuid } from "@/lib/forms-parse";
import { keysOf, PROCESS_TYPES, UNIT_TYPES } from "@/lib/labels";

const PATH = "/estructura";

export async function saveUnit(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  const name = str(formData, "name");
  if (name.length < 2) fail(PATH, "El nombre de la unidad debe tener al menos 2 caracteres.");
  const record = {
    name,
    code: optText(formData, "code", 30),
    unit_type: oneOf(formData, "unit_type", keysOf(UNIT_TYPES), "area"),
    parent_id: optUuid(formData, "parent_id"),
    employees: optInt(formData, "employees", 0, 1_000_000),
    manager_id: optUuid(formData, "manager_id"),
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("org_units").update(record).eq("id", id)
    : await supabase.from("org_units").insert({ ...record, organization_id: ctx.organization.id });
  if (error) fail(PATH, error.code === "23514" ? "La unidad no puede depender de sí misma ni de una subordinada." : dbMessage(error, "No se pudo guardar la unidad."));
  revalidatePath(PATH);
  done(PATH, id ? "Unidad actualizada." : `Unidad «${name}» creada.`);
}

export async function toggleUnit(formData: FormData) {
  await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  if (!id) fail(PATH, "Unidad no válida.");
  const supabase = await createClient();
  const { error } = await supabase.from("org_units").update({ active: str(formData, "active") === "true" }).eq("id", id);
  if (error) fail(PATH, dbMessage(error, "No se pudo cambiar el estado."));
  revalidatePath(PATH);
  done(PATH, "Estado de la unidad actualizado.");
}

export async function saveProcess(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  const name = str(formData, "name");
  if (name.length < 2) fail(PATH, "El nombre del proceso debe tener al menos 2 caracteres.");
  const record = {
    name,
    code: optText(formData, "code", 30),
    process_type: oneOf(formData, "process_type", keysOf(PROCESS_TYPES), "apoyo"),
    owner_id: optUuid(formData, "owner_id"),
    description: optText(formData, "description"),
  };
  const supabase = await createClient();
  let processId = id;
  if (id) {
    const { error } = await supabase.from("processes").update(record).eq("id", id);
    if (error) fail(PATH, dbMessage(error, "No se pudo guardar el proceso."));
  } else {
    const { data, error } = await supabase
      .from("processes")
      .insert({ ...record, organization_id: ctx.organization.id })
      .select("id")
      .single();
    if (error || !data) fail(PATH, dbMessage(error, "No se pudo crear el proceso."));
    processId = data.id as string;
  }
  // Unidades donde opera el proceso
  const units = formData.getAll("unit_ids").map(String).filter(Boolean);
  await supabase.from("process_units").delete().eq("process_id", processId!).not("unit_id", "in", `(${units.join(",") || "00000000-0000-0000-0000-000000000000"})`);
  if (units.length) {
    const { error } = await supabase
      .from("process_units")
      .upsert(units.map((unit_id) => ({ organization_id: ctx.organization.id, process_id: processId!, unit_id })), {
        onConflict: "process_id,unit_id",
        ignoreDuplicates: true,
      });
    if (error) fail(PATH, dbMessage(error, "Proceso guardado, pero no se pudieron asociar las unidades."));
  }
  revalidatePath(PATH);
  done(PATH, id ? "Proceso actualizado." : `Proceso «${name}» creado.`);
}
