// Listado maestro de procesos y documentos (Excel): reconoce las columnas,
// deja solo lo vigente y una fila por código (la versión más alta).
import { normalize } from "@/lib/text";

export type MasterField = "code" | "version" | "name" | "typology" | "parent" | "owner" | "area" | "status" | "valid_from";

const EXACT: Record<MasterField, string[]> = {
  code: ["codigo", "code", "codigodocumento", "codigodeldocumento"],
  version: ["version", "versiondeldocumento"],
  name: ["nombre", "titulo", "nombredeldocumento", "nombredocumento"],
  typology: ["tipologia", "tipodedocumento", "tipodocumento", "tipo"],
  parent: ["codigodocumentopadre", "documentopadre", "codigopadre", "padre", "codigodelpadre"],
  owner: ["responsabledeldocumento", "responsable", "dueno"],
  area: ["arealider", "area", "arearesponsable"],
  status: ["estado"],
  valid_from: ["vigencia", "fechadevigencia", "fecha", "vigentedesde"],
};

export function detectMasterColumns(headers: string[]): Record<string, MasterField> {
  const out: Record<string, MasterField> = {};
  const used = new Set<MasterField>();
  for (const h of headers) {
    const n = normalize(h);
    const f = (Object.keys(EXACT) as MasterField[]).find((k) => !used.has(k) && EXACT[k].includes(n));
    if (f) { out[h] = f; used.add(f); }
  }
  return out;
}

export type MasterRow = {
  line: number; code: string; name: string; typology: string;
  parent?: string; version?: string; owner?: string; area?: string; valid_from?: string;
};

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** 22/10/2024, 2024-10-22 o el número de serie de Excel → AAAA-MM-DD. */
export function parseDate(v: unknown): string | undefined {
  if (v === null || v === undefined || v === "") return undefined;
  if (typeof v === "number" && v > 20000 && v < 80000) {
    return new Date(Date.UTC(1899, 11, 30) + v * 86400000).toISOString().slice(0, 10);
  }
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return undefined;
}

const versionNumber = (v: string | undefined) => {
  const n = Number.parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : -1;
};

export function mapMasterRows(raw: Record<string, unknown>[], headerLine = 1): {
  rows: MasterRow[]; errors: string[]; warnings: string[]; skipped: number;
} {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!raw.length) return { rows: [], errors: ["El archivo no tiene filas."], warnings, skipped: 0 };
  const cols = detectMasterColumns(Object.keys(raw[0]));
  const has = new Set(Object.values(cols));
  const required: [MasterField, string][] = [["code", "Código"], ["name", "Nombre"], ["typology", "Tipología"]];
  for (const [f, title] of required) if (!has.has(f)) errors.push(`Falta la columna «${title}».`);
  if (errors.length) return { rows: [], errors, warnings, skipped: 0 };

  const byCode = new Map<string, MasterRow>();
  let skipped = 0;
  raw.forEach((r, i) => {
    const line = headerLine + 1 + i;
    const o: Partial<Record<MasterField, unknown>> = {};
    for (const [h, f] of Object.entries(cols)) o[f] = r[h];
    const code = String(o.code ?? "").replace(/\s+/g, "");
    if (!code && !clip(o.name, 5)) return;
    // Solo lo vigente: los obsoletos y los que no tienen estado se omiten
    if (has.has("status") && normalize(o.status) !== "vigente") { skipped++; return; }
    if (!code) { errors.push(`Fila ${line}: falta el código.`); return; }
    if (code.length > 60) { errors.push(`Fila ${line}: el código supera 60 caracteres.`); return; }
    const row: MasterRow = { line, code, name: clip(o.name, 250), typology: clip(o.typology, 60) };
    if (row.name.length < 2) { errors.push(`Fila ${line}: falta el nombre de ${code}.`); return; }
    if (!row.typology) { errors.push(`Fila ${line}: falta la tipología de ${code}.`); return; }
    const parent = String(o.parent ?? "").replace(/\s+/g, "");
    if (parent && parent !== code) row.parent = parent.slice(0, 60);
    if (clip(o.version, 20)) row.version = clip(o.version, 20);
    if (clip(o.owner, 120)) row.owner = clip(o.owner, 120);
    if (clip(o.area, 160)) row.area = clip(o.area, 160);
    const d = parseDate(o.valid_from);
    if (d) row.valid_from = d;
    const prev = byCode.get(code);
    if (prev) {
      // Dos filas vigentes con el mismo código: queda la versión más alta
      if (versionNumber(row.version) >= versionNumber(prev.version)) byCode.set(code, row);
      warnings.push(`${code} aparece varias veces como vigente; se toma la versión ${byCode.get(code)!.version ?? "más reciente"}.`);
    } else {
      byCode.set(code, row);
    }
  });
  const rows = [...byCode.values()];
  if (rows.length > 10000) errors.push("El archivo supera 10.000 filas vigentes.");
  return { rows, errors: errors.slice(0, 200), warnings: warnings.slice(0, 100), skipped };
}
