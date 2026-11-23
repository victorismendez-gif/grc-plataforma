import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { getRiskCatalogs } from "@/lib/risk-data";
import { DIMENSIONS, guessDimension } from "@/lib/risk";
import Flash, { type FlashParams } from "@/components/flash";
import { saveCatalogRisk, saveCause } from "../actions";

export const metadata: Metadata = { title: "Catálogo de riesgos" };

export default async function CatalogPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("risks.read");
  const sp = await searchParams;
  const cats = await getRiskCatalogs();
  const canWrite = ctx.can("risks.write");
  return (
    <>
      <div className="head">
        <Link href="/riesgos" className="small">← Riesgos</Link>
        <h1>Catálogo de riesgos y causas</h1>
        <p className="lead">Riesgos (R1, R2…) y causas (CAU01…) que se combinan en el registro. Se crean solos al cargar el archivo de causas y riesgos.</p>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <h2>Riesgos · {cats.risks.length}</h2>
        <div className="stack" style={{ gap: 8 }}>
          {cats.risks.map((r) => (
            <form key={r.id} action={saveCatalogRisk} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
              <input type="hidden" name="id" value={r.id} />
              <label style={{ width: 90 }}>Código<input name="code" defaultValue={r.code} maxLength={30} disabled={!canWrite} /></label>
              <label style={{ flex: 1, minWidth: 260 }}>Riesgo<input name="name" defaultValue={r.name} maxLength={500} disabled={!canWrite} /></label>
              <label style={{ width: 170 }}>
                Dimensión
                <select name="dimension" defaultValue={r.dimension ?? guessDimension(r.name) ?? ""} disabled={!canWrite}>
                  <option value="">—</option>
                  {Object.entries(DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              {canWrite && <button type="submit" className="ghost">Guardar</button>}
            </form>
          ))}
          {canWrite && (
            <form action={saveCatalogRisk} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end" }}>
              <label style={{ width: 90 }}>Código<input name="code" maxLength={30} required placeholder="R4" /></label>
              <label style={{ flex: 1, minWidth: 260 }}>Nuevo riesgo<input name="name" maxLength={500} required /></label>
              <label style={{ width: 170 }}>Dimensión
                <select name="dimension" defaultValue="">
                  <option value="">—</option>
                  {Object.entries(DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </select>
              </label>
              <button type="submit" className="ghost">Agregar</button>
            </form>
          )}
        </div>
      </section>
      <section className="panel" style={{ marginTop: 16 }}>
        <h2>Causas · {cats.causes.length}</h2>
        {canWrite && (
          <form action={saveCause} className="row" style={{ gap: 6, flexWrap: "wrap", alignItems: "flex-end", marginBottom: 10 }}>
            <label style={{ width: 100 }}>Código<input name="code" maxLength={30} required placeholder="CAU137" /></label>
            <label style={{ flex: 1, minWidth: 260 }}>Nueva causa<input name="description" maxLength={1000} required /></label>
            <label style={{ width: 180 }}>Factor<input name="factor" maxLength={160} placeholder="Tecnología, Procesos…" /></label>
            <button type="submit" className="ghost">Agregar</button>
          </form>
        )}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Código</th><th>Causa</th><th>Factor</th>{canWrite && <th />}</tr></thead>
            <tbody>
              {cats.causes.map((c) => (
                <tr key={c.id}>
                  <td colSpan={canWrite ? 4 : 3} style={{ padding: 0 }}>
                    <form action={saveCause} className="row" style={{ gap: 6, alignItems: "center", padding: "4px 6px" }}>
                      <input type="hidden" name="id" value={c.id} />
                      <input name="code" defaultValue={c.code} maxLength={30} style={{ width: 90 }} disabled={!canWrite} aria-label="Código" />
                      <input name="description" defaultValue={c.description} maxLength={1000} style={{ flex: 1 }} disabled={!canWrite} aria-label="Causa" />
                      <input name="factor" defaultValue={c.factor?.name ?? ""} maxLength={160} style={{ width: 170 }} disabled={!canWrite} aria-label="Factor" />
                      {canWrite && <button type="submit" className="ghost">Guardar</button>}
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
