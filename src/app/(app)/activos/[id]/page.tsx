import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_CRITICALITY, IMPLEMENTATION, label, level5Tone } from "@/lib/labels";
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
    .select("*, asset_processes(process_id), control_assets(control:controls(id, code, name, implementation_status))")
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
          processIds={((asset.asset_processes as { process_id: string }[]) ?? []).map((p) => p.process_id)}
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
