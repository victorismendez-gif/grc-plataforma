// Excel del registro de riesgos: lectura (causas y riesgos, valoración) y exportación.
import { normalize } from "@/lib/text";
import { parseControlCodes, parseLevel, parseStrategy, guessDimension, STRATEGIES, type Level, type Methodology } from "@/lib/risk";
import { STYLE, type Cell, type Workbook } from "@/lib/xlsx-writer";

type Field =
  | "code" | "risk_code" | "risk_name" | "cause_code" | "cause" | "category" | "factor" | "event"
  | "controls" | "treatment" | "strategy" | "process" | "probability" | "impact";

const EXACT: Record<Field, string[]> = {
  code: ["id", "idregistro", "codigoregistro", "registro"],
  risk_code: ["codriesgo", "codigoriesgo", "codigodelriesgo", "idriesgo"],
  risk_name: ["riegoscid", "riesgoscid", "riesgocid", "riesgo", "riesgos", "descripcionriesgo", "nombreriesgo", "descripciondelriesgo"],
  cause_code: ["codcausafalla", "codcausa", "codigocausa", "codigodelacausa", "idcausa"],
  cause: ["causafalla", "causa", "causas", "descripcioncausa"],
  category: ["tipoderiesgo", "tiporiesgo", "categoria", "categoriaderiesgo", "categoriariesgo"],
  factor: ["factorderiesgo", "factor", "factorriesgo"],
  event: ["eventodeamenaza", "eventosdeamenaza", "amenaza", "amenazas", "evento", "eventos"],
  controls: ["controlesditrelacionados", "controlesrelacionados", "controles", "controlesasociados", "controlesexistentes"],
  treatment: ["tratamientoposible", "tratamiento", "descripciontratamiento", "plandetratamiento"],
  strategy: ["estrategia", "estrategiadetratamiento", "opciondetratamiento"],
  process: ["proceso", "procesoasociado"],
  probability: ["probabilidad", "probabilidadinherente"],
  impact: ["impacto", "impactoinherente"],
};
const PREFIX: Partial<Record<Field, string[]>> = {
  event: ["eventosdeamenaza", "eventodeamenaza"],
  controls: ["controles"],
  treatment: ["tratamiento"],
};

export function detectRiskColumns(headers: string[]): Record<string, Field> {
  const out: Record<string, Field> = {};
  const used = new Set<Field>();
  for (const h of headers) {
    const n = normalize(h);
    let f = (Object.keys(EXACT) as Field[]).find((k) => !used.has(k) && EXACT[k].includes(n));
    if (!f) f = (Object.keys(PREFIX) as Field[]).find((k) => !used.has(k) && PREFIX[k]!.some((p) => n.startsWith(p)));
    if (f) {
      out[h] = f;
      used.add(f);
    }
  }
  return out;
}

export type RiskImportRow = {
  line: number;
  code?: string;
  risk_code?: string;
  risk_name?: string;
  dimension?: string;
  cause_code?: string;
  cause?: string;
  category?: string;
  factor?: string;
  event?: string;
  controls?: string[];
  treatment?: string;
  strategy?: string;
  process?: string;
  probability?: number | null;
  impact?: number | null;
};

const clip = (v: unknown, n: number) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, n);

export function mapRiskRows(
  raw: Record<string, unknown>[],
  m: Pick<Methodology, "probability_levels" | "impact_levels">,
  knownControls: string[],
  headerLine = 1,
): { rows: RiskImportRow[]; errors: string[]; warnings: string[] } {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const map = detectRiskColumns(headers);
  const has = new Set(Object.values(map));
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!has.has("code") && !has.has("risk_code")) {
    return { rows: [], errors: ["Falta la columna «Cod Riesgo» (o «ID» si actualizas un registro exportado)."], warnings };
  }
  const seen = new Map<string, number>();
  const rows: RiskImportRow[] = [];
  raw.forEach((r, idx) => {
    const line = headerLine + idx + 1;
    const o: Partial<Record<Field, unknown>> = {};
    for (const [h, f] of Object.entries(map)) o[f] = r[h];
    const row: RiskImportRow = { line };
    if (clip(o.code, 40)) row.code = clip(o.code, 40);
    if (clip(o.risk_code, 30)) row.risk_code = clip(o.risk_code, 30);
    if (!row.code && !row.risk_code) {
      if (Object.values(o).some((v) => clip(v, 5))) warnings.push(`Fila ${line}: sin código de riesgo; se omitió.`);
      return;
    }
    if (row.risk_code && !/^[A-Za-z0-9._-]{1,30}$/.test(row.risk_code)) {
      errors.push(`Fila ${line}: el código de riesgo «${row.risk_code}» solo admite letras, números, punto, guion y guion bajo.`);
      return;
    }
    if (clip(o.risk_name, 500)) {
      row.risk_name = clip(o.risk_name, 500);
      row.dimension = guessDimension(row.risk_name) ?? undefined;
    }
    if (clip(o.cause_code, 30)) row.cause_code = clip(o.cause_code, 30);
    if (row.cause_code && !/^[A-Za-z0-9._-]{1,30}$/.test(row.cause_code)) {
      errors.push(`Fila ${line}: el código de causa «${row.cause_code}» no es válido.`);
      return;
    }
    if (clip(o.cause, 1000)) row.cause = clip(o.cause, 1000);
    if (clip(o.category, 160)) row.category = clip(o.category, 160);
    if (clip(o.factor, 160)) row.factor = clip(o.factor, 160);
    if (clip(o.event, 2000)) row.event = clip(o.event, 2000);
    if (map && has.has("controls")) {
      const codes = parseControlCodes(o.controls, knownControls);
      if (codes.length) row.controls = codes;
    }
    if (clip(o.treatment, 4000)) row.treatment = String(o.treatment).trim().slice(0, 4000);
    const strat = has.has("strategy") ? parseStrategy(o.strategy) ?? parseStrategyLabel(o.strategy) : null;
    row.strategy = strat ?? parseStrategy(row.treatment) ?? undefined;
    if (clip(o.process, 160)) row.process = clip(o.process, 160);
    if (has.has("probability") || has.has("impact")) {
      const p = parseLevel(o.probability, m.probability_levels as Level[]);
      const i = parseLevel(o.impact, m.impact_levels as Level[]);
      if (p === undefined) errors.push(`Fila ${line}: probabilidad «${clip(o.probability, 30)}» no está en la escala (1 a ${m.probability_levels.length}).`);
      if (i === undefined) errors.push(`Fila ${line}: impacto «${clip(o.impact, 30)}» no está en la escala (1 a ${m.impact_levels.length}).`);
      if (p === undefined || i === undefined) return;
      if ((p === null) !== (i === null)) {
        errors.push(`Fila ${line}: indica probabilidad e impacto juntos.`);
        return;
      }
      if (p !== null) {
        row.probability = p;
        row.impact = i;
      }
    }
    const key = row.code ?? normalize([row.risk_code, row.cause_code, row.category, row.event].join("|"));
    if (seen.has(key)) {
      warnings.push(`Fila ${line}: repite la fila ${seen.get(key)} (mismo riesgo, causa, tipo y evento); se tomó una sola vez.`);
      return;
    }
    seen.set(key, line);
    rows.push(row);
  });
  if (rows.length > 5000) errors.push("El archivo supera 5.000 filas.");
  return { rows, errors: errors.slice(0, 200), warnings: warnings.slice(0, 100) };
}

function parseStrategyLabel(v: unknown) {
  const n = normalize(String(v ?? ""));
  return (Object.entries(STRATEGIES).find(([, label]) => normalize(label) === n)?.[0] as keyof typeof STRATEGIES | undefined) ?? null;
}

// ---------------------------------------------------------------------
// Exportación
// ---------------------------------------------------------------------
export type RiskSheetEntry = {
  code: string; risk_code: string; risk_name: string; cause_code: string | null; cause: string | null;
  category: string | null; factor: string | null; threat_event: string | null; controls: string[];
  treatment_description: string | null; treatment_strategy: string | null; process: string | null; owner: string | null;
  inherent_probability: number | null; inherent_impact: number | null; inherent_score: number | null; inherent_zone: string | null;
  residual_probability: number | null; residual_impact: number | null; residual_score: number | null; residual_zone: string | null;
  out_of_tolerance: boolean; accepted: boolean;
};

const HEADERS = [
  "ID", "Cod Riesgo", "Riesgo", "Cod Causa", "Causa", "Tipo de riesgo", "Factor de riesgo", "Evento de amenaza",
  "Controles relacionados", "Tratamiento", "Estrategia", "Proceso", "Responsable", "Probabilidad", "Impacto",
  "Riesgo inherente", "Zona inherente", "Riesgo residual", "Zona residual", "Fuera de tolerancia",
];

export function buildRiskWorkbook(input: { orgName: string; brandColor?: string; m: Methodology; entries: RiskSheetEntry[]; generatedAt?: Date }): Workbook {
  const { m } = input;
  const date = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  const pLabels = m.probability_levels.map((l) => `${l.level} - ${l.name}`);
  const iLabels = m.impact_levels.map((l) => `${l.level} - ${l.name}`);
  const rows: Cell[][] = [HEADERS.map((v) => ({ v, s: STYLE.header }))];
  for (const e of input.entries) {
    rows.push([
      { v: e.code, s: STYLE.text }, { v: e.risk_code, s: STYLE.text }, { v: e.risk_name, s: STYLE.wrap },
      e.cause_code ? { v: e.cause_code, s: STYLE.text } : null, e.cause ? { v: e.cause, s: STYLE.wrap } : null,
      e.category, e.factor, e.threat_event ? { v: e.threat_event, s: STYLE.wrap } : null,
      e.controls.join("; "), e.treatment_description ? { v: e.treatment_description, s: STYLE.wrap } : null,
      e.treatment_strategy ? (STRATEGIES as Record<string, string>)[e.treatment_strategy] : null,
      e.process, e.owner,
      e.inherent_probability ? pLabels[e.inherent_probability - 1] ?? e.inherent_probability : null,
      e.inherent_impact ? iLabels[e.inherent_impact - 1] ?? e.inherent_impact : null,
      e.inherent_score, e.inherent_zone, e.residual_score, e.residual_zone,
      e.residual_score === null ? "" : e.accepted ? "Aceptado" : e.out_of_tolerance ? "Sí" : "No",
    ]);
  }
  const last = Math.max(2, rows.length);
  const lists = [pLabels, iLabels, Object.values(STRATEGIES)];
  const listRows: Cell[][] = [["Probabilidad", "Impacto", "Estrategia"].map((v) => ({ v, s: STYLE.header }))];
  for (let k = 0; k < Math.max(...lists.map((l) => l.length)); k++) listRows.push(lists.map((l) => l[k] ?? null));

  const scale: Cell[][] = [
    [{ v: `Metodología de riesgo · versión ${m.version}`, s: STYLE.title }],
    [`Nivel de riesgo = ${m.formula === "suma" ? "probabilidad + impacto" : "probabilidad × impacto"}. Apetito: hasta ${m.appetite}. Tolerancia: hasta ${m.tolerance}; por encima exige tratamiento o aceptación aprobada.`],
    [],
    [{ v: "Probabilidad", s: STYLE.header }, { v: "Nombre", s: STYLE.header }, { v: "Descripción", s: STYLE.header }],
    ...m.probability_levels.map((l) => [l.level, l.name, { v: l.description ?? "", s: STYLE.wrap }] as Cell[]),
    [],
    [{ v: "Impacto", s: STYLE.header }, { v: "Nombre", s: STYLE.header }, { v: "Descripción", s: STYLE.header }],
    ...m.impact_levels.map((l) => [l.level, l.name, { v: l.description ?? "", s: STYLE.wrap }] as Cell[]),
    [],
    [{ v: "Zona", s: STYLE.header }, { v: "Desde", s: STYLE.header }, { v: "Color", s: STYLE.header }],
    ...[...m.zones].sort((a, b) => a.min - b.min).map((z) => [z.name, z.min, z.color] as Cell[]),
  ];

  const ins: Cell[][] = [];
  const merges: string[] = [];
  const line = (t: string, s: number = STYLE.wrap) => {
    ins.push([{ v: t, s }]);
    merges.push(`A${ins.length}:B${ins.length}`);
  };
  line(`Registro de riesgos · ${input.orgName} · ${date}`, STYLE.title);
  [
    "1. Para valorar: elige Probabilidad e Impacto (listas desplegables) en la hoja «Registro» y carga el archivo en Riesgos → «Cargar desde Excel». La plataforma calcula el riesgo inherente y el residual.",
    "2. El residual lo calcula la plataforma con los controles relacionados: los preventivos y detectivos reducen la probabilidad, los correctivos el impacto, según su efectividad (Débil, Moderado, Fuerte). Solo cuentan los controles implementados o en implementación.",
    "3. Para agregar riesgos nuevos deja vacía la columna ID y llena Cod Riesgo, Riesgo, Cod Causa, Causa, Tipo de riesgo, Factor, Evento de amenaza y Controles relacionados (códigos COTI separados por «;»).",
    "4. No cambies la columna ID: identifica el riesgo en la plataforma. Las columnas de zona y residual son informativas.",
    "5. La carga muestra una vista previa; si hay errores no se aplica ningún cambio.",
    "6. La hoja «Escalas» explica cada nivel de probabilidad e impacto de la metodología vigente.",
  ].forEach((t) => line(t));

  const col = (name: string) => String.fromCharCode(65 + HEADERS.indexOf(name));
  return {
    sheets: [
      {
        name: "Registro",
        rows,
        columns: [
          { width: 10, style: STYLE.text }, { width: 10, style: STYLE.text }, { width: 44 }, { width: 10, style: STYLE.text }, { width: 44 },
          { width: 26 }, { width: 18 }, { width: 40 }, { width: 30 }, { width: 50 }, { width: 18 }, { width: 22 }, { width: 22 },
          { width: 18 }, { width: 18 }, { width: 10 }, { width: 14 }, { width: 10 }, { width: 14 }, { width: 12 },
        ],
        freeze: { rows: 1, cols: 2 },
        autoFilter: `A1:T${last}`,
        validations: [
          { sqref: `${col("Probabilidad")}2:${col("Probabilidad")}${last + 500}`, type: "list", formula1: "Lista_P", promptTitle: "Probabilidad", prompt: "Elige el nivel" },
          { sqref: `${col("Impacto")}2:${col("Impacto")}${last + 500}`, type: "list", formula1: "Lista_I", promptTitle: "Impacto", prompt: "Elige el nivel" },
          { sqref: `${col("Estrategia")}2:${col("Estrategia")}${last + 500}`, type: "list", formula1: "Lista_E", promptTitle: "Estrategia", prompt: "Opción de tratamiento" },
        ],
        rowHeights: { 0: 30 },
        fitWidth: true,
      },
      { name: "Escalas", rows: scale, columns: [{ width: 14 }, { width: 22 }, { width: 80 }], merges: ["A1:C1", "A2:C2"], fitWidth: true },
      { name: "Instrucciones", rows: ins, columns: [{ width: 70 }, { width: 70 }], merges, fitWidth: true },
      { name: "Listas", rows: listRows, hidden: true },
    ],
    definedNames: {
      Lista_P: `Listas!$A$2:$A$${pLabels.length + 1}`,
      Lista_I: `Listas!$B$2:$B$${iLabels.length + 1}`,
      Lista_E: `Listas!$C$2:$C$${Object.keys(STRATEGIES).length + 1}`,
    },
    brandColor: input.brandColor,
  };
}
