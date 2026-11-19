import type { Metadata } from "next";

export const metadata: Metadata = { title: "Sin acceso" };

export default function NoAccessPage() {
  return (
    <div className="auth">
      <div className="card">
        <h1>Tu cuenta no está habilitada</h1>
        <p className="muted">
          Tu usuario no pertenece a ninguna organización o fue desactivado. Pide al administrador de la plataforma que
          revise tu acceso.
        </p>
        <form action="/auth/salir" method="post">
          <button type="submit" className="ghost">Cerrar sesión</button>
        </form>
      </div>
    </div>
  );
}
