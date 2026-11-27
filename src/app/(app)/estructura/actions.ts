"use server";
import { revalidatePath } from "next/cache";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optInt, optText, optUuid } from "@/lib/forms-parse";
import { keysOf, UNIT_TYPES } from "@/lib/labels";
import { resolveResponsible } from "@/lib/resolve";

const PATH = "/estructura";

export async function saveUnit(formData: FormData) {
  const ctx = await requirePermission("assets.write");
  const id = optUuid(formData, "id");
  const name = str(formData, "name");
  if (name.length < 2) fail(PATH, "El nombre de la unidad debe tener al menos 2 caracteres.");
  const manager = await resolveResponsible(str(formData, "manager"));
  const record = {
    name,
    code: optText(formData, "code", 30),
    unit_type: oneOf(formData, "unit_type", keysOf(UNIT_TYPES), "area"),
    parent_id: optUuid(formData, "parent_id"),
    employees: optInt(formData, "employees", 0, 1_000_000),
    manager_id: manager.id,
    manager_text: manager.text,
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
