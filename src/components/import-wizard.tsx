"use client";
// Asistente de importación desde Excel/CSV, común a activos y controles.
// 1. Lee el archivo en el navegador y lo valida de inmediato.
// 2. Si hay errores, informa que el archivo NO se cargó y permite corregirlo
//    y volver a validarlo.
// 3. Muestra las diferencias y aplica los cambios solo al confirmar (todo o nada).
import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { detectMapping, hasIdentifierColumn } from "@/lib/asset-import";
import { detectControlMapping, hasControlId } from "@/lib/control-import";
import { readWorkbook, rowsToObjects, writeWorkbook, type SheetData } from "@/lib/spreadsheet";
import { processAssetImport, type ImportPreview } from "@/app/(app)/activos/actions";
import { processControlImport } from "@/app/(app)/controles/actions";

type Kind = "activos" | "controles";

const CONFIG: Record<Kind, { noun: string; idLabel: string; listHref: string; templateHref: string; exportHref: string }> = {
  activos: {
    noun: "activos",
    idLabel: "identificador único",
    listHref: "/activos",
    templateHref: "/activos/plantilla",
    exportHref: "/activos/plantilla?datos=1",
  },
  controles: {
    noun: "controles",
    idLabel: "ID",
    listHref: "/controles",
    templateHref: "/controles/plantilla",
    exportHref: "/controles/plantilla?datos=1",
  },
};

function mappingOf(kind: Kind, headers: string[]): Record<string, string> {
  return kind === "activos" ? detectMapping(headers) : detectControlMapping(headers);
}
function isValidLayout(kind: Kind, m: Record<string, string>): boolean {
  return kind === "activos" ? hasIdentifierColumn(m) && Object.values(m).includes("asset_type_id") : hasControlId(m);
}
function guessHeaderRow(kind: Kind, rows: unknown[][]): number {
  for (let i = 0; i < Math.min(rows.length, 20); i++) {
    if (isValidLayout(kind, mappingOf(kind, (rows[i] ?? []).map((c) => String(c ?? ""))))) return i;
  }
  return 0;
}

const HELPER_SHEETS = ["instrucciones", "listas"];

/** Qué tan probable es que la hoja sea la de datos. */
function sheetScore(kind: Kind, sheet: SheetData): { valid: boolean; columns: number; rows: number } {
  const hr = guessHeaderRow(kind, sheet.rows);
  const m = mappingOf(kind, (sheet.rows[hr] ?? []).map((c) => String(c ?? "")));
  const helper = HELPER_SHEETS.includes(sheet.name.trim().toLowerCase());
  return {
    valid: !helper && isValidLayout(kind, m),
    columns: Object.values(m).filter((v) => v !== "ignorada").length,
    rows: sheet.rows.length - hr,
  };
}

type Outcome =
  | { kind: "none" }
  | { kind: "failed"; title: string; reasons: string[]; warnings?: string[] }
  | { kind: "preview"; result: ImportPreview }
  | { kind: "applied"; result: ImportPreview };

export default function ImportWizard({ kind, labels }: { kind: Kind; labels: Record<string, string> }) {
  const cfg = CONFIG[kind];
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [sheets, setSheets] = useState<SheetData[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(0);
  const [outcome, setOutcome] = useState<Outcome>({ kind: "none" });
  const [pending, start] = useTransition();

  const objects = useMemo(() => {
    const s = sheets[sheetIndex];
    return s ? rowsToObjects(s.rows, headerRow) : [];
  }, [sheets, sheetIndex, headerRow]);
  const mapping = useMemo(() => mappingOf(kind, Object.keys(objects[0] ?? {})), [kind, objects]);

  const run = (fileName: string, rows: Record<string, unknown>[], apply: boolean) =>
    kind === "activos" ? processAssetImport(fileName, rows, apply) : processControlImport(fileName, rows, apply);

  function validate(fileName: string, rows: Record<string, unknown>[], layoutOk: boolean) {
    if (!layoutOk) {
      setOutcome({
        kind: "failed",
        title: "El archivo no se cargó: no tiene el formato de la plantilla.",
        reasons: [
          kind === "activos"
            ? "No se encontraron las columnas «Identificador único» y «Tipo de activo». Revisa la hoja y la fila de encabezados, o usa la plantilla."
            : "No se encontró la columna «ID». Revisa la hoja y la fila de encabezados, o usa la plantilla.",
        ],
      });
      return;
    }
    if (!rows.length) {
      setOutcome({ kind: "failed", title: "El archivo no se cargó: no tiene filas de datos.", reasons: [] });
      return;
    }
    start(async () => {
      try {
        const res = await run(fileName, rows, false);
        if (!res.ok) {
          setOutcome({
            kind: "failed",
            title: `El archivo no se cargó: tiene ${res.errors?.length || 1} error(es). No se guardó ningún cambio.`,
            reasons: res.errors?.length ? res.errors : [res.message ?? "Error desconocido."],
            warnings: res.warnings,
          });
        } else setOutcome({ kind: "preview", result: res });
      } catch {
        setOutcome({ kind: "failed", title: "El archivo no se cargó: no se pudo comunicar con el servidor.", reasons: ["Revisa tu conexión y vuelve a validarlo."] });
      }
    });
  }

  async function load(f: File) {
    setOutcome({ kind: "none" });
    if (f.size > 15 * 1024 * 1024) {
      setOutcome({ kind: "failed", title: "El archivo no se cargó: supera 15 MB.", reasons: [] });
      return;
    }
    try {
      const wb = await readWorkbook(f);
      // La hoja de datos es la que tiene más columnas reconocidas (no la más larga:
      // la hoja «Instrucciones» de la plantilla también nombra las columnas).
      const scores = wb.map((s) => sheetScore(kind, s));
      let best = 0;
      scores.forEach((sc, i) => {
        const b = scores[best];
        if (sc.valid !== b.valid ? sc.valid : sc.columns !== b.columns ? sc.columns > b.columns : sc.rows > b.rows) best = i;
      });
      const hr = guessHeaderRow(kind, wb[best]?.rows ?? []);
      setFile(f);
      setSheets(wb);
      setSheetIndex(best);
      setHeaderRow(hr);
      const rows = rowsToObjects(wb[best]?.rows ?? [], hr);
      validate(f.name, rows, isValidLayout(kind, mappingOf(kind, Object.keys(rows[0] ?? {}))));
    } catch {
      setOutcome({
        kind: "failed",
        title: "El archivo no se cargó: no se pudo leer.",
        reasons: ["Usa un archivo de Excel (.xlsx o .xls) o CSV. Si lo tienes abierto en Excel, guárdalo y ciérralo antes de seleccionarlo."],
      });
    }
  }

  /** Abre el selector para elegir el archivo corregido (aunque tenga el mismo nombre). */
  function chooseAgain() {
    if (inputRef.current) {
      inputRef.current.value = "";
      inputRef.current.click();
    }
  }

  /** Vuelve a leer el mismo archivo desde el disco (si el navegador lo permite). */
  async function revalidate() {
    if (!file) return chooseAgain();
    try {
      await file.slice(0, 1).arrayBuffer();
      await load(file);
    } catch {
      chooseAgain();
    }
  }

  function apply() {
    if (!file) return;
    start(async () => {
      try {
        const res = await run(file.name, objects, true);
        if (res.ok) setOutcome({ kind: "applied", result: res });
        else
          setOutcome({
            kind: "failed",
            title: "El archivo no se cargó. No se guardó ningún cambio.",
            reasons: res.errors?.length ? res.errors : [res.message ?? "Error desconocido."],
          });
      } catch {
        setOutcome({ kind: "failed", title: "El archivo no se cargó: no se pudo comunicar con el servidor. No se guardó ningún cambio.", reasons: [] });
      }
    });
  }

  function downloadDiff(p: ImportPreview) {
    const s = p.summary!;
    const base = (file?.name ?? "archivo").replace(/\.[^.]+$/, "");
    void writeWorkbook(`diferencias-${base}.xlsx`, [
      { name: "Nuevos", rows: s.lista_nuevos.map((code) => ({ [cfg.idLabel]: code })) },
      {
        name: "Modificados",
        rows: s.lista_modificados.flatMap((m) =>
          Object.entries(m.cambios).map(([f, c]) => ({
            [cfg.idLabel]: m.code,
            Campo: labels[f] ?? f,
            Antes: typeof c.antes === "object" && c.antes !== null ? JSON.stringify(c.antes) : c.antes,
            Ahora: typeof c.ahora === "object" && c.ahora !== null ? JSON.stringify(c.ahora) : c.ahora,
          })),
        ),
      },
      { name: "No incluidos", rows: s.lista_ausentes.map((code) => ({ [cfg.idLabel]: code })) },
    ]);
  }

  const summary = outcome.kind === "preview" || outcome.kind === "applied" ? outcome.result.summary : undefined;
  const show = (v: unknown) => (v === null || v === undefined ? "∅" : typeof v === "object" ? JSON.stringify(v) : String(v));

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <section className="panel">
        <h2>1. Archivo</h2>
        <p className="small muted">
          Usa la <a href={cfg.templateHref}>plantilla de carga</a>: trae listas desplegables y la explicación de cada campo.
          Para actualizar lo que ya existe, parte de <a href={cfg.exportHref}>la exportación actual</a>.
        </p>
        <div className="form-grid">
          <label className="span-2">
            Archivo de Excel o CSV
            <input
              ref={inputRef}
              type="file"
              accept=".xlsx,.xls,.csv"
              disabled={pending}
              onClick={(e) => ((e.target as HTMLInputElement).value = "")}
              onChange={(e) => e.target.files?.[0] && load(e.target.files[0])}
            />
          </label>
          {sheets.length > 1 && (
            <label>
              Hoja
              <select
                value={sheetIndex}
                onChange={(e) => {
                  const i = Number(e.target.value);
                  const hr = guessHeaderRow(kind, sheets[i].rows);
                  setSheetIndex(i);
                  setHeaderRow(hr);
                  const rows = rowsToObjects(sheets[i].rows, hr);
                  validate(file?.name ?? "archivo", rows, isValidLayout(kind, mappingOf(kind, Object.keys(rows[0] ?? {}))));
                }}
              >
                {sheets.map((s, i) => <option key={s.name} value={i}>{s.name} ({s.rows.length} filas)</option>)}
              </select>
            </label>
          )}
          {sheets.length > 0 && (
            <label>
              Fila de encabezados
              <input
                type="number"
                min={1}
                max={50}
                value={headerRow + 1}
                onChange={(e) => {
                  const hr = Math.max(0, Number(e.target.value) - 1);
                  setHeaderRow(hr);
                  setOutcome({ kind: "none" });
                }}
              />
            </label>
          )}
          {sheets.length > 0 && outcome.kind === "none" && !pending && (
            <div style={{ alignSelf: "end" }}>
              <button type="button" onClick={() => validate(file?.name ?? "archivo", objects, isValidLayout(kind, mapping))}>
                Validar archivo
              </button>
            </div>
          )}
        </div>
        {file && <p className="small muted">{file.name} · {objects.length} filas de datos</p>}
        {pending && <div className="alert info">Validando el archivo…</div>}
      </section>

      {outcome.kind === "failed" && (
        <section className="panel" style={{ borderColor: "var(--crit)" }}>
          <div className="alert error" role="alert"><b>{outcome.title}</b></div>
          {outcome.reasons.length > 0 && (
            <>
              <p className="small">Corrige lo siguiente en el archivo, guárdalo y vuelve a validarlo:</p>
              <ul className="small" style={{ margin: 0, paddingLeft: 18, maxHeight: 320, overflow: "auto" }}>
                {outcome.reasons.map((r) => <li key={r}>{r}</li>)}
              </ul>
            </>
          )}
          <div className="row">
            <button type="button" onClick={chooseAgain} disabled={pending}>Seleccionar el archivo corregido</button>
            {file && <button type="button" className="ghost" onClick={revalidate} disabled={pending}>Validar de nuevo el mismo archivo</button>}
            <a className="btn ghost" href={cfg.templateHref}>Descargar plantilla</a>
          </div>
        </section>
      )}

      {objects.length > 0 && outcome.kind !== "applied" && (
        <details className="panel">
          <summary>Columnas reconocidas ({Object.values(mapping).filter((v) => v !== "attributes" && v !== "ignorada").length} de {Object.keys(mapping).length})</summary>
          <div className="tablewrap" style={{ marginTop: 8 }}>
            <table>
              <thead><tr><th>Columna del archivo</th><th>Campo en la plataforma</th></tr></thead>
              <tbody>
                {Object.entries(mapping).map(([col, field]) => (
                  <tr key={col}>
                    <td>{col}</td>
                    <td>{field === "attributes" ? <span className="muted">Dato adicional</span> : field === "ignorada" ? <span className="muted">No se usa</span> : <b>{labels[field] ?? field}</b>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}

      {summary && (
        <section className="panel" style={outcome.kind === "applied" ? { borderColor: "var(--good)" } : undefined}>
          {outcome.kind === "applied" ? (
            <div className="alert ok" role="status">
              <b>Archivo cargado correctamente:</b> {summary.nuevos} {cfg.noun} nuevos y {summary.modificados} actualizados.
            </div>
          ) : (
            <h2>2. Archivo validado: revisa las diferencias antes de cargarlo</h2>
          )}
          <div className="kpis">
            <div className="kpi ok"><b>{summary.nuevos}</b><small>nuevos</small></div>
            <div className="kpi"><b>{summary.modificados}</b><small>con cambios</small></div>
            <div className="kpi"><b>{summary.sin_cambios}</b><small>sin cambios</small></div>
            <div className={`kpi ${summary.ausentes ? "bad" : ""}`}><b>{summary.ausentes}</b><small>no vienen en el archivo</small></div>
          </div>
          {summary.ausentes > 0 && (
            <p className="small muted">
              Los {cfg.noun} que no vienen en el archivo no se borran ni se modifican. Revísalos en «Descargar diferencias».
            </p>
          )}
          {summary.lista_modificados.length > 0 && (
            <details>
              <summary>Ver cambios ({summary.modificados})</summary>
              <div className="tablewrap">
                <table>
                  <thead><tr><th>{cfg.idLabel}</th><th>Campo</th><th>Antes</th><th>Ahora</th></tr></thead>
                  <tbody>
                    {summary.lista_modificados.slice(0, 200).flatMap((m) =>
                      Object.entries(m.cambios).map(([f, c]) => (
                        <tr key={m.code + f}>
                          <td className="mono">{m.code}</td>
                          <td>{labels[f] ?? f}</td>
                          <td className="small muted">{show(c.antes)}</td>
                          <td className="small">{show(c.ahora)}</td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </details>
          )}
          {outcome.kind === "preview" && outcome.result.warnings && outcome.result.warnings.length > 0 && (
            <details>
              <summary>Avisos ({outcome.result.warnings.length})</summary>
              <ul className="small">{outcome.result.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </details>
          )}
          <div className="row">
            <button type="button" className="ghost" onClick={() => outcome.kind !== "none" && outcome.kind !== "failed" && downloadDiff(outcome.result)}>
              Descargar diferencias (Excel)
            </button>
            {outcome.kind === "preview" && (
              <button type="button" onClick={apply} disabled={pending || (summary.nuevos === 0 && summary.modificados === 0)}>
                {pending ? "Cargando…" : summary.nuevos + summary.modificados === 0 ? "No hay cambios para cargar" : `Cargar ${summary.nuevos + summary.modificados} cambios`}
              </button>
            )}
            {outcome.kind === "applied" && (
              <>
                <Link className="btn" href={cfg.listHref}>Ver {cfg.noun}</Link>
                <button type="button" className="ghost" onClick={chooseAgain}>Cargar otro archivo</button>
              </>
            )}
          </div>
        </section>
      )}
    </div>
  );
}
