import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getCatalog } from "@/lib/lookups";
import Flash from "@/components/flash";
import AssetForm, { type AssetData } from "../../activos/asset-form";
import { retireMyEquipment, updateMyEquipment } from "../actions";

export const metadata: Metadata = { title: "Equipo" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };

export default async function EquipmentPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("assets.self");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: asset } = await supabase
    .from("assets")
    .select("*")
    .eq("id", id)
    .or(`owner_id.eq.${ctx.userId},custodian_email.ilike.${ctx.email.replace(/[,()]/g, "")}`)
    .maybeSingle();
  if (!asset) notFound();
  const [classes] = await Promise.all([getCatalog("info_classification")]);
  const retired = asset.status === "dado_de_baja";
  const owner = (asset.owner_text as string | null) ?? null;

  return (
    <>
      <div className="head">
        <Link href="/mis-equipos" className="small">← Mis equipos</Link>
        <h1><span className="mono">{asset.code}</span> · {asset.name}</h1>
        <p className="lead small">
          Custodio: {asset.custodian ?? "—"}
          {owner ? ` · Responsable: ${owner}` : ""}
          {asset.classification_id ? ` · Clasificación: ${classes.find((c) => c.id === asset.classification_id)?.label ?? ""}` : ""}
        </p>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <AssetForm asset={asset as AssetData} action={updateMyEquipment} selfService />
      </section>
      {!retired && (
        <section className="panel">
          <h2>Dar de baja</h2>
          <p className="small muted">Úsalo cuando entregues, devuelvas o pierdas el equipo. Queda registrado en el historial.</p>
          <form action={retireMyEquipment}>
            <input type="hidden" name="id" value={asset.id as string} />
            <button type="submit" className="ghost">Dar de baja este equipo</button>
          </form>
        </section>
      )}
    </>
  );
}
