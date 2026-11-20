"use client";
import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { detectMapping, hasIdentifierColumn } from "@/lib/asset-import";
import { FIELD_LABELS as BASE_LABELS } from "@/lib/asset-profiles";
import { readWorkbook, rowsToObjects, writeWorkbook, type SheetData } from "@/lib/spreadsheet";
import { processAssetImport, type ImportPreview } from "../actions";

const FIELD_LABELS: Record<string, string> = {
  ...BASE_LABELS,
  code: "Identificador único",
  id_placa: "Placa (identificador de computadores)",
  id_imei: "IMEI (identificador de celulares y tabletas)",
  id_documento: "Documento de identidad (identificador de empleados)",
  attributes: "Dato adicional",
};

/** Primera fila (de las 20 primeras) que tenga una columna de código reconocible. */
function guessHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    const m = detectMapping((rows[i] ?? []).map((c) => String(c ?? "")));
    if (hasIdentifierColumn(m) && Object.values(m).includes("asset_type_id")) return i;
  }
  return 0;
}

export default function AssetImporter() {
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [applied, setApplied] = useState<ImportPreview | null>(null);
  const [readError, setReadError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const objects = useMemo(() => {
    const s = sheets[sheetIndex];
    return s ? rowsToObjects(s.rows, headerRow) : [];
  }, [sheets, sheetIndex, headerRow]);
  const mapping = useMemo(() => detectMapping(Object.keys(objects[0] ?? {})), [objects]);

  async function onFile(file: File | undefined) {
    setPreview(null);
    setApplied(null);
    setReadError(null);
    if (!file) return;
    if (file.size > 15 * 1024 * 1024) return setReadError("El archivo supera 15 MB.");
    try {
      const wb = await readWorkbook(file);
      // Elige la hoja con más filas que tenga columna de código
      let best = 0;
      wb.forEach((s, i) => {
        const hasCode = hasIdentifierColumn(detectMapping((s.rows[guessHeaderRow(s.rows)] ?? []).map(String)));
        const bestHas = hasIdentifierColumn(detectMapping((wb[best].rows[guessHeaderRow(wb[best].rows)] ?? []).map(String)));
        if ((hasCode && !bestHas) || (hasCode === bestHas && s.rows.length > wb[best].rows.length)) best = i;
      });
      setFileName(file.name);
      setSheets(wb);
      setSheetIndex(best);
      setHeaderRow(guessHeaderRow(wb[best]?.rows ?? []));
    } catch {
      setReadError("No se pudo leer el archivo. Usa Excel (.xlsx, .xls) o CSV.");
    }
  }

  function analyze() {
    setApplied(null);
    start(async () => setPreview(await processAssetImport(fileName, objects, false)));
  }
  function apply() {
    start(async () => {
      const res = await processAssetImport(fileName, objects, true);
      setApplied(res);
      if (res.ok) setPreview(null);
    });
  }
  function downloadDiff(p: ImportPreview) {
    const s = p.summary!;
    void writeWorkbook(`diferencias-${fileName.replace(/\.[^.]+$/, "")}.xlsx`, [
      { name: "Nuevos", rows: s.lista_nuevos.map((code) => ({ Código: code })) },
      {
        name: "Modificados",
        rows: s.lista_modificados.flatMap((m) =>
          Object.entries(m.cambios).map(([f, c]) => ({
            Código: m.code,
            Campo: FIELD_LABELS[f] ?? f,
            Antes: typeof c.antes === "object" ? JSON.stringify(c.antes) : c.antes,
            Ahora: typeof c.ahora === "object" ? JSON.stringify(c.ahora) : c.ahora,
          })),
        ),
      },
      { name: "No incluidos", rows: s.lista_ausentes.map((code) => ({ Código: code })) },
    ]);
  }

  const result = applied ?? preview;
  return (
    <div className="stack" style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel">
        <h2>1. Archivo</h2>
        <p className="small muted">
          Usa la <a href="/activos/plantilla">plantilla de carga</a> para evitar problemas de formato: trae listas
          desplegables y la explicación de cada campo. Para actualizar el inventario del mes, parte de{" "}
          <a href="/activos/plantilla?datos=1">Exportar inventario</a>, que conserva los identificadores asignados.
        </p>
        <label>
          Inventario en Excel o CSV
          <input type="file" accept=".xlsx,.xls,.csv" onChange={(e) => onFile(e.target.files?.[0])} />
        </label>
        {readError && <div className="alert error">{readError}</div>}
        {sheets.length > 0 && (
          <div className="row">
            <label>
              Hoja
              <select value={sheetIndex} onChange={(e) => { const i = Number(e.target.value); setSheetIndex(i); setHeaderRow(guessHeaderRow(sheets[i].rows)); setPreview(null); }}>
                {sheets.map((s, i) => (
                  <option key={s.name} value={i}>{s.name} ({s.rows.length} filas)</option>
                ))}
              </select>
            </label>
            <label>
              Fila de encabezados
              <input type="number" min={1} max={50} value={headerRow + 1} onChange={(e) => { setHeaderRow(Math.max(0, Number(e.target.value) - 1)); setPreview(null); }} />
            </label>
            <span className="small muted">{objects.length} filas de datos</span>
          </div>
        )}
      </section>

      {objects.length > 0 && (
        <section className="panel">
          <h2>2. Columnas reconocidas</h2>
          <p className="small muted">
            Las columnas que no corresponden a un campo estándar se guardan como datos adicionales del activo. El
            identificador único (placa, IMEI, serial, documento o etiqueta, según el tipo) es el que reconoce cada activo
            entre una carga y la siguiente.
          </p>
          <div className="tablewrap">
            <table>
              <thead><tr><th>Columna del archivo</th><th>Campo en la plataforma</th><th>Ejemplo</th></tr></thead>
              <tbody>
                {Object.entries(mapping).map(([col, field]) => (
                  <tr key={col}>
                    <td>{col}</td>
                    <td>{field === "attributes" ? <span className="muted">Dato adicional</span> : <b>{FIELD_LABELS[field]}</b>}</td>
                    <td className="small muted">{String(objects.find((o) => o[col] !== null)?.[col] ?? "")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <button type="button" onClick={analyze} disabled={pending || !hasIdentifierColumn(mapping)}>
              {pending && !applied ? "Analizando…" : "Analizar diferencias"}
            </button>
          </div>
        </section>
      )}

      {result && (
        <section className="panel">
          <h2>{applied?.ok ? "Carga aplicada" : "3. Diferencias frente al inventario actual"}</h2>
          {result.message && <div className="alert error">{result.message}</div>}
          {result.errors && result.errors.length > 0 && (
            <div className="alert error">
              <b>Corrige el archivo antes de cargarlo:</b>
              <ul style={{ margin: "6px 0 0", paddingLeft: 18 }}>
                {result.errors.map((e) => <li key={e}>{e}</li>)}
              </ul>
            </div>
          )}
          {result.summary && (
            <>
              <div className="kpis">
                <div className="kpi ok"><b>{result.summary.nuevos}</b><small>nuevos</small></div>
                <div className="kpi"><b>{result.summary.modificados}</b><small>con cambios</small></div>
                <div className="kpi"><b>{result.summary.sin_cambios}</b><small>sin cambios</small></div>
                <div className={`kpi ${result.summary.ausentes ? "bad" : ""}`}><b>{result.summary.ausentes}</b><small>no vienen en el archivo</small></div>
              </div>
              {result.summary.ausentes > 0 && (
                <p className="small muted">
                  Los activos que no vienen en el archivo no se borran ni se modifican. Revísalos: pueden ser bajas, hurtos o
                  errores de la consolidación.
                </p>
              )}
              {result.summary.lista_modificados.length > 0 && (
                <details>
                  <summary>Ver cambios ({result.summary.modificados})</summary>
                  <div className="tablewrap">
                    <table>
                      <thead><tr><th>Código</th><th>Campo</th><th>Antes</th><th>Ahora</th></tr></thead>
                      <tbody>
                        {result.summary.lista_modificados.slice(0, 200).flatMap((m) =>
                          Object.entries(m.cambios).map(([f, c]) => (
                            <tr key={m.code + f}>
                              <td className="mono">{m.code}</td>
                              <td>{FIELD_LABELS[f] ?? f}</td>
                              <td className="small muted">{c.antes === null ? "∅" : typeof c.antes === "object" ? JSON.stringify(c.antes) : String(c.antes)}</td>
                              <td className="small">{c.ahora === null ? "∅" : typeof c.ahora === "object" ? JSON.stringify(c.ahora) : String(c.ahora)}</td>
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
              {result.warnings && result.warnings.length > 0 && (
                <details>
                  <summary>Avisos ({result.warnings.length})</summary>
                  <ul className="small">{result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                </details>
              )}
              <div className="row">
                <button type="button" className="ghost" onClick={() => downloadDiff(result)}>Descargar diferencias (Excel)</button>
                {!applied && (
                  <button type="button" onClick={apply} disabled={pending || (result.summary.nuevos === 0 && result.summary.modificados === 0)}>
                    {pending ? "Aplicando…" : `Aplicar ${result.summary.nuevos + result.summary.modificados} cambios`}
                  </button>
                )}
                {applied?.ok && <Link className="btn" href="/activos">Ver inventario</Link>}
              </div>
            </>
          )}
        </section>
      )}
    </div>
  );
}
