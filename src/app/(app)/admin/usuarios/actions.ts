"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requirePermission } from "@/lib/auth";
import { createAdminClient, createClient } from "@/lib/supabase/server";
import { SITE_URL } from "@/lib/env";
import { dbMessage, done, fail, str } from "@/lib/forms";

const PATH = "/admin/usuarios";
const uuid = z.string().uuid();

const inviteSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  full_name: z.string().trim().min(2).max(120),
  job_title: z.string().trim().max(120),
  role_id: uuid,
});

/** Verifica que el usuario pertenezca a la organización (vía RLS). */
async function assertMember(userId: string) {
  const supabase = await createClient();
  const { data } = await supabase.from("profiles").select("id").eq("id", userId).maybeSingle();
  if (!data) fail(PATH, "El usuario no pertenece a tu organización.");
}

export async function inviteUser(formData: FormData) {
  const ctx = await requirePermission("users.manage");
  const parsed = inviteSchema.safeParse({
    email: str(formData, "email"),
    full_name: str(formData, "full_name"),
    job_title: str(formData, "job_title"),
    role_id: str(formData, "role_id"),
  });
  if (!parsed.success) fail(PATH, "Revisa el correo, el nombre y el rol.");
  const { email, full_name, job_title, role_id } = parsed.data;

  const admin = createAdminClient();
  const { data: invited, error: inviteError } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/cuenta/clave`,
    data: { full_name },
  });
  if (inviteError || !invited.user) {
    fail(PATH, inviteError?.message?.includes("already") ? "Ese correo ya tiene una cuenta." : "No se pudo enviar la invitación.");
  }
  const newUserId = invited.user.id;

  const supabase = await createClient();
  const { error: profileError } = await supabase.rpc("admin_create_profile", {
    p_user_id: newUserId,
    p_full_name: full_name,
    p_job_title: job_title || null,
  });
  if (profileError) {
    await admin.auth.admin.deleteUser(newUserId);
    fail(PATH, dbMessage(profileError, "No se pudo crear el perfil."));
  }
  const { error: roleError } = await supabase
    .from("user_roles")
    .insert({ organization_id: ctx.organization.id, user_id: newUserId, role_id });
  if (roleError) fail(PATH, dbMessage(roleError, "Usuario invitado, pero no se pudo asignar el rol."));

  revalidatePath(PATH);
  done(PATH, `Invitación enviada a ${email}.`);
}

export async function assignRole(formData: FormData) {
  const ctx = await requirePermission("users.manage");
  const userId = uuid.safeParse(str(formData, "user_id"));
  const roleId = uuid.safeParse(str(formData, "role_id"));
  if (!userId.success || !roleId.success) fail(PATH, "Selecciona un rol.");
  const supabase = await createClient();
  const { error } = await supabase
    .from("user_roles")
    .insert({ organization_id: ctx.organization.id, user_id: userId.data, role_id: roleId.data });
  if (error) fail(PATH, dbMessage(error, "No se pudo asignar el rol."));
  revalidatePath(PATH);
  done(PATH, "Rol asignado.");
}

export async function removeRole(formData: FormData) {
  await requirePermission("users.manage");
  const id = uuid.safeParse(str(formData, "user_role_id"));
  if (!id.success) fail(PATH, "Asignación no válida.");
  const supabase = await createClient();
  const { error } = await supabase.from("user_roles").delete().eq("id", id.data);
  if (error) fail(PATH, dbMessage(error, "No se pudo quitar el rol."));
  revalidatePath(PATH);
  done(PATH, "Rol retirado.");
}

export async function setActive(formData: FormData) {
  const ctx = await requirePermission("users.manage");
  const userId = uuid.safeParse(str(formData, "user_id"));
  const active = str(formData, "active") === "true";
  if (!userId.success) fail(PATH, "Usuario no válido.");
  if (userId.data === ctx.userId && !active) fail(PATH, "No puedes desactivar tu propia cuenta.");
  await assertMember(userId.data);

  const supabase = await createClient();
  const { error } = await supabase.from("profiles").update({ active }).eq("id", userId.data);
  if (error) fail(PATH, dbMessage(error, "No se pudo cambiar el estado."));

  // Bloquea o desbloquea el ingreso en Auth (la base ya niega datos a perfiles inactivos).
  const admin = createAdminClient();
  await admin.auth.admin.updateUserById(userId.data, { ban_duration: active ? "none" : "876000h" });
  revalidatePath(PATH);
  done(PATH, active ? "Usuario activado." : "Usuario desactivado.");
}

export async function resetMfa(formData: FormData) {
  await requirePermission("users.manage");
  const userId = uuid.safeParse(str(formData, "user_id"));
  if (!userId.success) fail(PATH, "Usuario no válido.");
  await assertMember(userId.data);

  const admin = createAdminClient();
  const { data, error } = await admin.auth.admin.mfa.listFactors({ userId: userId.data });
  if (error) fail(PATH, "No se pudieron consultar los factores.");
  for (const factor of data.factors) {
    await admin.auth.admin.mfa.deleteFactor({ id: factor.id, userId: userId.data });
  }
  const supabase = await createClient();
  await supabase.rpc("log_event", { p_action: "MFA_RESET", p_detail: { user_id: userId.data } });
  revalidatePath(PATH);
  done(PATH, "Doble factor restablecido. El usuario lo configurará de nuevo en su próximo ingreso.");
}
