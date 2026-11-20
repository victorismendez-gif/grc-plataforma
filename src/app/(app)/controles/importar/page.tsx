import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { CONTROL_FIELDS } from "@/lib/control-fields";
import ImportWizard from "@/components/import-wizard";

export const metadata: Metadata = { title: "Importar controles" };

const LABELS: Record<string, string> = {
  ...Object.fromEntries(CONTROL_FIELDS.map((d) => [d.field, d.header])),
  owner_id: "Responsable (usuario)",
  owner_text: "Responsable (texto)",
};

export default async function ImportControlsPage() {
  await requirePermission("controls.write");
  return (
    <>
      <div className="head">
        <Link href="/controles" className="small">← Controles</Link>
        <h1>Cargar controles desde Excel</h1>
        <p className="lead">
          Selecciona el archivo: se valida de inmediato. Si tiene errores no se carga nada y te indicamos qué corregir. Si
          está bien, verás qué controles son nuevos y cuáles cambian, y se cargan solo cuando confirmes.
        </p>
      </div>
      <ImportWizard kind="controles" labels={LABELS} />
    </>
  );
}
