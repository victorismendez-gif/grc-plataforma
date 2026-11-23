"use client";
// Calificar el GAP desde Excel: lee el archivo en el navegador, valida y
// solo aplica al confirmar (todo o nada).
import { useRef, useState, useTransition } from "react";
import { readWorkbook, rowsToObjects } from "@/lib/spreadsheet";
import { detectGapColumns } from "@/lib/gap-sheet";
import { importGapRatings, type GapImportResult } from "../actions";

export default function GapImport({ assessmentId }: { assessmentId: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [headerLine, setHeaderLine] = useState(1);
  const [name, setName] = useState("");
  const [result, setResult] = useState<(GapImportResult & { applied?: boolean }) | null>(null);
  const [pending, start] = useTransition();

  async function load(file: File) {
    setResult(null);
    setRows(null);
    setName(file.name);
    try {
      const sheets = await readWorkbook(file);
      // hoja con columnas Cláusula y Estado (la plantilla se llama «Calificación»)
      for (const s of sheets) {
        for (let h = 0; h < Math.min(10, s.rows.length); h++) {
          const cols = Object.values(detectGapColumns((s.rows[h] ?? []).map((c) => String(c ?? ""))));
          if (cols.includes("clause") && cols.includes("status")) {
            const objs = rowsToObjects(s.rows, h);
            setRows(objs);
            setHeaderLine(h + 1);
            start(async () => setResult(await importGapRatings(assessmentId, objs, false, h + 1)));
            return;
          }
        }
      }
      setResult({ ok: false, errors: ["No se encontró una hoja con las columnas «Cláusula» y «Estado». Usa «Exportar a Excel» como plantilla."] });
    } catch {
      setResult({ ok: false, errors: ["No se pudo leer el archivo. Usa un Excel (.xlsx) y ciérralo antes de seleccionarlo."] });
    }
  }

  function apply() {
    if (!rows) return;
    start(async () => {
      const r = await importGapRatings(assessmentId, rows, true, headerLine);
      setResult({ ...r, applied: r.ok });
      if (r.ok) setTimeout(() => window.location.reload(), 1200);
    });
  }

  return (
    <details>
      <summary>Calificar desde Excel</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Exporta el diagnóstico, llena Estado, Justificación y Evidencia en la hoja «Calificación» y cárgalo aquí.
          Las filas sin estado no cambian nada.
        </p>
        <input ref={input} type="file" accept=".xlsx,.xls,.csv" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
        {pending && <p className="small">Validando…</p>}
        {result && !result.ok && (
          <div className="alert error">
            <b>El archivo no se cargó. No se guardó ningún cambio.</b>
            <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
              {(result.errors ?? []).slice(0, 30).map((e, i) => <li key={i}>{e}</li>)}
            </ul>
            {(result.errors?.length ?? 0) > 30 && <p className="small">…y {result.errors!.length - 30} más.</p>}
            <button type="button" className="ghost" onClick={() => { if (input.current) { input.current.value = ""; input.current.click(); } }}>
              Seleccionar el archivo corregido
            </button>
          </div>
        )}
        {result?.ok && !result.applied && (
          <div className="callout">
            <span className="small">
              <b>{name}</b>: {result.cambios} calificación(es) cambian, {result.sin_cambios} sin cambios.
            </span>
            <button type="button" onClick={apply} disabled={pending || !result.cambios}>Aplicar {result.cambios} cambio(s)</button>
          </div>
        )}
        {result?.applied && <div className="alert ok">Se aplicaron {result.cambios} calificación(es). Actualizando…</div>}
      </div>
    </details>
  );
}
