"use client";
// Carga del listado maestro de procesos y documentos: se lee en el navegador,
// se valida en el servidor (vista previa) y se aplica al confirmar.
import { useRef, useState, useTransition } from "react";
import { readWorkbook, rowsToObjects } from "@/lib/spreadsheet";
import { detectMasterColumns } from "@/lib/process-master";
import { importMaster, type MasterImportResult } from "./actions";

export default function MasterImport() {
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Record<string, unknown>[] | null>(null);
  const [headerLine, setHeaderLine] = useState(1);
  const [name, setName] = useState("");
  const [result, setResult] = useState<(MasterImportResult & { applied?: boolean }) | null>(null);
  const [pending, start] = useTransition();

  async function load(file: File) {
    setResult(null);
    setRows(null);
    setName(file.name);
    try {
      const sheets = await readWorkbook(file);
      let best: { objs: Record<string, unknown>[]; h: number; score: number } | null = null;
      for (const s of sheets) {
        if (["instrucciones", "listas"].includes(s.name.trim().toLowerCase())) continue;
        for (let h = 0; h < Math.min(10, s.rows.length); h++) {
          const cols = Object.values(detectMasterColumns((s.rows[h] ?? []).map((c) => String(c ?? ""))));
          if (!cols.includes("code") || !cols.includes("typology")) continue;
          if (!best || cols.length > best.score) best = { objs: rowsToObjects(s.rows, h), h, score: cols.length };
        }
      }
      if (!best) {
        setResult({ ok: false, errors: ["No se encontró una hoja con las columnas «Código» y «Tipología»."] });
        return;
      }
      const b = best;
      setRows(b.objs);
      setHeaderLine(b.h + 1);
      start(async () => setResult(await importMaster(b.objs, false, b.h + 1)));
    } catch {
      setResult({ ok: false, errors: ["No se pudo leer el archivo. Usa un Excel (.xlsx) y ciérralo antes de seleccionarlo."] });
    }
  }

  function apply() {
    if (!rows) return;
    start(async () => {
      const r = await importMaster(rows, true, headerLine);
      setResult({ ...r, applied: r.ok });
      if (r.ok) setTimeout(() => window.location.reload(), 1500);
    });
  }

  return (
    <div className="stack" style={{ gap: 8 }}>
      <p className="small muted" style={{ margin: 0 }}>
        Columnas: Código, Versión, Nombre, Tipología, Código documento padre, Responsable del documento, Área líder, Estado y Vigencia.
        Los macroprocesos, procesos y subprocesos quedan en Procesos; las políticas, manuales, formatos, anexos, diagramas y demás,
        en Documentos, cada uno bajo su padre. Solo se cargan los vigentes y, si un código se repite, su versión más alta.
        Los procesos que ya existen (por ejemplo, los de las causas de riesgo) se actualizan por código.
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
            <b>{name}</b>: {result.procesos_nuevos} proceso(s) nuevos y {result.procesos_existentes} existentes;
            {" "}{result.documentos_nuevos} documento(s) nuevos y {result.documentos_existentes} existentes.
            {result.omitidos ? ` Se omiten ${result.omitidos} fila(s) obsoletas o sin estado.` : ""}
            {result.sin_padre ? ` ${result.sin_padre} registro(s) tienen un padre que no está vigente.` : ""}
          </span>
          <button type="button" onClick={apply} disabled={pending}>Cargar</button>
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
  );
}
