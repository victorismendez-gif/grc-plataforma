"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { registerFile } from "../actions";

const MAX = 50 * 1024 * 1024; // límite del plan gratuito de Supabase

function safeName(name: string): string {
  const clean = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .slice(-120);
  return clean || "archivo";
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export default function VersionUploader({ orgId, documentId, versionId }: { orgId: string; documentId: string; versionId: string }) {
  const [state, setState] = useState<{ busy: boolean; error?: string }>({ busy: false });
  const router = useRouter();

  async function onFile(file?: File) {
    if (!file) return;
    if (file.size > MAX) return setState({ busy: false, error: "El archivo supera 50 MB." });
    setState({ busy: true });
    try {
      const hash = await sha256(file);
      const path = `${orgId}/${documentId}/${versionId}/${Date.now()}_${safeName(file.name)}`;
      const supabase = createClient();
      const { error: upErr } = await supabase.storage.from("documentos").upload(path, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
      if (upErr) throw new Error("No se pudo subir el archivo. Verifica que la versión siga en borrador.");
      const res = await registerFile({ documentId, versionId, path, name: file.name, size: file.size, sha256: hash, mime: file.type });
      if (!res.ok) throw new Error(res.message ?? "No se pudo registrar el archivo.");
      setState({ busy: false });
      router.refresh();
    } catch (e) {
      setState({ busy: false, error: e instanceof Error ? e.message : "Error al subir el archivo." });
    }
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <label>
        Archivo de esta versión (PDF, Word, Excel; máximo 50 MB)
        <input type="file" disabled={state.busy} onChange={(e) => onFile(e.target.files?.[0])} />
      </label>
      {state.busy && <span className="small muted">Subiendo y calculando la huella del archivo…</span>}
      {state.error && <div className="alert error">{state.error}</div>}
    </div>
  );
}
