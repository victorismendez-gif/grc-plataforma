"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { readWorkbook, rowsToObjects } from "@/lib/spreadsheet";
import { normalize } from "@/lib/text";
import { importRequirements } from "../actions";

function headerRowOf(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const cells = (rows[i] ?? []).map((c) => normalize(c));
    if (cells.some((c) => ["clausula", "numeral", "numero"].includes(c)) && cells.some((c) => ["titulo", "nombre"].includes(c))) return i;
  }
  return 0;
}

export default function RequirementImporter({ frameworkId }: { frameworkId: string }) {
  const [message, setMessage] = useState<{ ok: boolean; text: string[] } | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  async function onFile(file?: File) {
    setMessage(null);
    if (!file) return;
    try {
      const sheets = await readWorkbook(file);
      const sheet = sheets.find((s) => headerRowOf(s.rows) > 0 || s.rows.length > 1) ?? sheets[0];
      const rows = rowsToObjects(sheet.rows, headerRowOf(sheet.rows));
      start(async () => {
        const res = await importRequirements(frameworkId, rows);
        if (res.ok && res.result) {
          setMessage({ ok: true, text: [`${res.result.nuevos} nuevos, ${res.result.actualizados} actualizados. Total: ${res.result.total}.`] });
          router.refresh();
        } else setMessage({ ok: false, text: res.errors ?? ["No se pudo importar."] });
      });
    } catch {
      setMessage({ ok: false, text: ["No se pudo leer el archivo."] });
    }
  }

  return (
    <div className="stack" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <input type="file" accept=".xlsx,.xls,.csv" disabled={pending} onChange={(e) => onFile(e.target.files?.[0])} />
      {pending && <p className="small muted">Importando…</p>}
      {message && (
        <div className={`alert ${message.ok ? "ok" : "error"}`}>
          {message.text.length === 1 ? message.text[0] : <ul style={{ margin: 0, paddingLeft: 18 }}>{message.text.map((t) => <li key={t}>{t}</li>)}</ul>}
        </div>
      )}
    </div>
  );
}
