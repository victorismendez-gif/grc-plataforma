import { NextResponse, type NextRequest } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { safeNext } from "@/lib/env";

const OTP_TYPES: EmailOtpType[] = ["invite", "recovery", "email", "magiclink", "signup", "email_change"];

/**
 * Destino de los enlaces de invitación y recuperación. Abre la sesión
 * (nivel aal1) y envía al doble factor; desde ahí sigue a `next`
 * (normalmente /cuenta/clave para definir la contraseña).
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const next = safeNext(searchParams.get("next"), "/cuenta/clave");
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type") as EmailOtpType | null;
  const code = searchParams.get("code");
  const supabase = await createClient();

  let ok = false;
  if (tokenHash && type && OTP_TYPES.includes(type)) {
    const { error } = await supabase.auth.verifyOtp({ type, token_hash: tokenHash });
    ok = !error;
  } else if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    ok = !error;
  }

  if (!ok) return NextResponse.redirect(new URL("/login?error=enlace", origin));
  return NextResponse.redirect(new URL(`/mfa?next=${encodeURIComponent(next)}`, origin));
}
