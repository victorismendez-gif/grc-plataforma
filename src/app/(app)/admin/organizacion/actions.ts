"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";

const PATH = "/admin/organizacion";

const orgSchema = z.object({
  name: z.string().trim().min(2).max(160),
  industry: z.string().trim().max(120),
  country: z.string().trim().length(2).toUpperCase(),
  email_domain: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^([a-z0-9.-]+\.[a-z]{2,})?$/, "Dominio no válido"),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logo_url: z
    .string()
    .trim()
    .max(500)
    .refine((v) => v === "" || v.startsWith("https://"), "El logo debe ser una URL https"),
});

export async function updateOrganization(formData: FormData) {
  const ctx = await requirePermission("org.manage");
  const parsed = orgSchema.safeParse({
    name: str(formData, "name"),
    industry: str(formData, "industry"),
    country: str(formData, "country"),
    email_domain: str(formData, "email_domain"),
    brand_color: str(formData, "brand_color"),
    logo_url: str(formData, "logo_url"),
  });
  if (!parsed.success) fail(PATH, parsed.error.issues[0]?.message ?? "Revisa los datos.");
  const d = parsed.data;
  const supabase = await createClient();
  const { error } = await supabase
    .from("organizations")
    .update({
      name: d.name,
      industry: d.industry || null,
      country: d.country,
      email_domain: d.email_domain || null,
      brand_color: d.brand_color,
      logo_url: d.logo_url || null,
    })
    .eq("id", ctx.organization.id);
  if (error) fail(PATH, dbMessage(error, "No se pudo guardar."));
  revalidatePath("/", "layout");
  done(PATH, "Datos de la organización guardados.");
}

const CATALOGS = ["asset_type", "info_classification"] as const;

export async function saveCatalogItem(formData: FormData) {
  const ctx = await requirePermission("org.manage");
  const catalog = str(formData, "catalog") as (typeof CATALOGS)[number];
  if (!CATALOGS.includes(catalog)) fail(PATH, "Catálogo no válido.");
  const labelText = str(formData, "label").slice(0, 80);
  if (!labelText) fail(PATH, "Escribe el nombre.");
  const id = str(formData, "id");
  const supabase = await createClient();
  if (id) {
    const { error } = await supabase
      .from("catalog_items")
      .update({ label: labelText, active: formData.get("active") === "on" })
      .eq("id", id);
    if (error) fail(PATH, dbMessage(error, "No se pudo guardar."));
  } else {
    const code = labelText
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 40);
    if (!code) fail(PATH, "El nombre debe tener letras o números.");
    const { error } = await supabase.from("catalog_items").insert({
      organization_id: ctx.organization.id,
      catalog,
      code,
      label: labelText,
      sort_order: 500,
    });
    if (error) fail(PATH, dbMessage(error, "No se pudo agregar."));
  }
  revalidatePath(PATH);
  done(PATH, "Catálogo actualizado.");
}
