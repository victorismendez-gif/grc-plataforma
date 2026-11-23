import type { Metadata } from "next";
import { activate } from "./actions";

export const metadata: Metadata = { title: "Activar acceso" };

type Props = { searchParams: Promise<{ token_hash?: string; type?: string; next?: string }> };

/**
 * Paso intermedio con botón: los antivirus de correo abren los enlaces
 * automáticamente pero no pulsan botones, así el enlace de un solo uso
 * no se consume antes de que la persona llegue.
 */
export default async function ActivatePage({ searchParams }: Props) {
  const sp = await searchParams;
  const valid = !!sp.token_hash && !!sp.type;
  return (
    <div className="auth">
      <div className="card stack">
        <div className="head">
          <h1>Activar acceso</h1>
          <p className="muted small">Plataforma de gestión de riesgos, cumplimiento y activos.</p>
        </div>
        {valid ? (
          <form action={activate} className="stack">
            <input type="hidden" name="token_hash" value={sp.token_hash} />
            <input type="hidden" name="type" value={sp.type} />
            <input type="hidden" name="next" value={sp.next ?? "/cuenta/clave"} />
            <p className="small">
              Pulsa el botón para continuar. Luego configurarás el doble factor con tu aplicación autenticadora y
              definirás tu contraseña.
            </p>
            <button type="submit">Activar mi acceso</button>
          </form>
        ) : (
          <div className="alert error">El enlace está incompleto. Pide uno nuevo al administrador.</div>
        )}
      </div>
    </div>
  );
}
