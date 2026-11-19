import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

export type Option = { id: string; label: string; code?: string | null };

/** Personas activas de la organización (para dueños y responsables). */
export const getPeople = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id, full_name, email").eq("active", true).order("full_name");
  return (data ?? []).map((p) => ({ id: p.id as string, label: (p.full_name as string) || (p.email as string), code: p.email as string }));
});

export const getCatalog = cache(async (catalog: "asset_type" | "info_classification"): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_items")
    .select("id, code, label")
    .eq("catalog", catalog)
    .eq("active", true)
    .order("sort_order");
  return (data ?? []).map((c) => ({ id: c.id as string, label: c.label as string, code: c.code as string }));
});

export type UnitOption = Option & { depth: number };

/** Unidades ordenadas como árbol (sede › área). */
export const getUnits = cache(async (): Promise<UnitOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("org_units").select("id, code, name, parent_id, active").order("name");
  const rows = (data ?? []) as { id: string; code: string | null; name: string; parent_id: string | null; active: boolean }[];
  const children = new Map<string | null, typeof rows>();
  for (const r of rows) children.set(r.parent_id, [...(children.get(r.parent_id) ?? []), r]);
  const out: UnitOption[] = [];
  const walk = (parent: string | null, depth: number) => {
    for (const r of children.get(parent) ?? []) {
      out.push({ id: r.id, label: r.name, code: r.code, depth });
      walk(r.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
});

export const getProcesses = cache(async (): Promise<Option[]> => {
  const supabase = await createClient();
  const { data } = await supabase.from("processes").select("id, code, name").eq("active", true).order("name");
  return (data ?? []).map((p) => ({ id: p.id as string, label: p.name as string, code: p.code as string | null }));
});
