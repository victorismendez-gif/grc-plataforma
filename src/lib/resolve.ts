import "server-only";
import { createClient } from "@/lib/supabase/server";
import { getPeople } from "@/lib/lookups";
import { normalize } from "@/lib/text";

/**
 * Responsable editable: si el texto coincide con el nombre o correo de un
 * usuario se enlaza a su cuenta; si no, se guarda como texto.
 */
export async function resolveResponsible(raw: string | null | undefined): Promise<{ id: string | null; text: string | null }> {
  const text = (raw ?? "").trim().slice(0, 120);
  if (!text) return { id: null, text: null };
  const n = normalize(text);
  const hit = (await getPeople()).find((p) => normalize(p.label) === n || normalize(p.code) === n);
  return hit ? { id: hit.id, text: null } : { id: null, text };
}

/** Proceso por nombre o código; si no existe se crea en el catálogo (Estructura). */
export async function resolveProcess(raw: string | null | undefined): Promise<{ id: string | null; error?: string }> {
  const name = (raw ?? "").trim();
  if (!name) return { id: null };
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("ensure_process", { p_name: name });
  if (error) return { id: null, error: error.message || "No se pudo registrar el proceso." };
  return { id: data as string };
}

/** Nombre visible de un responsable (usuario enlazado o texto). */
export function responsibleName(
  id: string | null | undefined,
  text: string | null | undefined,
  people: { id: string; label: string }[],
): string {
  if (id) return people.find((p) => p.id === id)?.label ?? "";
  return text ?? "";
}

/**
 * Cargas desde Excel: cambia `process_name` por `process_id`.
 * En la vista previa los procesos nuevos reciben un id provisional (no se
 * crea nada); al aplicar se crean con ensure_process.
 */
export async function resolveImportProcesses(
  rows: Record<string, unknown>[],
  apply: boolean,
): Promise<{ names: Map<string, string>; created: string[]; error?: string }> {
  const names = new Map<string, string>();
  const created: string[] = [];
  if (!rows.some((r) => "process_name" in r)) return { names, created };
  const existing = await getProcessesFresh();
  const byKey = new Map<string, string>();
  for (const p of existing) {
    byKey.set(normalize(p.label), p.id);
    if (p.code) byKey.set(normalize(p.code), p.id);
    names.set(p.id, p.label);
  }
  for (const r of rows) {
    if (!("process_name" in r)) continue;
    const name = (r.process_name as string | null)?.trim() || null;
    delete r.process_name;
    if (!name) {
      r.process_id = null;
      continue;
    }
    const key = normalize(name);
    let id = byKey.get(key);
    if (!id) {
      if (apply) {
        const res = await resolveProcess(name);
        if (res.error || !res.id) return { names, created, error: `Proceso «${name}»: ${res.error ?? "no se pudo crear"}` };
        id = res.id;
      } else {
        id = crypto.randomUUID();
      }
      byKey.set(key, id);
      names.set(id, apply ? name : `${name} (nuevo)`);
      created.push(name);
    }
    r.process_id = id;
  }
  return { names, created };
}

async function getProcessesFresh() {
  const supabase = await createClient();
  const { data } = await supabase.from("processes").select("id, code, name");
  return (data ?? []).map((p) => ({ id: p.id as string, label: p.name as string, code: p.code as string | null }));
}

type Summary = { lista_modificados?: { cambios: Record<string, { antes: unknown; ahora: unknown }> }[] } | null | undefined;

/** En la vista previa muestra nombres en lugar de identificadores internos. */
export function humanizeChanges(summary: Summary, names: Map<string, string>): void {
  for (const m of summary?.lista_modificados ?? []) {
    for (const c of Object.values(m.cambios ?? {})) {
      if (typeof c.antes === "string" && names.has(c.antes)) c.antes = names.get(c.antes);
      if (typeof c.ahora === "string" && names.has(c.ahora)) c.ahora = names.get(c.ahora);
    }
  }
}

/** Nombres de usuarios, procesos y catálogos para la vista previa. */
export async function lookupNames(extra: { id: string; label: string }[][] = []): Promise<Map<string, string>> {
  const people = await getPeople();
  const map = new Map<string, string>();
  for (const p of people) map.set(p.id, p.label);
  for (const list of extra) for (const x of list) map.set(x.id, x.label);
  return map;
}
