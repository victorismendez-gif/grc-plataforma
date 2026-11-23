// Excel del diagnóstico GAP: resumen + hoja para calificar en bloque.
import { GAP_STATUS, CRITICALITY } from "@/lib/labels";
import { compliance, groupBy, parseGapStatus, type GapStatus } from "@/lib/gap";
import { normalize } from "@/lib/text";
import { colName, STYLE, type Cell, type Workbook } from "@/lib/xlsx-writer";

export type GapSheetItem = {
  framework: string;
  frameworkName: string;
  clause: string;
  title: string;
  topClause: string;
  topTitle: string;
  criticality: number;
  status: string | null;
  justification: string | null;
  evidence: string | null;
  commonWith: string | null;
  validated: boolean;
};

const HEADERS = ["Norma", "Cláusula", "Requisito", "Criticidad", "Estado", "Justificación", "Evidencia", "Validado", "Observación"];

export function buildGapWorkbook(input: {
  orgName: string;
  brandColor?: string;
  code: string;
  name: string;
  scope: string | null;
  partialWeight: number;
  items: GapSheetItem[];
  generatedAt?: Date;
}): Workbook {
  const date = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const statuses = Object.values(GAP_STATUS);

  // Resumen por norma y cláusula principal
  const res: Cell[][] = [
    [{ v: `Diagnóstico GAP ${input.code} · ${input.name}`, s: STYLE.title }],
    [`${input.orgName} · generado el ${date}${input.scope ? ` · Alcance: ${input.scope}` : ""}`],
    [`Cumplimiento = (cumple + ${input.partialWeight} × cumple parcial) ÷ requisitos aplicables × 100. Los «no aplica» y los pendientes no cuentan.`],
    [],
    ["Norma", "Cláusula", "Requisitos", "Cumple", "Parcial", "No cumple", "No aplica", "Pendientes", "Cumplimiento %"].map((v) => ({ v, s: STYLE.header })),
  ];
  for (const [fw, list] of groupBy(input.items, (i) => i.frameworkName)) {
    const t = compliance(list.map((i) => i.status), input.partialWeight);
    res.push([{ v: fw, s: STYLE.bold }, { v: "Total", s: STYLE.bold }, t.total, t.cumple, t.parcial, t.noCumple, t.noAplica, t.pendientes, t.pct]);
    for (const [top, sub] of groupBy(list, (i) => `${i.topClause} ${i.topTitle}`)) {
      const c = compliance(sub.map((i) => i.status), input.partialWeight);
      res.push(["", top, c.total, c.cumple, c.parcial, c.noCumple, c.noAplica, c.pendientes, c.pct]);
    }
  }

  // Calificación
  const rows: Cell[][] = [HEADERS.map((v) => ({ v, s: STYLE.header }))];
  for (const i of input.items) {
    rows.push([
      { v: i.framework, s: STYLE.text },
      { v: i.clause, s: STYLE.text },
      { v: i.title, s: STYLE.wrap },
      (CRITICALITY as Record<number, string>)[i.criticality] ?? "",
      i.status ? (GAP_STATUS as Record<string, string>)[i.status] : null,
      i.justification ? { v: i.justification, s: STYLE.wrap } : null,
      i.evidence ? { v: i.evidence, s: STYLE.wrap } : null,
      i.status ? (i.validated ? "Sí" : "No") : "",
      i.commonWith ? `Requisito común: se califica en ${i.commonWith}` : "",
    ]);
  }
  const last = Math.max(2, rows.length);
  const statusCol = colName(4);

  const ins: Cell[][] = [];
  const merges: string[] = [];
  const line = (text: string, s: number = STYLE.wrap) => {
    ins.push([{ v: text, s }]);
    merges.push(`A${ins.length}:B${ins.length}`);
  };
  line(`Calificar el diagnóstico ${input.code} desde Excel`, STYLE.title);
  [
    "1. En la hoja «Calificación» llena las columnas Estado, Justificación y Evidencia. No cambies Norma ni Cláusula: identifican el requisito.",
    "2. Estado: Cumple, Cumple parcial, No cumple o No aplica (lista desplegable). Deja vacío lo que aún no evalúas.",
    "3. «Cumple» y «Cumple parcial» requieren Evidencia (documento, registro o dónde se encuentra). «Cumple parcial», «No cumple» y «No aplica» requieren Justificación.",
    "4. Las filas marcadas como «Requisito común» se califican una sola vez, en el requisito principal indicado.",
    "5. En la plataforma, en el diagnóstico, usa «Calificar desde Excel». Verás cuántas calificaciones cambian antes de confirmar; si hay errores no se aplica nada.",
    "6. Toda calificación nueva queda pendiente de validación por una persona distinta a quien la registró.",
  ].forEach((t) => line(t));

  return {
    sheets: [
      { name: "Resumen", rows: res, columns: [{ width: 22 }, { width: 46 }, ...Array(7).fill({ width: 12 })], merges: ["A1:I1", "A2:I2", "A3:I3"], fitWidth: true },
      {
        name: "Calificación",
        rows,
        columns: [{ width: 12, style: STYLE.text }, { width: 10, style: STYLE.text }, { width: 52 }, { width: 11 }, { width: 16 }, { width: 46 }, { width: 46 }, { width: 10 }, { width: 30 }],
        freeze: { rows: 1, cols: 2 },
        autoFilter: `A1:I${last}`,
        validations: [
          { sqref: `${statusCol}2:${statusCol}${last}`, type: "list", formula1: `"${statuses.join(",")}"`, promptTitle: "Estado",
            prompt: statuses.join(", "), errorTitle: "Estado no válido", error: `Elige: ${statuses.join(", ")}.` },
        ],
        rowHeights: { 0: 28 },
        fitWidth: true,
      },
      { name: "Instrucciones", rows: ins, columns: [{ width: 60 }, { width: 60 }], merges, fitWidth: true },
    ],
    brandColor: input.brandColor,
  };
}

// ---------------------------------------------------------------------
// Lectura de la hoja «Calificación»
// ---------------------------------------------------------------------
const ALIASES: Record<string, string[]> = {
  framework: ["norma", "marco", "codigonorma"],
  clause: ["clausula", "numeral", "requisitoid", "control"],
  status: ["estado", "calificacion", "cumplimiento"],
  justification: ["justificacion", "situacionactual", "observaciones"],
  evidence_note: ["evidencia", "evidencias", "soporte"],
};

export function detectGapColumns(headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of headers) {
    const n = normalize(String(h));
    const f = Object.keys(ALIASES).find((k) => !Object.values(out).includes(k) && ALIASES[k].includes(n));
    if (f) out[h] = f;
  }
  return out;
}

export type GapImportRow = { line: number; framework: string; clause: string; status: GapStatus; justification: string; evidence_note: string };

export function mapGapRows(raw: Record<string, unknown>[], headerLine = 1): { rows: GapImportRow[]; errors: string[] } {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const map = detectGapColumns(headers);
  const has = new Set(Object.values(map));
  const errors: string[] = [];
  if (!has.has("clause")) errors.push("Falta la columna «Cláusula».");
  if (!has.has("status")) errors.push("Falta la columna «Estado».");
  if (errors.length) return { rows: [], errors };
  const rows: GapImportRow[] = [];
  raw.forEach((r, idx) => {
    const line = headerLine + idx + 1;
    const o: Record<string, string> = {};
    for (const [h, f] of Object.entries(map)) o[f] = String(r[h] ?? "").trim();
    if (!o.clause) return;
    const status = parseGapStatus(o.status);
    if (status === "") return; // sin calificar: no cambia nada
    if (status === undefined) {
      errors.push(`Fila ${line} (${o.clause}): el estado «${o.status}» no es válido. Usa Cumple, Cumple parcial, No cumple o No aplica.`);
      return;
    }
    rows.push({
      line,
      framework: o.framework ?? "",
      clause: o.clause,
      status,
      justification: (o.justification ?? "").slice(0, 4000),
      evidence_note: (o.evidence_note ?? "").slice(0, 4000),
    });
  });
  return { rows, errors };
}
