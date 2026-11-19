"use client";
import { useEffect } from "react";

/**
 * Si un enlace de invitación (plantilla predeterminada de Supabase) llega a
 * esta página con la sesión en el fragmento #, la envía a /auth/sesion.
 */
export default function HashSessionCatcher() {
  useEffect(() => {
    const hash = window.location.hash;
    if (hash.includes("access_token=")) {
      window.location.replace(`/auth/sesion?next=${encodeURIComponent("/cuenta/clave")}${hash}`);
    }
  }, []);
  return null;
}
