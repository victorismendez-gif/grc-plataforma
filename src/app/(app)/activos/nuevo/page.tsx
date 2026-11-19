import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import Flash, { type FlashParams } from "@/components/flash";
import AssetForm from "../asset-form";
import { createAsset } from "../actions";

export const metadata: Metadata = { title: "Nuevo activo" };

export default async function NewAssetPage({ searchParams }: { searchParams: FlashParams }) {
  await requirePermission("assets.write");
  const sp = await searchParams;
  return (
    <>
      <div className="head">
        <Link href="/activos" className="small">← Activos</Link>
        <h1>Nuevo activo</h1>
        <p className="lead">La criticidad se calcula como el mayor valor entre confidencialidad, integridad y disponibilidad.</p>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <AssetForm action={createAsset} />
      </section>
    </>
  );
}
