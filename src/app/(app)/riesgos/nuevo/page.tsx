import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getMethodology, getRiskCatalogs } from "@/lib/risk-data";
import Flash, { type FlashParams } from "@/components/flash";
import EntryForm from "../entry-form";
import { createEntry } from "../actions";

export const metadata: Metadata = { title: "Registrar riesgo" };

export default async function NewRiskPage({ searchParams }: { searchParams: FlashParams }) {
  await requirePermission("risks.write");
  const sp = await searchParams;
  const [m, cats] = await Promise.all([getMethodology(), getRiskCatalogs()]);
  return (
    <>
      <div className="head">
        <Link href="/riesgos" className="small">← Riesgos</Link>
        <h1>Registrar riesgo</h1>
      </div>
      <Flash {...sp} />
      {!cats.risks.length ? (
        <section className="panel">
          <p>Primero crea los riesgos del catálogo (por ejemplo R1, R2, R3) en <Link href="/riesgos/catalogo">Catálogo de riesgos y causas</Link>, o carga tu archivo de causas y riesgos desde Riesgos.</p>
        </section>
      ) : (
        <section className="panel"><EntryForm action={createEntry} withEvaluation m={m} /></section>
      )}
    </>
  );
}
