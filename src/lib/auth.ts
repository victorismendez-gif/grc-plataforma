import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { Permission } from "@/lib/permissions";

export type Organization = {
  id: string;
  name: string;
  slug: string;
  email_domain: string | null;
  industry: string | null;
  country: string;
  logo_url: string | null;
  brand_color: string;
};

export type AppContext = {
  userId: string;
  email: string;
  fullName: string;
  organization: Organization;
  permissions: ReadonlySet<string>;
  can: (p: Permission) => boolean;
};

export type SessionState =
  | { status: "anon" }
  | { status: "mfa_required"; userId: string }
  | { status: "no_profile"; userId: string; email: string }
  | { status: "ok"; ctx: AppContext };

/**
 * Estado de la sesión, resuelto en el servidor una vez por solicitud.
 * Exige doble factor (aal2): sin él no hay contexto de organización.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "anon" };

  const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (aal?.currentLevel !== "aal2") return { status: "mfa_required", userId: user.id };

  const { data: profile } = await supabase
    .from("profiles")
    .select("full_name, active, organization:organizations(id, name, slug, email_domain, industry, country, logo_url, brand_color)")
    .eq("id", user.id)
    .maybeSingle();

  const org = profile?.organization as unknown as Organization | null | undefined;
  if (!profile || !profile.active || !org) {
    return { status: "no_profile", userId: user.id, email: user.email ?? "" };
  }

  const { data: perms } = await supabase.rpc("current_permissions");
  const permissions = new Set<string>((perms as string[] | null) ?? []);

  return {
    status: "ok",
    ctx: {
      userId: user.id,
      email: user.email ?? "",
      fullName: (profile.full_name as string) || (user.email ?? ""),
      organization: org,
      permissions,
      can: (p: Permission) => permissions.has(p),
    },
  };
});

/** Exige sesión completa (contraseña + doble factor + perfil activo). */
export async function requireContext(): Promise<AppContext> {
  const state = await getSessionState();
  switch (state.status) {
    case "anon":
      redirect("/login");
    case "mfa_required":
      redirect("/mfa");
    case "no_profile":
      redirect("/sin-acceso");
    case "ok":
      return state.ctx;
  }
}

/** Exige un permiso. Se usa en páginas y en cada acción de servidor. */
export async function requirePermission(permission: Permission): Promise<AppContext> {
  const ctx = await requireContext();
  if (!ctx.can(permission)) redirect("/sin-permiso");
  return ctx;
}
