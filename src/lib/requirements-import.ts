// Traduce filas de Excel/CSV a requisitos de una norma.
import { clean, normalize } from "@/lib/text";

export type RequirementRow = {
  clause: string;
  title: string;
  description: string | null;
  evidence_guidance: string | null;
  criticality: number;
  is_auditable: boolean;
};

const ALIASES: Record<keyof RequirementRow, string[]> = {
  clause: ["clausula", "numeral", "numero", "codigo", "id", "control", "requisito"],
  title: ["titulo", "nombre", "requisitotitulo", "descripcioncorta"],
  description: ["descripcion", "detalle", "texto"],
  evidence_guidance: ["guiaevidencia", "guiadeevidencia", "evidencia", "evidenciaesperada"],
  criticality: ["criticidad", "prioridad", "importancia"],
  is_auditable: ["auditable", "aplica"],
};

const CRIT: Record<string, number> = { "1": 1, baja: 1, bajo: 1, "2": 2, media: 2, medio: 2, "3": 3, alta: 3, alto: 3 };
const NO = new Set(["no", "n", "false", "0", "falso"]);

export function mapRequirementRows(raw: Record<string, unknown>[]): { rows: RequirementRow[]; errors: string[] } {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const col: Partial<Record<keyof RequirementRow, string>> = {};
  for (const h of headers) {
    const n = normalize(h);
    for (const [field, names] of Object.entries(ALIASES) as [keyof RequirementRow, string[]][]) {
      if (!col[field] && names.includes(n)) {
        col[field] = h;
        break;
      }
    }
  }
  const errors: string[] = [];
  if (!col.clause || !col.title) {
    errors.push("El archivo debe tener las columnas «Cláusula» y «Título».");
    return { rows: [], errors };
  }
  const rows: RequirementRow[] = [];
  raw.forEach((r, i) => {
    const clause = clean(r[col.clause!])?.replace(/\s+/g, "").replace(/\.$/, "");
    const title = clean(r[col.title!]);
    if (!clause && !title) return;
    if (!clause || !title) {
      errors.push(`Fila ${i + 2}: faltan la cláusula o el título.`);
      return;
    }
    const critRaw = col.criticality ? clean(r[col.criticality]) : null;
    const crit = critRaw ? CRIT[normalize(critRaw)] : 2;
    if (critRaw && !crit) errors.push(`Fila ${i + 2}: criticidad «${critRaw}» no válida (1-3 o Baja/Media/Alta).`);
    const aud = col.is_auditable ? clean(r[col.is_auditable]) : null;
    rows.push({
      clause: clause.slice(0, 30),
      title: title.slice(0, 300),
      description: col.description ? clean(r[col.description])?.slice(0, 5000) ?? null : null,
      evidence_guidance: col.evidence_guidance ? clean(r[col.evidence_guidance])?.slice(0, 3000) ?? null : null,
      criticality: crit ?? 2,
      is_auditable: aud ? !NO.has(normalize(aud)) : true,
    });
  });
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.clause)) errors.push(`Cláusula repetida: ${r.clause}.`);
    seen.add(r.clause);
  }
  if (rows.length > 3000) errors.push("El archivo supera 3.000 requisitos.");
  return { rows, errors: errors.slice(0, 100) };
}
