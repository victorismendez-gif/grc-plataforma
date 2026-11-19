"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { isPermission } from "@/lib/permissions";
import { dbMessage, done, fail, str } from "@/lib/forms";

const PATH = "/admin/roles";

const roleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300),
});

function slugify(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
}

export async function createRole(formData: FormData) {
  const ctx = await requirePermission("roles.manage");
  const parsed = roleSchema.safeParse({ name: str(formData, "name"), description: str(formData, "description") });
  if (!parsed.success) fail(PATH, "Escribe un nombre de al menos 2 caracteres.");
  const code = slugify(parsed.data.name);
  if (code.length < 2) fail(PATH, "El nombre debe tener letras o números.");

  const supabase = await createClient();
  const { error } = await supabase.from("roles").insert({
    organization_id: ctx.organization.id,
    code,
    name: parsed.data.name,
    description: parsed.data.description || null,
  });
  if (error) fail(PATH, dbMessage(error, "No se pudo crear el rol."));
  revalidatePath(PATH);
  done(PATH, `Rol «${parsed.data.name}» creado. Ahora marca sus permisos.`);
}

/** Reemplaza el conjunto de permisos de un rol (inserta y borra la diferencia). */
export async function saveRolePermissions(formData: FormData) {
  const ctx = await requirePermission("roles.manage");
  const roleId = z.string().uuid().safeParse(str(formData, "role_id"));
  if (!roleId.success) fail(PATH, "Rol no válido.");
  const id = roleId.data;
  const wanted = new Set(formData.getAll("perm").map(String).filter(isPermission));

  const supabase = await createClient();
  const { data: role } = await supabase.from("roles").select("id, code, is_system, name").eq("id", id).maybeSingle();
  if (!role) fail(PATH, "Rol no encontrado.");
  if (role.is_system && role.code === "administrador") fail(PATH, "El rol administrador conserva siempre todos los permisos.");

  const { data: current } = await supabase.from("role_permissions").select("permission_code").eq("role_id", id);
  const have = new Set((current ?? []).map((r) => r.permission_code as string));
  const toAdd = [...wanted].filter((p) => !have.has(p));
  const toRemove = [...have].filter((p) => !wanted.has(p));

  if (toAdd.length) {
    const { error } = await supabase.from("role_permissions").insert(
      toAdd.map((permission_code) => ({ organization_id: ctx.organization.id, role_id: id, permission_code })),
    );
    if (error) fail(PATH, dbMessage(error, "No se pudieron agregar permisos."));
  }
  if (toRemove.length) {
    const { error } = await supabase
      .from("role_permissions")
      .delete()
      .eq("role_id", id)
      .in("permission_code", toRemove);
    if (error) fail(PATH, dbMessage(error, "No se pudieron retirar permisos."));
  }
  revalidatePath(PATH);
  done(PATH, `Permisos de «${role.name}» guardados (${toAdd.length} agregados, ${toRemove.length} retirados).`);
}

export async function deleteRole(formData: FormData) {
  await requirePermission("roles.manage");
  const roleId = z.string().uuid().safeParse(str(formData, "role_id"));
  if (!roleId.success) fail(PATH, "Rol no válido.");
  const supabase = await createClient();
  const { count } = await supabase.from("user_roles").select("id", { count: "exact", head: true }).eq("role_id", roleId.data);
  if (count) fail(PATH, "El rol tiene usuarios asignados. Retíralos primero.");
  const { error } = await supabase.from("roles").delete().eq("id", roleId.data);
  if (error) fail(PATH, dbMessage(error, "No se pudo eliminar el rol."));
  revalidatePath(PATH);
  done(PATH, "Rol eliminado.");
}
