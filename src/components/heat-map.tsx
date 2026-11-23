import Link from "next/link";
import { heatMap, inkFor, type Methodology } from "@/lib/risk";

/** Mapa de calor probabilidad × impacto con el número de riesgos en cada celda. */
export default function HeatMap({ m, points, hrefFor }: {
  m: Methodology;
  points: { p: number | null; i: number | null }[];
  hrefFor?: (p: number, i: number) => string;
}) {
  const rows = heatMap(m, points);
  return (
    <table className="heat">
      <tbody>
        {rows.map((r) => (
          <tr key={r.p}>
            <th className="small" title={m.probability_levels[r.p - 1]?.description}>{r.p} · {m.probability_levels[r.p - 1]?.name}</th>
            {r.cells.map((c) => (
              <td key={c.i} style={{ background: c.zone.color, color: inkFor(c.zone.color) }} title={`${c.zone.name} · nivel ${c.score}`}>
                {c.count > 0 ? (hrefFor ? <Link href={hrefFor(c.p, c.i)} style={{ color: "inherit" }}>{c.count}</Link> : c.count) : ""}
              </td>
            ))}
          </tr>
        ))}
        <tr>
          <th />
          {m.impact_levels.map((l) => (
            <th key={l.level} className="small" title={l.description}>{l.level} · {l.name}</th>
          ))}
        </tr>
      </tbody>
    </table>
  );
}
