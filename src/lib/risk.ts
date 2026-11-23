// Metodología y cálculos de riesgo (código puro, compartido por páginas y pruebas).
import { normalize } from "@/lib/text";

export type Level = { level: number; name: string; description?: string };
export type Zone = { name: string; color: string; min: number };
export type Methodology = {
  id: string;
  version: number;
  probability_levels: Level[];
  impact_levels: Level[];
  formula: "producto" | "suma";
  zones: Zone[];
  appetite: number;
  tolerance: number;
  control_reduction: Record<string, number>;
};

export const STRATEGIES = {
  mitigar: "Mitigar",
  mitigar_transferir: "Mitigar y transferir",
  transferir: "Transferir",
  aceptar: "Aceptar",
  evitar: "Evitar",
} as const;

export const DIMENSIONS = {
  confidencialidad: "Confidencialidad",
  integridad: "Integridad",
  disponibilidad: "Disponibilidad",
  otro: "Otro",
} as const;

export function score(m: Pick<Methodology, "formula">, p: number, i: number): number {
  return m.formula === "suma" ? p + i : p * i;
}

export function zoneFor(zones: Zone[], s: number): Zone {
  const sorted = [...zones].sort((a, b) => a.min - b.min);
  let z = sorted[0];
  for (const x of sorted) if (x.min <= s) z = x;
  return z;
}

/** Color de texto legible sobre el color de la zona. */
export function inkFor(hex: string): string {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#fff";
  const [r, g, b] = [m[1], m[2], m[3]].map((x) => parseInt(x, 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? "#17242b" : "#ffffff";
}

/** Matriz probabilidad (filas, de mayor a menor) × impacto (columnas). */
export function heatMap(
  m: Pick<Methodology, "probability_levels" | "impact_levels" | "formula" | "zones">,
  points: { p: number | null; i: number | null }[],
) {
  const P = m.probability_levels.length;
  const I = m.impact_levels.length;
  const counts = Array.from({ length: P }, () => Array<number>(I).fill(0));
  for (const pt of points) {
    if (!pt.p || !pt.i || pt.p > P || pt.i > I) continue;
    counts[pt.p - 1][pt.i - 1]++;
  }
  const rows = [];
  for (let p = P; p >= 1; p--) {
    rows.push({
      p,
      cells: Array.from({ length: I }, (_, k) => {
        const i = k + 1;
        const s = score(m, p, i);
        return { p, i, score: s, zone: zoneFor(m.zones, s), count: counts[p - 1][i - 1] };
      }),
    });
  }
  return rows;
}

export type EntryKpi = {
  inherent_score: number | null;
  residual_score: number | null;
  out_of_tolerance: boolean;
  has_treatment: boolean;
  accepted_at: string | null;
  materialized_count?: number;
};

/** Indicadores ISO 31000 del diseño. */
export function riskKpis(entries: EntryKpi[]) {
  const evaluated = entries.filter((e) => e.residual_score !== null && e.inherent_score !== null);
  const out = evaluated.filter((e) => e.out_of_tolerance);
  const treated = out.filter((e) => e.has_treatment || e.accepted_at);
  const avgInh = evaluated.length ? evaluated.reduce((s, e) => s + Number(e.inherent_score), 0) / evaluated.length : 0;
  const avgRes = evaluated.length ? evaluated.reduce((s, e) => s + Number(e.residual_score), 0) / evaluated.length : 0;
  return {
    total: entries.length,
    evaluados: evaluated.length,
    fueraTolerancia: out.length,
    pctFueraTolerancia: evaluated.length ? Math.round((out.length / evaluated.length) * 100) : 0,
    pctConTratamiento: out.length ? Math.round((treated.length / out.length) * 100) : null,
    reduccion: avgInh ? Math.round(((avgInh - avgRes) / avgInh) * 100) : null,
    materializados: entries.reduce((s, e) => s + (e.materialized_count ?? 0), 0),
  };
}

/** «Mitigar y transferir cuando aplique — …» → mitigar_transferir */
export function parseStrategy(text: unknown): keyof typeof STRATEGIES | null {
  const n = normalize(String(text ?? "").split(/[—–:-]/)[0]);
  if (!n) return null;
  if (n.startsWith("mitigarytransferir") || n.startsWith("mitigaretransferir")) return "mitigar_transferir";
  if (n.startsWith("mitigar") || n.startsWith("reducir")) return "mitigar";
  if (n.startsWith("transferir") || n.startsWith("compartir")) return "transferir";
  if (n.startsWith("aceptar") || n.startsWith("retener")) return "aceptar";
  if (n.startsWith("evitar")) return "evitar";
  return null;
}

/** «R1 confidencialidad…» o el texto del riesgo → dimensión C-I-D. */
export function guessDimension(name: string): keyof typeof DIMENSIONS | null {
  const n = normalize(name);
  if (n.includes("confidencial") || n.includes("divulgacion") || n.includes("acceso")) return "confidencialidad";
  if (n.includes("alteracion") || n.includes("integridad") || n.includes("desactualizacion")) return "integridad";
  if (n.includes("inaccesibilidad") || n.includes("disponibilidad") || n.includes("perdida") || n.includes("destruccion")) return "disponibilidad";
  return null;
}

/** Nivel escrito como número o por su nombre («3», «Posible», «3 - Posible»). */
export function parseLevel(raw: unknown, levels: Level[]): number | null | undefined {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  const num = /^(\d)\b/.exec(s);
  if (num) {
    const v = Number(num[1]);
    return v >= 1 && v <= levels.length ? v : undefined;
  }
  const n = normalize(s);
  return levels.find((l) => normalize(l.name) === n)?.level ?? undefined;
}

/** Códigos de control dentro de un texto: «COTI-1 – Política; COTI-3 – …». */
export function parseControlCodes(text: unknown, known?: string[]): string[] {
  const s = String(text ?? "");
  if (!s.trim()) return [];
  const out = new Set<string>();
  if (known?.length) {
    for (const k of known) {
      const re = new RegExp(`(^|[^A-Za-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![A-Za-z0-9])`, "i");
      if (re.test(s)) out.add(k);
    }
    if (out.size) return [...out];
  }
  for (const part of s.split(/[;\n,]+/)) {
    const code = part.trim().split(/\s+[–—-]\s+|\s{2,}/)[0].trim();
    if (/^[A-Za-z0-9._-]{1,40}$/.test(code)) out.add(code);
  }
  return [...out];
}
