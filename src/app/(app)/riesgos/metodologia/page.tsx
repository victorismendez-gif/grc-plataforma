import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getMethodology, getRiskCatalogs } from "@/lib/risk-data";
import { RATINGS } from "@/lib/labels";
import Flash, { type FlashParams } from "@/components/flash";
import HeatMap from "@/components/heat-map";
import { saveCategory, saveMethodology } from "../actions";

export const metadata: Metadata = { title: "Metodología de riesgo" };

export default async function MethodologyPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("risks.read");
  const sp = await searchParams;
  const [m, cats] = await Promise.all([getMethodology(), getRiskCatalogs()]);
  const supabase = await createClient();
  const { data: versions } = await supabase.from("risk_methodologies").select("version, status, created_at").order("version", { ascending: false });
  const canEdit = ctx.can("risks.configure");
  const zones = [...m.zones].sort((a, b) => a.min - b.min);

  const scale = (prefix: "p" | "i", title: string, levels: typeof m.probability_levels) => (
    <fieldset className="form-section">
      <legend>{title}</legend>
      <label style={{ maxWidth: 220 }}>
        Número de niveles
        <select name={`${prefix}_count`} defaultValue={levels.length}>
          {[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="stack" style={{ gap: 6, marginTop: 8 }}>
        {Array.from({ length: 6 }, (_, k) => (
          <div key={k} className="row" style={{ gap: 8, alignItems: "flex-start" }}>
            <span className="mono" style={{ minWidth: 20, paddingTop: 8 }}>{k + 1}</span>
            <input name={`${prefix}_name_${k + 1}`} defaultValue={levels[k]?.name ?? ""} maxLength={60} placeholder="Nombre" style={{ width: 170 }} />
            <input name={`${prefix}_desc_${k + 1}`} defaultValue={levels[k]?.description ?? ""} maxLength={500} placeholder="Descripción o criterio" style={{ flex: 1 }} />
          </div>
        ))}
      </div>
      <p className="small muted">Los niveles por encima del número elegido se ignoran.</p>
    </fieldset>
  );

  return (
    <>
      <div className="head">
        <Link href="/riesgos" className="small">← Riesgos</Link>
        <h1>Metodología de riesgo · versión {m.version}</h1>
        <p className="lead">
          Escalas de probabilidad e impacto (3 a 6 niveles), fórmula, zonas, apetito y tolerancia. Si cambias una
          metodología que ya se usó, se crea una versión nueva: las valoraciones hechas conservan la suya hasta que se
          vuelvan a valorar.
        </p>
      </div>
      <Flash {...sp} />

      <div className="grid2">
        <section className="panel">
          <h2>Matriz vigente</h2>
          <HeatMap m={m} points={[]} />
          <p className="small muted" style={{ marginTop: 6 }}>
            Nivel = {m.formula === "suma" ? "probabilidad + impacto" : "probabilidad × impacto"} · Apetito ≤ {m.appetite} · Tolerancia ≤ {m.tolerance}
          </p>
        </section>
        <section className="panel">
          <h2>Tipos de riesgo: apetito y tolerancia</h2>
          <p className="small muted">Vacío = usa los valores generales de la metodología.</p>
          <div className="stack" style={{ gap: 6 }}>
            {cats.categories.map((c) => (
              <form key={c.id} action={saveCategory} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
                <input type="hidden" name="id" value={c.id} />
                <label style={{ flex: 1, minWidth: 180 }}>Nombre<input name="name" defaultValue={c.name} maxLength={160} disabled={!ctx.can("risks.write")} /></label>
                <label style={{ width: 90 }}>Apetito<input name="appetite" type="number" step="0.5" defaultValue={c.appetite ?? ""} disabled={!canEdit} /></label>
                <label style={{ width: 90 }}>Tolerancia<input name="tolerance" type="number" step="0.5" defaultValue={c.tolerance ?? ""} disabled={!canEdit} /></label>
                {ctx.can("risks.write") && <button type="submit" className="ghost">Guardar</button>}
              </form>
            ))}
            {ctx.can("risks.write") && (
              <form action={saveCategory} className="row" style={{ gap: 6, alignItems: "flex-end" }}>
                <label style={{ flex: 1 }}>Nuevo tipo de riesgo<input name="name" maxLength={160} required /></label>
                <button type="submit" className="ghost">Agregar</button>
              </form>
            )}
          </div>
        </section>
      </div>

      <form action={saveMethodology} className="stack" style={{ marginTop: 16 }}>
        <fieldset disabled={!canEdit} style={{ border: 0, padding: 0, margin: 0 }} className="stack">
          <div className="grid2">
            {scale("p", "Probabilidad", m.probability_levels)}
            {scale("i", "Impacto", m.impact_levels)}
          </div>
          <div className="grid2">
            <fieldset className="form-section">
              <legend>Nivel de riesgo y zonas</legend>
              <div className="form-grid">
                <label>
                  Fórmula
                  <select name="formula" defaultValue={m.formula}>
                    <option value="producto">Probabilidad × impacto</option>
                    <option value="suma">Probabilidad + impacto</option>
                  </select>
                </label>
                <label>Apetito (hasta)<input name="appetite" type="number" step="0.5" defaultValue={m.appetite} required /></label>
                <label>Tolerancia (hasta)<input name="tolerance" type="number" step="0.5" defaultValue={m.tolerance} required /></label>
              </div>
              <div className="stack" style={{ gap: 6, marginTop: 10 }}>
                {Array.from({ length: 6 }, (_, k) => (
                  <div key={k} className="row" style={{ gap: 8, alignItems: "center" }}>
                    <input name={`z_name_${k + 1}`} defaultValue={zones[k]?.name ?? ""} maxLength={40} placeholder="Zona" style={{ width: 140 }} />
                    <label className="row small" style={{ gap: 4, alignItems: "center" }}>desde
                      <input name={`z_min_${k + 1}`} type="number" step="0.5" defaultValue={zones[k]?.min ?? ""} style={{ width: 80 }} />
                    </label>
                    <input name={`z_color_${k + 1}`} type="color" defaultValue={zones[k]?.color ?? "#888888"} aria-label="Color" />
                  </div>
                ))}
              </div>
              <p className="small muted">Cada zona empieza en su valor «desde». Deja vacías las filas que no uses (mínimo 2 zonas).</p>
            </fieldset>
            <fieldset className="form-section">
              <legend>Reducción por efectividad del control</legend>
              <div className="form-grid">
                {(["1", "2", "3"] as const).map((r) => (
                  <label key={r}>
                    {RATINGS[Number(r) as 1 | 2 | 3]} (%)
                    <input name={`red_${r}`} type="number" min={0} max={95} step={1} defaultValue={Math.round((m.control_reduction[r] ?? 0) * 100)} />
                  </label>
                ))}
              </div>
              <p className="small muted">
                Los controles preventivos y detectivos reducen la probabilidad; los correctivos, el impacto. Se aplican
                del más fuerte al más débil, cada uno sobre lo que queda.
              </p>
            </fieldset>
          </div>
        </fieldset>
        {canEdit ? <div><button type="submit">Guardar metodología</button></div> : <p className="small muted">Solo quien tiene el permiso «Parametrizar la metodología de riesgo» puede cambiarla.</p>}
      </form>

      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Versiones</h2>
        <p className="small">{(versions ?? []).map((v) => `v${v.version} (${v.status === "vigente" ? "vigente" : "histórica"}, ${String(v.created_at).slice(0, 10)})`).join(" · ")}</p>
      </section>
    </>
  );
}
