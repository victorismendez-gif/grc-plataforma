import { inkFor } from "@/lib/risk";

/** Zona de riesgo con su color: «Medio · 8». */
export default function ZoneTag({ name, color, score }: { name: string | null; color: string | null; score: number | null }) {
  if (!name || !color) return <span className="small muted">Sin valorar</span>;
  return <span className="zone" style={{ background: color, color: inkFor(color) }}>{name} · {Number(score)}</span>;
}
