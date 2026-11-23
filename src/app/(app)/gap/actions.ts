"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { isUuid, optText, optUuid } from "@/lib/forms-parse";
import { resolveResponsible } from "@/lib/resolve";
import { mapGapRows } from "@/lib/gap-sheet";

const STATUSES = ["cumple", "parcial", "no_cumple", "no_aplica"] as const;

function ids(fd: FormData, key: string): string[] {
  return fd.getAll(key).map(String).filter(isUuid);
}

/** Vuelve a la vista del diagnóstico conservando filtros y posición. */
function back(fd: FormData, id: string, msg: { ok?: string; error?: string }, anchor?: string): never {
  const qs = new URLSearchParams(str(fd, "qs"));
  qs.delete("ok");
  qs.delete("error");
  if (msg.ok) qs.set("ok", msg.ok);
  if (msg.error) qs.set("error", msg.error);
  redirect(`/gap/${id}?${qs.toString()}${anchor ? `#${anchor}` : ""}`);
}

export async function createGap(formData: FormData) {
  await requirePermission("gap.write");
  const name = str(formData, "name");
  const frameworks = ids(formData, "framework_ids");
  if (name.length < 3) fail("/gap/nuevo", "Escribe un nombre para el diagnóstico (mínimo 3 caracteres).");
  if (!frameworks.length) fail("/gap/nuevo", "Elige al menos una norma.");
  const leader = await resolveResponsible(str(formData, "leader"));
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gap_create", {
    p_name: name,
    p_framework_ids: frameworks,
    p_scope_description: optText(formData, "scope_description", 4000),
    p_unit_ids: ids(formData, "unit_ids"),
    p_process_ids: ids(formData, "process_ids"),
    p_leader_id: leader.id,
    p_leader_text: leader.text,
  });
  if (error || !data) fail("/gap/nuevo", error?.message || "No se pudo crear el diagnóstico.");
  revalidatePath("/gap");
  redirect(`/gap/${data}?ok=${encodeURIComponent("Diagnóstico creado. Ya puedes calificar los requisitos.")}`);
}

export async function updateGap(formData: FormData) {
  await requirePermission("gap.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/gap", "Diagnóstico no válido.");
  const name = str(formData, "name");
  if (name.length < 3) back(formData, id, { error: "El nombre debe tener al menos 3 caracteres." });
  const leader = await resolveResponsible(str(formData, "leader"));
  const weight = Number(str(formData, "partial_weight").replace(",", "."));
  const supabase = await createClient();
  const { error } = await supabase
    .from("gap_assessments")
    .update({
      name,
      scope_description: optText(formData, "scope_description", 4000),
      leader_id: leader.id,
      leader_text: leader.text,
      partial_weight: Number.isFinite(weight) && weight >= 0 && weight <= 1 ? weight : 0.5,
    })
    .eq("id", id);
  if (error) back(formData, id, { error: dbMessage(error, "No se pudo guardar.") });
  back(formData, id, { ok: "Datos del diagnóstico guardados." });
}

export async function rateItem(formData: FormData) {
  await requirePermission("gap.write");
  const id = optUuid(formData, "assessment_id");
  const item = optUuid(formData, "item_id");
  if (!id || !item) fail("/gap", "Requisito no válido.");
  const raw = str(formData, "status");
  const status = (STATUSES as readonly string[]).includes(raw) ? raw : null;
  const supabase = await createClient();
  const { error } = await supabase
    .from("gap_items")
    .update({
      status,
      justification: optText(formData, "justification", 4000),
      evidence_note: optText(formData, "evidence_note", 4000),
      document_id: optUuid(formData, "document_id"),
    })
    .eq("id", item);
  if (error) back(formData, id, { error: error.message || "No se pudo guardar la calificación." }, `r-${item}`);
  revalidatePath(`/gap/${id}`);
  back(formData, id, { ok: "Calificación guardada." }, `r-${item}`);
}

export async function validateItems(formData: FormData) {
  const id = optUuid(formData, "assessment_id");
  if (!id) fail("/gap", "Diagnóstico no válido.");
  let items = ids(formData, "item_id");
  const ctx = await requirePermission("gap.validate");
  const supabase = await createClient();
  if (!items.length) {
    // todas las calificaciones pendientes de validar registradas por otras personas
    const { data } = await supabase
      .from("gap_items")
      .select("id")
      .eq("assessment_id", id)
      .is("primary_item_id", null)
      .is("validated_at", null)
      .not("status", "is", null)
      .neq("assessed_by", ctx.userId);
    items = (data ?? []).map((r) => r.id as string);
  }
  if (!items.length) back(formData, id, { error: "No hay calificaciones de otras personas pendientes de validar." });
  const { data, error } = await supabase.rpc("gap_validate", { p_item_ids: items });
  if (error) back(formData, id, { error: error.message || "No se pudo validar." });
  revalidatePath(`/gap/${id}`);
  back(formData, id, { ok: `${data} calificación(es) validada(s).` }, items.length === 1 ? `r-${items[0]}` : undefined);
}

export async function setGapStatus(formData: FormData) {
  await requirePermission("gap.validate");
  const id = optUuid(formData, "assessment_id");
  if (!id) fail("/gap", "Diagnóstico no válido.");
  const status = str(formData, "status") === "cerrado" ? "cerrado" : "en_curso";
  const supabase = await createClient();
  const { error } = await supabase.rpc("gap_set_status", { p_assessment: id, p_status: status });
  if (error) back(formData, id, { error: error.message || "No se pudo cambiar el estado." });
  revalidatePath("/gap");
  back(formData, id, { ok: status === "cerrado" ? "Diagnóstico cerrado." : "Diagnóstico reabierto." });
}

export async function syncGapItems(formData: FormData) {
  await requirePermission("gap.write");
  const id = optUuid(formData, "assessment_id");
  if (!id) fail("/gap", "Diagnóstico no válido.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gap_sync_items", { p_assessment: id });
  if (error) back(formData, id, { error: error.message || "No se pudo actualizar." });
  back(formData, id, { ok: data ? `Se agregaron ${data} requisito(s) nuevos de las normas.` : "El diagnóstico ya tiene todos los requisitos de sus normas." });
}

export async function generatePlan(formData: FormData) {
  await requirePermission("plans.write");
  const id = optUuid(formData, "assessment_id");
  if (!id) fail("/gap", "Diagnóstico no válido.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gap_generate_plan", { p_assessment: id });
  if (error || !data) back(formData, id, { error: error?.message || "No se pudo generar el plan." });
  const res = data as { plan_id: string; nuevas: number };
  revalidatePath("/plan");
  done(`/plan/${res.plan_id}`, res.nuevas ? `Se agregaron ${res.nuevas} actividad(es) al plan, una por brecha.` : "El plan ya tiene una actividad por cada brecha.");
}

export type GapImportResult = { ok: boolean; cambios?: number; sin_cambios?: number; errors?: string[] };

export async function importGapRatings(assessmentId: string, raw: Record<string, unknown>[], apply: boolean, headerLine = 1): Promise<GapImportResult> {
  await requirePermission("gap.write");
  if (!isUuid(assessmentId)) return { ok: false, errors: ["Diagnóstico no válido."] };
  if (raw.length > 3000) return { ok: false, errors: ["El archivo supera 3.000 filas."] };
  const mapped = mapGapRows(raw, headerLine);
  if (mapped.errors.length) return { ok: false, errors: mapped.errors };
  if (!mapped.rows.length) return { ok: false, errors: ["El archivo no tiene calificaciones (columna Estado vacía)."] };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("gap_import", { p_assessment: assessmentId, p_rows: mapped.rows, p_apply: apply });
  if (error) return { ok: false, errors: [error.message || "No se pudo procesar el archivo."] };
  const res = data as { cambios: number; sin_cambios: number; errores: string[] };
  if (res.errores.length) return { ok: false, errors: res.errores };
  if (apply) revalidatePath(`/gap/${assessmentId}`);
  return { ok: true, cambios: res.cambios, sin_cambios: res.sin_cambios };
}
