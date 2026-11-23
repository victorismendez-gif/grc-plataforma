"use client";
import { useActionState, useState } from "react";
import { createAccessLink, type AccessLinkState } from "./actions";

export default function AccessLinkButton({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState<AccessLinkState, FormData>(createAccessLink, {});
  const [copied, setCopied] = useState(false);
  return (
    <div className="stack" style={{ gap: 4 }}>
      <form action={action}>
        <input type="hidden" name="user_id" value={userId} />
        <button type="submit" className="ghost" disabled={pending} title="Enlace de un solo uso para entregar por WhatsApp, Teams o en persona">
          {pending ? "Generando…" : "Enlace de acceso"}
        </button>
      </form>
      {state.error && <span className="small txt-crit">{state.error}</span>}
      {state.link && (
        <div className="small" style={{ maxWidth: 360 }}>
          <input readOnly value={state.link} onFocus={(e) => e.currentTarget.select()} style={{ width: "100%", fontSize: 12 }} />
          <button
            type="button"
            className="ghost"
            style={{ marginTop: 4 }}
            onClick={async () => {
              await navigator.clipboard.writeText(state.link!);
              setCopied(true);
            }}
          >
            {copied ? "Copiado" : "Copiar enlace"}
          </button>
          <div className="muted">
            Envíalo a {state.email} por un canal distinto al correo. Sirve una sola vez y vence en 1 hora.
          </div>
        </div>
      )}
    </div>
  );
}
