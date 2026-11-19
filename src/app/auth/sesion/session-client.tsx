"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { safeNext } from "@/lib/env";

export default function SessionFromLink() {
  const params = useSearchParams();
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const next = safeNext(params.get("next"), "/cuenta/clave");
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const accessToken = hash.get("access_token");
    const refreshToken = hash.get("refresh_token");
    // Quita los tokens de la barra de direcciones y del historial
    window.history.replaceState(null, "", window.location.pathname + window.location.search);

    if (!accessToken || !refreshToken) {
      setFailed(true);
      return;
    }
    const supabase = createClient();
    supabase.auth
      .setSession({ access_token: accessToken, refresh_token: refreshToken })
      .then(({ error }) => {
        if (error) setFailed(true);
        else window.location.assign(`/mfa?next=${encodeURIComponent(next)}`);
      });
  }, [params]);

  if (!failed) return <p className="muted">Abriendo sesión…</p>;
  return (
    <>
      <div className="alert error" role="alert">
        El enlace no es válido o ya expiró. Pide al administrador una nueva invitación.
      </div>
      <a href="/login">Ir al ingreso</a>
    </>
  );
}
