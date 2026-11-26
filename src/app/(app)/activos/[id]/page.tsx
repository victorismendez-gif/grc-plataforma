import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_CRITICALITY, IMPLEMENTATION, label, level5Tone } from "@/lib/labels";
import Zone from "@/components/zone-tag";
import Flash from "@/components/flash";
import AssetForm, { type AssetData } from "../asset-form";
import { updateAsset } from "../actions";

export const metadata: Metadata = { title: "Activo" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };

export default async function AssetPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("assets.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("*, control_assets(control:controls(id, code, name, implementation_status))")
    .eq("id", id)
    .maybeSingle();
  if (!asset) notFound();
  const { data: history } = await supabase
    .from("audit_log")
    .select("id, occurred_at, actor_email, action, changed_fields")
    .eq("table_name", "assets")
    .eq("record_id", id)
    .order("id", { ascending: false })
    .limit(20);

  type RiskRow = {
    id: string; code: string; active: boolean; inherent_score: number | null; inherent_zone: string | null; inherent_color: string | null;
    residual_score: number | null; residual_zone: string | null; residual_color: string | null;
    risk: { code: string; name: string } | null; cause: { code: string; description: string } | null;
  };
  let risks: RiskRow[] = [];
  if (ctx.can("risks.read") && asset.asset_type_id) {
    const { data: rl } = await supabase
      .from("risk_entry_asset_types")
      .select("entry:risk_entries(id, code, active, inherent_score, inherent_zone, inherent_color, residual_score, residual_zone, residual_color, risk:risks(code, name), cause:risk_causes(code, description))")
      .eq("asset_type_id", asset.asset_type_id)
      .limit(2000);
    risks = ((rl ?? []) as unknown as { entry: RiskRow | null }[])
      .map((r) => r.entry)
      .filter((e): e is RiskRow => Boolean(e?.active))
      .sort((a, b) => (Number(b.residual_score ?? -1) - Number(a.residual_score ?? -1)) || (Number(b.inherent_score ?? -1) - Number(a.inherent_score ?? -1)) || a.code.localeCompare(b.code));
  }

  const attrs = Object.entries((asset.attributes as Record<string, string>) ?? {});
  const controls = ((asset.control_assets as { control: { id: string; code: string; name: string; implementation_status: string } | null }[]) ?? [])
    .map((c) => c.control)
    .filter(Boolean) as { id: string; code: string; name: string; implementation_status: string }[];

  return (
    <>
      <div className="head">
        <Link href="/activos" className="small">← Activos</Link>
        <h1>
          <span className="mono">{asset.code}</span> · {asset.name}{" "}
          {asset.criticality && <span className={`tag ${level5Tone(asset.criticality)}`}>Criticidad {asset.criticality} · {label(ASSET_CRITICALITY, asset.criticality).toLowerCase()}</span>}
        </h1>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <AssetForm
          asset={asset as AssetData}
          action={updateAsset}
          readOnly={!ctx.can("assets.write")}
        />
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Controles que lo protegen</h2>
          {controls.length ? (
            <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
              {controls.map((c) => (
                <li key={c.id}>
                  <Link href={`/controles/${c.id}`}>{c.code}</Link> {c.name} · <span className="muted">{label(IMPLEMENTATION, c.implementation_status)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted">Ningún control asociado todavía. Se asocian desde la ficha del control.</p>
          )}
        </section>
        <section className="panel">
          <h2>Datos adicionales del archivo</h2>
          {attrs.length ? (
            <table>
              <tbody>
                {attrs.map(([k, v]) => (
                  <tr key={k}><th>{k}</th><td className="small">{v}</td></tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="small muted">Las columnas del Excel que no corresponden a un campo estándar se guardan aquí.</p>
          )}
        </section>
      </div>

      {ctx.can("risks.read") && (
        <section className="panel">
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h2>Escenarios de riesgo de este tipo de activo</h2>
            {risks.length > 0 && <Link className="small" href={`/riesgos?activo=${asset.asset_type_id}#registro`}>Ver en Riesgos →</Link>}
          </div>
          {risks.length ? (
            <div className="tablewrap">
              <table>
                <thead><tr><th>ID</th><th>Riesgo</th><th>Causa</th><th>Inherente</th><th>Residual</th></tr></thead>
                <tbody>
                  {risks.slice(0, 50).map((r) => (
                    <tr key={r.id}>
                      <td className="mono"><Link href={`/riesgos/${r.id}`}>{r.code}</Link></td>
                      <td className="small"><b>{r.risk?.code}</b> {r.risk && r.risk.name.length > 70 ? `${r.risk.name.slice(0, 70)}…` : r.risk?.name}</td>
                      <td className="small">{r.cause ? <><b>{r.cause.code}</b> {r.cause.description}</> : "—"}</td>
                      <td><Zone name={r.inherent_zone} color={r.inherent_color} score={r.inherent_score} /></td>
                      <td><Zone name={r.residual_zone} color={r.residual_color} score={r.residual_score} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="small muted">
                {risks.length} escenario{risks.length === 1 ? "" : "s"} aplica{risks.length === 1 ? "" : "n"} a este tipo de activo
                {risks.length > 50 ? "; se muestran los 50 de mayor riesgo residual" : ""}.
              </p>
            </div>
          ) : (
            <p className="small muted">
              {asset.asset_type_id
                ? "Ningún escenario de riesgo está vinculado a este tipo de activo. Se vinculan en la ficha del riesgo o con la columna «Tipo de activo» de la plantilla de riesgos."
                : "El activo no tiene tipo; asígnale uno para ver sus escenarios de riesgo."}
            </p>
          )}
        </section>
      )}

      {history && history.length > 0 && (
        <section className="panel">
          <h2>Historial de cambios</h2>
          <table>
            <tbody>
              {history.map((h) => (
                <tr key={h.id as number}>
                  <td className="mono">{new Date(h.occurred_at as string).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</td>
                  <td className="small">{(h.actor_email as string) ?? "sistema"}</td>
                  <td><span className="tag warn">{h.action as string}</span></td>
                  <td className="small muted">{((h.changed_fields as string[]) ?? []).filter((f) => f !== "updated_at").join(", ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {!ctx.can("audit_log.read") && <p className="small muted">El historial completo requiere el permiso de trazabilidad.</p>}
        </section>
      )}
    </>
  );
}
