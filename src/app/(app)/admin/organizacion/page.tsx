import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import Flash, { type FlashParams } from "@/components/flash";
import { createClient } from "@/lib/supabase/server";
import { saveCatalogItem, updateOrganization } from "./actions";

export const metadata: Metadata = { title: "Organización" };

export default async function OrganizationPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("org.manage");
  const sp = await searchParams;
  const org = ctx.organization;
  const supabase = await createClient();
  const { data: items } = await supabase.from("catalog_items").select("id, catalog, code, label, active").order("sort_order");
  const catalogs = [
    { key: "info_classification", title: "Niveles de clasificación de la información" },
    { key: "asset_type", title: "Tipos de activo" },
  ];
  return (
    <>
      <div className="head">
        <h1>Organización</h1>
        <p className="lead">Datos de la empresa y marca que se muestran en la plataforma y en los reportes.</p>
      </div>
      <Flash {...sp} />
      <section className="panel" style={{ maxWidth: 640 }}>
        <form action={updateOrganization} className="stack">
          <label>
            Razón social
            <input name="name" defaultValue={org.name} required minLength={2} />
          </label>
          <div className="row">
            <label style={{ flex: 1 }}>
              Sector
              <input name="industry" defaultValue={org.industry ?? ""} />
            </label>
            <label>
              País (código ISO)
              <input name="country" defaultValue={org.country} maxLength={2} size={4} required />
            </label>
          </div>
          <label>
            Dominio de correo corporativo
            <input name="email_domain" defaultValue={org.email_domain ?? ""} placeholder="empresa.com" />
          </label>
          <div className="row">
            <label>
              Color de marca
              <input name="brand_color" type="color" defaultValue={org.brand_color} />
            </label>
            <label style={{ flex: 1 }}>
              URL del logo (https)
              <input name="logo_url" type="url" defaultValue={org.logo_url ?? ""} placeholder="https://…" />
            </label>
          </div>
          <p className="small muted">Identificador: <span className="mono">{org.slug}</span></p>
          <button type="submit">Guardar</button>
        </form>
      </section>
      <div className="grid2">
        {catalogs.map((c) => (
          <section key={c.key} className="panel">
            <h2>{c.title}</h2>
            <table>
              <tbody>
                {(items ?? []).filter((i) => i.catalog === c.key).map((i) => (
                  <tr key={i.id as string}>
                    <td>
                      <form action={saveCatalogItem} className="inline">
                        <input type="hidden" name="catalog" value={c.key} />
                        <input type="hidden" name="id" value={i.id as string} />
                        <input name="label" defaultValue={i.label as string} maxLength={80} aria-label="Nombre" />
                        <label className="check small"><input type="checkbox" name="active" defaultChecked={i.active as boolean} /> Activo</label>
                        <button type="submit" className="ghost">Guardar</button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <form action={saveCatalogItem} className="inline">
              <input type="hidden" name="catalog" value={c.key} />
              <input name="label" placeholder="Nuevo valor" maxLength={80} required aria-label="Nuevo valor" />
              <button type="submit">Agregar</button>
            </form>
          </section>
        ))}
      </div>
    </>
  );
}
