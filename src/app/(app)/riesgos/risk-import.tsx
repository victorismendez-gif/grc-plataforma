"use client";
// Carga del archivo de causas y riesgos (o del registro exportado con la
// valoración): se valida en el navegador y el servidor; se aplica al confirmar.
import { useRef, useState, useTransition } from "react";
import { readWorkbook, rowsToObjects } from "@/lib/spreadsheet";
import { detectRiskColumns } from "@/lib/risk-sheet";
import { importRisks, type RiskImportResult } from "./actions";

export default function RiskImport() {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [headerLine, setHeaderLine] = useState(1);
  const [name, setName] = useState("");
  const [result, setResult] = useState<(RiskImportResult & { applied?: boolean }) | null>(null);
  const [pending, start] = useTransition();

  async function load(file: File) {
    setResult(null);
    setRows(null);
    setName(file.name);
    try {
      const sheets = await readWorkbook(file);
      let best: { objs: Record<string, unknown>[]; h: number; score: number } | null = null;
      for (const s of sheets) {
        if (["instrucciones", "listas", "escalas"].includes(s.name.trim().toLowerCase())) continue;
        for (let h = 0; h < Math.min(10, s.rows.length); h++) {
          const cols = Object.values(detectRiskColumns((s.rows[h] ?? []).map((c) => String(c ?? ""))));
          if (!cols.includes("risk_code") && !cols.includes("code")) continue;
          if (!best || cols.length > best.score) best = { objs: rowsToObjects(s.rows, h), h, score: cols.length };
        }
      }
      if (!best) {
        setResult({ ok: false, errors: ["No se encontró una hoja con la columna «Cod Riesgo» (o «ID»)."] });
        return;
      }
      const b = best;
      setRows(b.objs);
      setHeaderLine(b.h + 1);
      start(async () => setResult(await importRisks(b.objs, false, b.h + 1)));
    } catch {
      setResult({ ok: false, errors: ["No se pudo leer el archivo. Usa un Excel (.xlsx) y ciérralo antes de seleccionarlo."] });
    }
  }

  function apply() {
    if (!rows) return;
    start(async () => {
      const r = await importRisks(rows, true, headerLine);
      setResult({ ...r, applied: r.ok });
      if (r.ok) setTimeout(() => window.location.reload(), 1500);
    });
  }

  const total = (result?.nuevos ?? 0) + (result?.actualizados ?? 0) + (result?.valorados ?? 0);
  return (
    <details>
      <summary>Cargar desde Excel</summary>
      <div className="stack" style={{ gap: 8, marginTop: 8 }}>
        <p className="small muted" style={{ margin: 0 }}>
          Acepta tu archivo de causas y riesgos (Cod Causa, Causa, Tipo de riesgo, Factor, Eventos de amenaza, Cod Riesgo,
          Riesgo, Controles relacionados, Tratamiento) y el registro exportado con Probabilidad e Impacto para valorar en bloque.
          Los controles se reconocen por su código (COTI-1…).
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
              <b>{name}</b>: {result.nuevos} riesgo(s) nuevos, {result.actualizados} con cambios, {result.sin_cambios ?? 0} sin cambios
              {result.valorados ? `, ${result.valorados} valoración(es)` : ""}.
            </span>
            <button type="button" onClick={apply} disabled={pending || !total}>Cargar</button>
          </div>
        )}
        {result?.warnings && result.warnings.length > 0 && (
          <details className="small">
            <summary>{result.warnings.length} aviso(s)</summary>
            <ul style={{ paddingLeft: 18 }}>{result.warnings.map((w, i) => <li key={i}>{w}</li>)}</ul>
          </details>
        )}
        {result?.applied && <div className="alert ok">Carga aplicada. Actualizando…</div>}
      </div>
    </details>
  );
}
