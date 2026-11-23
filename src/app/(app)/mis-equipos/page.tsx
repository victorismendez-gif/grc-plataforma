import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { ASSET_STATUS, label } from "@/lib/labels";
import { getCatalog } from "@/lib/lookups";
import Flash, { type FlashParams } from "@/components/flash";

export const metadata: Metadata = { title: "Mis equipos" };

type Row = { id: string; code: string; name: string | null; asset_type_id: string; brand: string | null; model: string | null;
  serial_number: string | null; status: string };

export default async function MyEquipmentPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("assets.self");
  const sp = await searchParams;
  const supabase = await createClient();
  // RLS + filtro: equipos donde soy responsable o custodio
  const [{ data }, types] = await Promise.all([
    supabase
      .from("assets")
      .select("id, code, name, asset_type_id, brand, model, serial_number, status")
      .or(`owner_id.eq.${ctx.userId},custodian_email.ilike.${ctx.email.replace(/[,()]/g, "")}`)
      .order("status")
      .order("code"),
    getCatalog("asset_type"),
  ]);
  const typeName = new Map(types.map((t) => [t.id, t.label]));
  const rows = ((data ?? []) as Row[]).filter((r) => typeName.has(r.asset_type_id));
  const activos = rows.filter((r) => r.status !== "dado_de_baja");

  return (
    <>
      <div className="head">
        <h1>Mis equipos</h1>
        <p className="lead">
          Computadores, tabletas y celulares asignados a ti. Mantén sus datos al día: registra un equipo nuevo,
          corrige sus datos o dalo de baja cuando lo entregues.
        </p>
      </div>
      <Flash {...sp} />
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
        <span className="small muted">{activos.length} equipo(s) en uso · {rows.length - activos.length} dado(s) de baja</span>
        <Link className="btn" href="/mis-equipos/nuevo">Registrar equipo</Link>
      </div>
      <div className="tablewrap">
        <table>
          <thead><tr><th>Identificador</th><th>Tipo</th><th>Nombre</th><th>Marca y modelo</th><th>Serial</th><th>Estado</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="mono"><Link href={`/mis-equipos/${r.id}`}>{r.code}</Link></td>
                <td className="small">{typeName.get(r.asset_type_id)}</td>
                <td>{r.name ?? "—"}</td>
                <td className="small">{[r.brand, r.model].filter(Boolean).join(" ") || "—"}</td>
                <td className="small mono">{r.serial_number ?? "—"}</td>
                <td className="small">{r.status === "dado_de_baja" ? <span className="tag crit">Dado de baja</span> : label(ASSET_STATUS, r.status)}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr><td colSpan={6} className="muted small">No tienes equipos asignados. Si usas uno, regístralo con «Registrar equipo».</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
