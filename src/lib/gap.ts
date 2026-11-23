// Cálculos del diagnóstico GAP y del plan de trabajo (código puro).

export type GapStatus = "cumple" | "parcial" | "no_cumple" | "no_aplica";

export type Compliance = {
  total: number;
  pendientes: number;
  cumple: number;
  parcial: number;
  noCumple: number;
  noAplica: number;
  /** requisitos aplicables ya calificados */
  aplicables: number;
  /** (cumple + peso × parcial) ÷ aplicables × 100; null si no hay aplicables */
  pct: number | null;
};

export function compliance(statuses: (string | null | undefined)[], partialWeight = 0.5): Compliance {
  const c = { total: statuses.length, pendientes: 0, cumple: 0, parcial: 0, noCumple: 0, noAplica: 0 };
  for (const s of statuses) {
    if (s === "cumple") c.cumple++;
    else if (s === "parcial") c.parcial++;
    else if (s === "no_cumple") c.noCumple++;
    else if (s === "no_aplica") c.noAplica++;
    else c.pendientes++;
  }
  const aplicables = c.cumple + c.parcial + c.noCumple;
  const pct = aplicables ? Math.round(((c.cumple + partialWeight * c.parcial) / aplicables) * 1000) / 10 : null;
  return { ...c, aplicables, pct };
}

/** Agrupa conservando el orden de aparición. */
export function groupBy<T>(items: T[], key: (t: T) => string): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k);
    if (list) list.push(it);
    else m.set(k, [it]);
  }
  return [...m.entries()];
}

export function pctTone(pct: number | null): string {
  if (pct === null) return "";
  if (pct >= 80) return "good";
  if (pct >= 50) return "warn";
  return "crit";
}

export type PlanAction = { status: string; due_on: string | null; progress?: number | null };

/** KPIs del plan: avance a la fecha y acciones vencidas. */
export function planKpis(actions: PlanAction[], today: string) {
  const live = actions.filter((a) => a.status !== "cancelada");
  const done = live.filter((a) => a.status === "terminada").length;
  const dueToDate = live.filter((a) => a.due_on && a.due_on <= today);
  const doneDue = dueToDate.filter((a) => a.status === "terminada").length;
  const open = live.filter((a) => a.status === "pendiente" || a.status === "en_curso");
  const overdue = open.filter((a) => a.due_on && a.due_on < today).length;
  const progress = live.length ? Math.round(live.reduce((s, a) => s + (a.status === "terminada" ? 100 : a.progress ?? 0), 0) / live.length) : 0;
  return {
    total: live.length,
    terminadas: done,
    abiertas: open.length,
    vencidas: overdue,
    /** Actividades terminadas ÷ actividades planeadas a la fecha × 100 */
    avanceFecha: dueToDate.length ? Math.round((doneDue / dueToDate.length) * 100) : null,
    /** Acciones abiertas con fecha vencida ÷ acciones abiertas × 100 */
    pctVencidas: open.length ? Math.round((overdue / open.length) * 100) : 0,
    /** Promedio de avance de las actividades */
    avance: progress,
  };
}

/** Texto del Excel → estado del GAP. */
export function parseGapStatus(raw: unknown): GapStatus | "" | undefined {
  const s = String(raw ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  if (!s) return "";
  if (["cumple", "si", "c", "cumple totalmente"].includes(s)) return "cumple";
  if (["cumple parcial", "parcial", "cumple parcialmente", "cp", "p"].includes(s)) return "parcial";
  if (["no cumple", "no_cumple", "nc", "no"].includes(s)) return "no_cumple";
  if (["no aplica", "no_aplica", "na", "n/a"].includes(s)) return "no_aplica";
  return undefined;
}
