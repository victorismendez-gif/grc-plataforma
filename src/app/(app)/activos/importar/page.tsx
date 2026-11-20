import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FIELD_LABELS } from "@/lib/asset-profiles";
import ImportWizard from "@/components/import-wizard";

export const metadata: Metadata = { title: "Importar activos" };

const LABELS: Record<string, string> = {
  ...FIELD_LABELS,
  code: "Identificador único",
  id_placa: "Placa (identificador de computadores)",
  id_imei: "IMEI (identificador de celulares y tabletas)",
  id_documento: "Documento de identidad (identificador de empleados)",
  attributes: "Dato adicional",
  owner_id: "Responsable (usuario)",
  owner_text: "Responsable (texto)",
  process_id: "Proceso",
};

export default async function ImportAssetsPage() {
  await requirePermission("assets.write");
  const supabase = await createClient();
  const { data: imports } = await supabase
    .from("asset_imports")
    .select("id, file_name, created_at, total_rows, created_count, updated_count, unchanged_count, missing_count, by:profiles!asset_imports_organization_id_imported_by_fkey(full_name)")
    .order("created_at", { ascending: false })
    .limit(12);

  return (
    <>
      <div className="head">
        <Link href="/activos" className="small">← Activos</Link>
        <h1>Cargar activos desde Excel</h1>
        <p className="lead">
          Selecciona el archivo: se valida de inmediato. Si tiene errores no se carga nada y te indicamos qué corregir. Si
          está bien, verás qué activos son nuevos, cuáles cambian y cuáles no vienen, y se cargan solo cuando confirmes.
        </p>
      </div>
      <ImportWizard kind="activos" labels={LABELS} />
      <section className="panel">
        <h2>Cargas anteriores</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Fecha</th><th>Archivo</th><th>Por</th><th>Filas</th><th>Nuevos</th><th>Cambios</th><th>Sin cambios</th><th>No incluidos</th></tr></thead>
            <tbody>
              {(imports ?? []).map((i) => (
                <tr key={i.id as string}>
                  <td className="mono">{new Date(i.created_at as string).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</td>
                  <td className="small">{i.file_name as string}</td>
                  <td className="small">{(i.by as unknown as { full_name: string } | null)?.full_name ?? "—"}</td>
                  <td>{i.total_rows as number}</td>
                  <td>{i.created_count as number}</td>
                  <td>{i.updated_count as number}</td>
                  <td>{i.unchanged_count as number}</td>
                  <td>{i.missing_count as number}</td>
                </tr>
              ))}
              {(imports ?? []).length === 0 && <tr><td colSpan={8} className="muted">Aún no hay cargas.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
