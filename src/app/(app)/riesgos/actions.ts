"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { isUuid, oneOf, optInt, optText, optUuid } from "@/lib/forms-parse";
import { resolveProcess, resolveResponsible } from "@/lib/resolve";
import { getMethodology } from "@/lib/risk-data";
import { STRATEGIES, type Level, type Zone } from "@/lib/risk";
import { mapRiskRows } from "@/lib/risk-sheet";
import { keysOf } from "@/lib/labels";
import { getAssetTypes } from "@/lib/asset-lookups";

/** Deja el escenario vinculado exactamente a los tipos de activo marcados. */
async function syncAssetTypes(entryId: string, orgId: string, fd: FormData, path: string) {
  const valid = new Set((await getAssetTypes()).map((t) => t.id));
  const wanted = [...new Set(fd.getAll("asset_type_ids").map(String))].filter((id) => isUuid(id) && valid.has(id));
  const supabase = await createClient();
  const { data: current } = await supabase.from("risk_entry_asset_types").select("asset_type_id").eq("entry_id", entryId);
  const have = new Set((current ?? []).map((r) => r.asset_type_id as string));
  const remove = [...have].filter((id) => !wanted.includes(id));
  const add = wanted.filter((id) => !have.has(id));
  if (remove.length) {
    const { error } = await supabase.from("risk_entry_asset_types").delete().eq("entry_id", entryId).in("asset_type_id", remove);
    if (error) fail(path, dbMessage(error, "No se pudieron actualizar los tipos de activo."));
  }
  if (add.length) {
    const { error } = await supabase.from("risk_entry_asset_types")
      .insert(add.map((asset_type_id) => ({ organization_id: orgId, entry_id: entryId, asset_type_id })));
    if (error) fail(path, dbMessage(error, "No se pudieron guardar los tipos de activo."));
  }
}

const BASE = "/riesgos";

async function entryRecord(fd: FormData, path: string) {
  const riskId = optUuid(fd, "risk_id");
  if (!riskId) fail(path, "Elige el riesgo.");
  const owner = await resolveResponsible(str(fd, "owner"));
  const proc = await resolveProcess(str(fd, "process"));
  if (proc.error) fail(path, proc.error);
  const strategy = str(fd, "treatment_strategy");
  return {
    risk_id: riskId,
    cause_id: optUuid(fd, "cause_id"),
    category_id: optUuid(fd, "category_id"),
    threat_event: optText(fd, "threat_event", 2000),
    consequence: optText(fd, "consequence", 2000),
    process_id: proc.id,
    owner_id: owner.id,
    owner_text: owner.text,
    treatment_strategy: (keysOf(STRATEGIES) as string[]).includes(strategy) ? strategy : null,
    treatment_description: optText(fd, "treatment_description", 4000),
  };
}

export async function createEntry(formData: FormData) {
  const ctx = await requirePermission("risks.write");
  const rec = await entryRecord(formData, `${BASE}/nuevo`);
  const supabase = await createClient();
  const { data, error } = await supabase.from("risk_entries").insert({ ...rec, organization_id: ctx.organization.id }).select("id, code").single();
  if (error || !data) fail(`${BASE}/nuevo`, dbMessage(error, "No se pudo registrar el riesgo."));
  await syncAssetTypes(data.id, ctx.organization.id, formData, `${BASE}/${data.id}`);
  const p = optInt(formData, "probability", 1, 6);
  const i = optInt(formData, "impact", 1, 6);
  if (p && i) await supabase.rpc("risk_evaluate", { p_entry: data.id, p_probability: p, p_impact: i });
  revalidatePath(BASE);
  done(`${BASE}/${data.id}`, `Riesgo ${data.code} registrado.`);
}

export async function updateEntry(formData: FormData) {
  const ctx = await requirePermission("risks.write");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Riesgo no válido.");
  const rec = await entryRecord(formData, `${BASE}/${id}`);
  const supabase = await createClient();
  const { error } = await supabase.from("risk_entries").update(rec).eq("id", id);
  if (error) fail(`${BASE}/${id}`, dbMessage(error, "No se pudo guardar."));
  await syncAssetTypes(id, ctx.organization.id, formData, `${BASE}/${id}`);
  revalidatePath(BASE);
  done(`${BASE}/${id}`, "Datos del riesgo guardados.");
}

export async function evaluateEntry(formData: FormData) {
  await requirePermission("risks.write");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Riesgo no válido.");
  const p = optInt(formData, "probability", 1, 6);
  const i = optInt(formData, "impact", 1, 6);
  if ((p === null) !== (i === null)) fail(`${BASE}/${id}`, "Elige probabilidad e impacto.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("risk_evaluate", { p_entry: id, p_probability: p, p_impact: i });
  if (error) fail(`${BASE}/${id}`, error.message || "No se pudo valorar.");
  revalidatePath(BASE);
  done(`${BASE}/${id}`, p ? "Valoración guardada: se recalculó el riesgo residual." : "Valoración eliminada.");
}

export async function saveEntryControls(formData: FormData) {
  const ctx = await requirePermission("risks.write");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Riesgo no válido.");
  const wanted = new Set(formData.getAll("control_ids").map(String).filter(isUuid));
  const supabase = await createClient();
  const { data: current } = await supabase.from("risk_entry_controls").select("id, control_id").eq("entry_id", id);
  const remove = (current ?? []).filter((c) => !wanted.has(c.control_id as string)).map((c) => c.id as string);
  const have = new Set((current ?? []).map((c) => c.control_id as string));
  const add = [...wanted].filter((c) => !have.has(c)).map((control_id) => ({ organization_id: ctx.organization.id, entry_id: id, control_id }));
  if (remove.length) {
    const { error } = await supabase.from("risk_entry_controls").delete().in("id", remove);
    if (error) fail(`${BASE}/${id}`, dbMessage(error, "No se pudieron quitar controles."));
  }
  if (add.length) {
    const { error } = await supabase.from("risk_entry_controls").insert(add);
    if (error) fail(`${BASE}/${id}`, dbMessage(error, "No se pudieron enlazar controles."));
  }
  revalidatePath(BASE);
  done(`${BASE}/${id}`, "Controles actualizados: el riesgo residual se recalculó.");
}

export async function addTreatment(formData: FormData) {
  await requirePermission("plans.write");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Riesgo no válido.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("risk_add_treatment", { p_entry: id });
  if (error || !data) fail(`${BASE}/${id}`, error?.message || "No se pudo crear la actividad.");
  const { data: act } = await supabase.from("actions").select("plan_id").eq("id", data as string).maybeSingle();
  revalidatePath(BASE);
  redirect(`/plan/${act?.plan_id}/actividad/${data}?ok=${encodeURIComponent("Actividad de tratamiento creada. Asigna responsable y fecha.")}`);
}

export async function acceptRisk(formData: FormData) {
  await requirePermission("risks.configure");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Riesgo no válido.");
  const accept = str(formData, "accept") === "1";
  const supabase = await createClient();
  const { error } = await supabase.rpc("risk_accept", { p_entry: id, p_note: str(formData, "note"), p_accept: accept });
  if (error) fail(`${BASE}/${id}`, error.message || "No se pudo registrar.");
  revalidatePath(BASE);
  done(`${BASE}/${id}`, accept ? "Aceptación del riesgo residual aprobada." : "Aceptación retirada.");
}

export async function recordMaterialization(formData: FormData) {
  await requirePermission("risks.write");
  const id = optUuid(formData, "id");
  if (!id) fail(BASE, "Riesgo no válido.");
  const supabase = await createClient();
  const { data } = await supabase.from("risk_entries").select("materialized_count").eq("id", id).maybeSingle();
  const { error } = await supabase
    .from("risk_entries")
    .update({ materialized_count: Number(data?.materialized_count ?? 0) + 1, last_materialized_on: new Date().toISOString().slice(0, 10) })
    .eq("id", id);
  if (error) fail(`${BASE}/${id}`, dbMessage(error, "No se pudo registrar."));
  done(`${BASE}/${id}`, "Se registró que el riesgo se materializó.");
}

// ---------------------------------------------------------------------
// Metodología y catálogos
// ---------------------------------------------------------------------
function levels(fd: FormData, prefix: "p" | "i"): Level[] {
  const n = optInt(fd, `${prefix}_count`, 3, 6) ?? 5;
  return Array.from({ length: n }, (_, k) => ({
    level: k + 1,
    name: str(fd, `${prefix}_name_${k + 1}`).slice(0, 60) || `Nivel ${k + 1}`,
    description: str(fd, `${prefix}_desc_${k + 1}`).slice(0, 500),
  }));
}

export async function saveMethodology(formData: FormData) {
  await requirePermission("risks.configure");
  const path = `${BASE}/metodologia`;
  const zones: Zone[] = [];
  for (let k = 1; k <= 6; k++) {
    const name = str(formData, `z_name_${k}`).slice(0, 40);
    const min = Number(str(formData, `z_min_${k}`).replace(",", "."));
    const color = str(formData, `z_color_${k}`);
    if (name && Number.isFinite(min)) zones.push({ name, min, color: /^#[0-9a-f]{6}$/i.test(color) ? color.toUpperCase() : "#888888" });
  }
  const num = (k: string) => Number(str(formData, k).replace(",", "."));
  const reduction = { "1": num("red_1") / 100, "2": num("red_2") / 100, "3": num("red_3") / 100 };
  if (Object.values(reduction).some((v) => !Number.isFinite(v) || v < 0 || v > 0.95)) fail(path, "La reducción por control va de 0 % a 95 %.");
  const appetite = num("appetite");
  const tolerance = num("tolerance");
  if (!Number.isFinite(appetite) || !Number.isFinite(tolerance) || tolerance < appetite) fail(path, "La tolerancia debe ser mayor o igual al apetito.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("risk_methodology_save", {
    p_probability_levels: levels(formData, "p"),
    p_impact_levels: levels(formData, "i"),
    p_formula: oneOf(formData, "formula", ["producto", "suma"], "producto"),
    p_zones: zones,
    p_appetite: appetite,
    p_tolerance: tolerance,
    p_control_reduction: reduction,
  });
  if (error) fail(path, error.message || "No se pudo guardar la metodología.");
  revalidatePath(BASE);
  done(path, "Metodología guardada. Las valoraciones anteriores conservan la versión con la que se hicieron.");
}

export async function saveCategory(formData: FormData) {
  const ctx = await requirePermission("risks.write");
  const path = `${BASE}/metodologia`;
  const id = optUuid(formData, "id");
  const name = str(formData, "name").slice(0, 160);
  if (name.length < 2) fail(path, "Escribe el nombre de la categoría.");
  const n = (k: string) => {
    const v = str(formData, k).replace(",", ".");
    return v === "" ? null : Number(v);
  };
  const rec = { name, appetite: n("appetite"), tolerance: n("tolerance") };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("risk_categories").update(rec).eq("id", id)
    : await supabase.from("risk_categories").insert({ ...rec, organization_id: ctx.organization.id });
  if (error) fail(path, dbMessage(error, "No se pudo guardar la categoría."));
  done(path, "Categoría guardada.");
}

export async function saveCatalogRisk(formData: FormData) {
  const ctx = await requirePermission("risks.write");
  const path = `${BASE}/catalogo`;
  const id = optUuid(formData, "id");
  const code = str(formData, "code");
  const name = str(formData, "name").slice(0, 500);
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(code) || name.length < 3) fail(path, "Escribe un código sin espacios y la descripción del riesgo.");
  const dim = str(formData, "dimension");
  const rec = { code, name, description: optText(formData, "description", 4000),
    dimension: ["confidencialidad", "integridad", "disponibilidad", "otro"].includes(dim) ? dim : null };
  const supabase = await createClient();
  const { error } = id
    ? await supabase.from("risks").update(rec).eq("id", id)
    : await supabase.from("risks").insert({ ...rec, organization_id: ctx.organization.id });
  if (error) fail(path, dbMessage(error, "No se pudo guardar el riesgo."));
  done(path, "Riesgo del catálogo guardado.");
}

export async function saveCause(formData: FormData) {
  const ctx = await requirePermission("risks.write");
  const path = `${BASE}/catalogo`;
  const id = optUuid(formData, "id");
  const code = str(formData, "code");
  const description = str(formData, "description").slice(0, 1000);
  if (!/^[A-Za-z0-9._-]{1,30}$/.test(code) || description.length < 3) fail(path, "Escribe un código sin espacios y la causa.");
  const supabase = await createClient();
  let factorId: string | null = null;
  const factor = str(formData, "factor").slice(0, 160);
  if (factor) {
    const { data: f } = await supabase.from("risk_factors").select("id").ilike("name", factor).maybeSingle();
    if (f) factorId = f.id as string;
    else {
      const { data: nf, error } = await supabase.from("risk_factors").insert({ organization_id: ctx.organization.id, name: factor }).select("id").single();
      if (error || !nf) fail(path, dbMessage(error, "No se pudo crear el factor."));
      factorId = nf.id as string;
    }
  }
  const rec = { code, description, factor_id: factorId };
  const { error } = id
    ? await supabase.from("risk_causes").update(rec).eq("id", id)
    : await supabase.from("risk_causes").insert({ ...rec, organization_id: ctx.organization.id });
  if (error) fail(path, dbMessage(error, "No se pudo guardar la causa."));
  done(path, "Causa guardada.");
}

// ---------------------------------------------------------------------
// Carga desde Excel
// ---------------------------------------------------------------------
export type RiskImportResult = {
  ok: boolean; errors?: string[]; warnings?: string[];
  nuevos?: number; actualizados?: number; sin_cambios?: number; valorados?: number;
};

export async function importRisks(raw: Record<string, unknown>[], apply: boolean, headerLine = 1): Promise<RiskImportResult> {
  await requirePermission("risks.write");
  if (raw.length > 5000) return { ok: false, errors: ["El archivo supera 5.000 filas."] };
  const m = await getMethodology();
  const supabase = await createClient();
  const [{ data: ctrls }, types] = await Promise.all([supabase.from("controls").select("code"), getAssetTypes()]);
  const mapped = mapRiskRows(raw, m, (ctrls ?? []).map((c) => c.code as string), headerLine,
    types.map((t) => ({ code: t.code, label: t.label })));
  if (mapped.errors.length) return { ok: false, errors: mapped.errors, warnings: mapped.warnings };
  if (!mapped.rows.length) return { ok: false, errors: ["El archivo no tiene filas con riesgos."], warnings: mapped.warnings };
  const { data, error } = await supabase.rpc("risk_import", { p_rows: mapped.rows, p_apply: apply });
  if (error) return { ok: false, errors: [error.message || "No se pudo procesar el archivo."], warnings: mapped.warnings };
  const res = data as { nuevos: number; actualizados: number; sin_cambios: number; valorados: number; errores: string[] };
  if (res.errores.length) return { ok: false, errors: res.errores, warnings: mapped.warnings };
  if (apply) revalidatePath(BASE);
  return { ok: true, warnings: mapped.warnings, nuevos: res.nuevos, actualizados: res.actualizados, sin_cambios: res.sin_cambios, valorados: res.valorados };
}
