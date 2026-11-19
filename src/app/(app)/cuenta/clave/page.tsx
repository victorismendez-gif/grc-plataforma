import type { Metadata } from "next";
import { requireContext } from "@/lib/auth";
import Flash, { type FlashParams } from "@/components/flash";
import { changePassword } from "./actions";

export const metadata: Metadata = { title: "Mi contraseña" };

export default async function PasswordPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requireContext();
  const sp = await searchParams;
  return (
    <>
      <div className="head">
        <h1>Mi contraseña</h1>
        <p className="lead">{ctx.email}. Si llegaste desde una invitación o una recuperación, define aquí tu contraseña.</p>
      </div>
      <Flash {...sp} />
      <section className="panel" style={{ maxWidth: 460 }}>
        <form action={changePassword} className="stack">
          <label>
            Nueva contraseña
            <input name="password" type="password" autoComplete="new-password" minLength={12} required />
          </label>
          <label>
            Confirmar contraseña
            <input name="confirm" type="password" autoComplete="new-password" minLength={12} required />
          </label>
          <p className="small muted">Mínimo 12 caracteres, con mayúsculas, minúsculas, números y símbolos.</p>
          <button type="submit">Guardar</button>
        </form>
      </section>
    </>
  );
}
