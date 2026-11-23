"use server";
import { redirect } from "next/navigation";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/env";

const TYPES: EmailOtpType[] = ["invite", "recovery", "magiclink", "email", "signup", "email_change"];

export async function activate(formData: FormData) {
  const tokenHash = String(formData.get("token_hash") ?? "");
  const type = String(formData.get("type") ?? "") as EmailOtpType;
  const next = safeNext(String(formData.get("next") ?? ""), "/cuenta/clave");
  if (!tokenHash || !TYPES.includes(type)) redirect("/login?error=enlace");
  const supabase = await createClient();
  const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
  if (error) redirect("/login?error=enlace_usado");
  redirect(`/mfa?next=${encodeURIComponent(next)}`);
}
