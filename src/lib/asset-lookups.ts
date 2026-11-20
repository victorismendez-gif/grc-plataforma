import "server-only";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";
import { readSettings, type AssetTypeSettings, type ScaleLevel } from "@/lib/asset-profiles";

export type AssetTypeOption = { id: string; code: string; label: string; settings: AssetTypeSettings };

/** Tipos de activo con su perfil (identificador y campos). */
export const getAssetTypes = cache(async (): Promise<AssetTypeOption[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("catalog_items")
    .select("id, code, label, settings")
    .eq("catalog", "asset_type")
    .eq("active", true)
    .order("sort_order");
  return (data ?? []).map((t) => ({
    id: t.id as string,
    code: t.code as string,
    label: t.label as string,
    settings: readSettings(t.settings),
  }));
});

/** Escala de valoración C-I-D de la organización. */
export const getScale = cache(async (): Promise<ScaleLevel[]> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("valuation_levels")
    .select("dimension, level, label, description")
    .order("dimension")
    .order("level");
  return (data ?? []) as ScaleLevel[];
});
