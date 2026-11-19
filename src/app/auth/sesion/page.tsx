import type { Metadata } from "next";
import { Suspense } from "react";
import SessionFromLink from "./session-client";

export const metadata: Metadata = { title: "Abriendo sesión" };

/**
 * Destino de los enlaces con la plantilla predeterminada de Supabase
 * (invitaciones del administrador): la sesión llega en el fragmento #
 * de la URL, que solo el navegador puede leer.
 */
export default function SessionPage() {
  return (
    <div className="auth">
      <div className="card">
        <Suspense fallback={<p className="muted">Abriendo sesión…</p>}>
          <SessionFromLink />
        </Suspense>
      </div>
    </div>
  );
}
