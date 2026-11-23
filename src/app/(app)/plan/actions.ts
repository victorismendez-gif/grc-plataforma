"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optDate, optInt, optText, optUuid } from "@/lib/forms-parse";
import { keysOf, ACTION_STATUS, PRIORITY } from "@/lib/labels";
import { resolveProcess, resolveResponsible } from "@/lib/resolve";

export async function createPlan(formData: FormData) {
  const title = str(formData, "title");
  if (title.length < 3) fail("/plan", "Escribe el nombre del plan (mínimo 3 caracteres).");
  const ctx = await requirePermission("plans.write");
  const owner = await resolveResponsible(str(formData, "owner"));
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("action_plans")
    .insert({ organization_id: ctx.organization.id, title, origin: "otro", description: optText(formData, "description", 4000), owner_id: owner.id, owner_text: owner.text })
    .select("id")
    .single();
  if (error || !data) fail("/plan", dbMessage(error, "No se pudo crear el plan."));
  revalidatePath("/plan");
  done(`/plan/${data.id}`, "Plan creado. Agrega sus actividades.");
}

export async function updatePlan(formData: FormData) {
  await requirePermission("plans.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/plan", "Plan no válido.");
  const title = str(formData, "title");
  if (title.length < 3) fail(`/plan/${id}`, "El nombre debe tener al menos 3 caracteres.");
  const owner = await resolveResponsible(str(formData, "owner"));
  const supabase = await createClient();
  const { error } = await supabase
    .from("action_plans")
    .update({ title, description: optText(formData, "description", 4000), owner_id: owner.id, owner_text: owner.text,
      status: str(formData, "status") === "cerrado" ? "cerrado" : "abierto" })
    .eq("id", id);
  if (error) fail(`/plan/${id}`, dbMessage(error, "No se pudo guardar el plan."));
  revalidatePath("/plan");
  done(`/plan/${id}`, "Plan guardado.");
}

export async function saveAction(formData: FormData) {
  const ctx = await requirePermission("plans.write");
  const planId = optUuid(formData, "plan_id");
  if (!planId) fail("/plan", "Plan no válido.");
  const id = optUuid(formData, "id");
  const path = id ? `/plan/${planId}/actividad/${id}` : `/plan/${planId}/actividad/nueva`;
  const title = str(formData, "title");
  if (title.length < 3) fail(path, "Escribe la actividad (mínimo 3 caracteres).");
  const status = oneOf(formData, "status", keysOf(ACTION_STATUS), "pendiente");
  const evidence = optText(formData, "closure_evidence", 4000);
  if (status === "terminada" && !evidence) fail(path, "Para terminar la actividad describe la evidencia de cierre.");
  const start = optDate(formData, "start_on");
  const due = optDate(formData, "due_on");
  if (start && due && due < start) fail(path, "La fecha límite no puede ser anterior a la de inicio.");
  const owner = await resolveResponsible(str(formData, "owner"));
  const proc = await resolveProcess(str(formData, "process"));
  if (proc.error) fail(path, proc.error);
  const record = {
    title: title.slice(0, 300),
    description: optText(formData, "description", 4000),
    owner_id: owner.id,
    owner_text: owner.text,
    unit_id: optUuid(formData, "unit_id"),
    process_id: proc.id,
    priority: oneOf(formData, "priority", keysOf(PRIORITY), "media"),
    start_on: start,
    due_on: due,
    status,
    progress: optInt(formData, "progress", 0, 100) ?? 0,
    closure_evidence: evidence,
  };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("actions").update(record).eq("id", id)
    : await supabase.from("actions").insert({ ...record, plan_id: planId, organization_id: ctx.organization.id });
  if (error) fail(path, dbMessage(error, "No se pudo guardar la actividad."));
  revalidatePath(`/plan/${planId}`);
  const back = str(formData, "back");
  redirect(`/plan/${planId}?${back ? `${back}&` : ""}ok=${encodeURIComponent(id ? "Actividad guardada." : "Actividad agregada.")}`);
}

/** Cambio rápido de estado desde el tablero. */
export async function moveAction(formData: FormData) {
  await requirePermission("plans.write");
  const planId = optUuid(formData, "plan_id");
  const id = optUuid(formData, "id");
  if (!planId || !id) fail("/plan", "Actividad no válida.");
  const status = oneOf(formData, "status", keysOf(ACTION_STATUS), "pendiente");
  const supabase = await createClient();
  if (status === "terminada") {
    const { data } = await supabase.from("actions").select("closure_evidence").eq("id", id).maybeSingle();
    if (!data?.closure_evidence) redirect(`/plan/${planId}/actividad/${id}?error=${encodeURIComponent("Para terminarla registra la evidencia de cierre.")}&terminar=1`);
  }
  const { error } = await supabase.from("actions").update({ status }).eq("id", id);
  if (error) fail(`/plan/${planId}`, dbMessage(error, "No se pudo mover la actividad."));
  revalidatePath(`/plan/${planId}`);
  redirect(`/plan/${planId}?vista=tablero`);
}
