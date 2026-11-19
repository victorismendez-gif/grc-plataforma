"use client";
import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Mode =
  | { kind: "loading" }
  | { kind: "verify"; factorId: string }
  | { kind: "enroll"; factorId: string; qr: string; secret: string }
  | { kind: "error"; message: string };

export default function MfaClient({ next }: { next: string }) {
  const [mode, setMode] = useState<Mode>({ kind: "loading" });
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    (async () => {
      const { data: factors, error: listError } = await supabase.auth.mfa.listFactors();
      if (listError) return setMode({ kind: "error", message: "No se pudo consultar el doble factor." });
      const verified = factors.totp.find((f) => f.status === "verified");
      if (verified) return setMode({ kind: "verify", factorId: verified.id });

      // Elimina inscripciones a medio terminar antes de crear una nueva
      for (const f of factors.all ?? []) {
        if (f.status === "unverified") await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const { data, error: enrollError } = await supabase.auth.mfa.enroll({
        factorType: "totp",
        friendlyName: `Autenticador ${new Date().toISOString().slice(0, 16)}`,
      });
      if (enrollError || !data) return setMode({ kind: "error", message: "No se pudo iniciar la inscripción." });
      setMode({ kind: "enroll", factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode.kind !== "verify" && mode.kind !== "enroll") return;
    setBusy(true);
    setError(null);
    const supabase = createClient();
    const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({
      factorId: mode.factorId,
      code: code.trim(),
    });
    if (verifyError) {
      setBusy(false);
      setError("Código incorrecto o vencido. Usa el código actual de tu aplicación.");
      return;
    }
    await supabase.rpc("log_event", {
      p_action: mode.kind === "enroll" ? "MFA_ENROLLED" : "MFA_VERIFIED",
      p_detail: {},
    });
    window.location.assign(next);
  }

  if (mode.kind === "loading") return <p className="muted">Cargando…</p>;
  if (mode.kind === "error")
    return (
      <>
        <div className="alert error">{mode.message}</div>
        <a href="/login">Volver al ingreso</a>
      </>
    );

  return (
    <>
      <div className="head">
        <h1>{mode.kind === "enroll" ? "Configura el doble factor" : "Código de verificación"}</h1>
        <p className="muted small">
          {mode.kind === "enroll"
            ? "Es obligatorio para entrar. Escanea el código con Google Authenticator, Microsoft Authenticator u otra aplicación TOTP y escribe el código de 6 dígitos."
            : "Escribe el código de 6 dígitos de tu aplicación autenticadora."}
        </p>
      </div>
      {mode.kind === "enroll" && (
        <>
          <div className="qr">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={mode.qr} alt="Código QR para la aplicación autenticadora" />
          </div>
          <details>
            <summary className="small">No puedo escanear el código</summary>
            <p className="small">Clave para ingresar a mano:</p>
            <p className="mono" style={{ wordBreak: "break-all" }}>{mode.secret}</p>
          </details>
        </>
      )}
      {error && <div className="alert error" role="alert">{error}</div>}
      <form onSubmit={submit} className="stack">
        <label>
          Código
          <input
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            required
            autoFocus
          />
        </label>
        <button type="submit" disabled={busy || code.length !== 6}>
          {busy ? "Verificando…" : "Verificar"}
        </button>
      </form>
      <form action="/auth/salir" method="post">
        <button type="submit" className="link small">Cerrar sesión</button>
      </form>
    </>
  );
}
