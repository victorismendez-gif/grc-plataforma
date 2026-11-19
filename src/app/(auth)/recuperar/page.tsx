import type { Metadata } from "next";
import Link from "next/link";
import { requestPasswordReset } from "../login/actions";

export const metadata: Metadata = { title: "Recuperar contraseña" };

type Props = { searchParams: Promise<{ error?: string; enviado?: string }> };

export default async function RecoverPage({ searchParams }: Props) {
  const sp = await searchParams;
  return (
    <div className="auth">
      <div className="card">
        <div className="head">
          <h1>Recuperar contraseña</h1>
          <p className="muted small">Te enviamos un enlace al correo. Para cambiar la contraseña también se pide el doble factor.</p>
        </div>
        {sp.enviado ? (
          <div className="alert ok">Si el correo está registrado, recibirás un enlace en unos minutos.</div>
        ) : (
          <form action={requestPasswordReset} className="stack">
            {sp.error && <div className="alert error">Escribe un correo válido.</div>}
            <label>
              Correo
              <input name="email" type="email" autoComplete="username" required />
            </label>
            <button type="submit">Enviar enlace</button>
          </form>
        )}
        <Link href="/login" className="small">Volver al ingreso</Link>
      </div>
    </div>
  );
}
