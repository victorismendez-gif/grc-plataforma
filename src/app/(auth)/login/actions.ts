"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { SITE_URL, safeNext } from "@/lib/env";

const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export async function login(formData: FormData) {
  const next = safeNext(formData.get("next")?.toString());
  const q = next !== "/" ? `&next=${encodeURIComponent(next)}` : "";
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });
  if (!parsed.success) redirect(`/login?error=datos${q}`);

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) redirect(`/login?error=credenciales${q}`);

  await supabase.rpc("log_event", { p_action: "LOGIN", p_detail: {} });
  redirect(`/mfa?next=${encodeURIComponent(next)}`);
}

const emailSchema = z.object({ email: z.string().trim().toLowerCase().email() });

export async function requestPasswordReset(formData: FormData) {
  const parsed = emailSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) redirect("/recuperar?error=datos");
  const supabase = await createClient();
  // La respuesta es la misma exista o no la cuenta (no revela usuarios).
  await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${SITE_URL}/auth/confirm?next=/cuenta/clave`,
  });
  redirect("/recuperar?enviado=1");
}
