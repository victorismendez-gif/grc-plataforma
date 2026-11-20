import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import Flash, { type FlashParams } from "@/components/flash";
import ControlForm from "../control-form";
import { createControl } from "../actions";

export const metadata: Metadata = { title: "Nuevo control" };

export default async function NewControlPage({ searchParams }: { searchParams: FlashParams }) {
  await requirePermission("controls.write");
  const sp = await searchParams;
  return (
    <>
      <div className="head">
        <Link href="/controles" className="small">← Controles</Link>
        <h1>Nuevo control</h1>
      </div>
      <Flash {...sp} />
      <div className="callout">
        <span className="small"><b>¿Vas a registrar varios controles?</b> Descarga la plantilla, llénala en Excel y cárgala de una vez.</span>
        <span className="row">
          <a className="btn ghost" href="/controles/plantilla">Descargar plantilla</a>
          <a className="btn" href="/controles/importar">Cargar desde Excel</a>
        </span>
      </div>
      <section className="panel">
        <ControlForm action={createControl} />
      </section>
    </>
  );
}
