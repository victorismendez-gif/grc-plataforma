import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth";
import HashSessionCatcher from "@/components/hash-session-catcher";
import { login } from "./actions";

export const metadata: Metadata = { title: "Ingreso" };

const ERRORS: Record<string, string> = {
  datos: "Revisa el correo y la contraseña.",
  credenciales: "Correo o contraseña incorrectos, o la cuenta está bloqueada.",
  enlace: "El enlace no es válido o ya expiró. Solicita uno nuevo.",
  enlace_usado:
    "El enlace del correo ya fue usado o venció. Algunos antivirus de correo corporativo lo abren antes que tú. " +
    "Pide al administrador un «Enlace de acceso» desde Usuarios y ábrelo directamente.",
};

type Props = { searchParams: Promise<{ error?: string; next?: string; salida?: string }> };

export default async function LoginPage({ searchParams }: Props) {
  const sp = await searchParams;
  const state = await getSessionState();
  if (state.status === "ok") redirect("/");
  if (state.status === "mfa_required") redirect("/mfa");

  return (
    <div className="auth">
      <HashSessionCatcher />
      <div className="card">
        <div className="head">
          <h1>Ingreso</h1>
          <p className="muted small">Plataforma de gestión de riesgos, cumplimiento y activos.</p>
        </div>
        {sp.error && ERRORS[sp.error] && <div className="alert error" role="alert">{ERRORS[sp.error]}</div>}
        {sp.salida && <div className="alert ok">Cerraste sesión.</div>}
        <form action={login} className="stack">
          <input type="hidden" name="next" value={sp.next ?? ""} />
          <label>
            Correo
            <input name="email" type="email" autoComplete="username" required />
          </label>
          <label>
            Contraseña
            <input name="password" type="password" autoComplete="current-password" required />
          </label>
          <button type="submit">Continuar</button>
        </form>
        <p className="small muted">
          Después de la contraseña se pide el código de tu aplicación autenticadora.{" "}
          <Link href="/recuperar">¿Olvidaste la contraseña?</Link>
        </p>
      </div>
    </div>
  );
}
