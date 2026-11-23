import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import type { Methodology } from "@/lib/risk";

/** Metodología vigente (se crea la 5x5 por defecto la primera vez). */
export const getMethodology = cache(async (): Promise<Methodology> => {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("risk_methodology_current");
  if (error || !data) throw new Error(error?.message ?? "Sin metodología de riesgo");
  const m = data as Record<string, unknown>;
  return {
    id: m.id as string,
    version: Number(m.version),
    probability_levels: m.probability_levels as Methodology["probability_levels"],
    impact_levels: m.impact_levels as Methodology["impact_levels"],
    formula: m.formula as Methodology["formula"],
    zones: m.zones as Methodology["zones"],
    appetite: Number(m.appetite),
    tolerance: Number(m.tolerance),
    control_reduction: m.control_reduction as Record<string, number>,
  };
});

export const getMethodologyById = cache(async (id: string): Promise<Methodology | null> => {
  const supabase = await createClient();
  const { data } = await supabase.from("risk_methodologies").select("*").eq("id", id).maybeSingle();
  if (!data) return null;
  return { ...(data as unknown as Methodology), appetite: Number(data.appetite), tolerance: Number(data.tolerance) };
});

export async function getRiskCatalogs() {
  const supabase = await createClient();
  const [risks, causes, categories] = await Promise.all([
    supabase.from("risks").select("id, code, name, dimension").eq("active", true).order("code"),
    supabase.from("risk_causes").select("id, code, description, factor:risk_factors(name)").eq("active", true).order("code"),
    supabase.from("risk_categories").select("id, name, appetite, tolerance").eq("active", true).order("name"),
  ]);
  return {
    risks: (risks.data ?? []) as { id: string; code: string; name: string; dimension: string | null }[],
    causes: (causes.data ?? []) as unknown as { id: string; code: string; description: string; factor: { name: string } | null }[],
    categories: (categories.data ?? []) as { id: string; name: string; appetite: number | null; tolerance: number | null }[],
  };
}
