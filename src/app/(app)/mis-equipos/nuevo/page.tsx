import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import Flash, { type FlashParams } from "@/components/flash";
import AssetForm from "../../activos/asset-form";
import { createMyEquipment } from "../actions";

export const metadata: Metadata = { title: "Registrar equipo" };

export default async function NewEquipmentPage({ searchParams }: { searchParams: FlashParams }) {
  await requirePermission("assets.self");
  const sp = await searchParams;
  return (
    <>
      <div className="head">
        <Link href="/mis-equipos" className="small">← Mis equipos</Link>
        <h1>Registrar equipo</h1>
        <p className="lead">El equipo queda asignado a ti como custodio.</p>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <AssetForm action={createMyEquipment} selfService />
      </section>
    </>
  );
}
