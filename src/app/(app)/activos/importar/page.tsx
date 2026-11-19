import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import AssetImporter from "./importer";

export const metadata: Metadata = { title: "Importar activos" };

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
        <h1>Importar inventario de activos</h1>
        <p className="lead">
          Carga el consolidado del mes. La plataforma compara cada activo por su código, te muestra qué es nuevo, qué cambió
          y qué ya no aparece, y solo aplica los cambios cuando lo confirmas. Cada cambio queda en la trazabilidad.
        </p>
      </div>
      <AssetImporter />
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
