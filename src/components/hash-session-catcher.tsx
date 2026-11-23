"use client";
import { useEffect } from "react";

/**
 * Si un enlace de invitación (plantilla predeterminada de Supabase) llega a
 * esta página con la sesión en el fragmento #, la envía a /auth/sesion.
 */
export default function HashSessionCatcher() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("error_code=otp_expired") || hash.includes("error=access_denied")) {
      // El enlace ya se usó o venció (a menudo lo abre antes el antivirus del correo)
      window.location.replace("/login?error=enlace_usado");
      return;
    }
    if (hash.includes("access_token=")) {
      window.location.replace(`/auth/sesion?next=${encodeURIComponent("/cuenta/clave")}${hash}`);
    }
  }, []);
  return null;
}
