import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import Flash, { type FlashParams } from "@/components/flash";
import { createClient } from "@/lib/supabase/server";
import { saveAssetTypeProfile, saveCatalogItem, saveScale, updateOrganization } from "./actions";
import { DIMENSIONS, FIELD_LABELS, IDENTIFIER_KINDS, OPTIONAL_FIELDS, readSettings } from "@/lib/asset-profiles";

export const metadata: Metadata = { title: "Organización" };

export default async function OrganizationPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("org.manage");
  const sp = await searchParams;
  const org = ctx.organization;
  const supabase = await createClient();
  const [{ data: items }, { data: scale }] = await Promise.all([
    supabase.from("catalog_items").select("id, catalog, code, label, active, settings").order("sort_order"),
    supabase.from("valuation_levels").select("dimension, level, label, description").order("level"),
  ]);
  const catalogs = [{ key: "info_classification", title: "Niveles de clasificación de la información" }];
  const assetTypes = (items ?? []).filter((i) => i.catalog === "asset_type");
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
            <p className="small muted">Se usan en activos, documentos y en la plantilla de carga.</p>
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

      <section className="panel">
        <h2>Escala de valoración de activos (1 a 5)</h2>
        <p className="small muted">
          Copia aquí las definiciones de la metodología de la organización. Se muestran al valorar cada activo y se
          incluyen en la plantilla de carga. La criticidad del activo es el mayor de los tres valores.
        </p>
        <div className="grid2">
          {(Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).map((d) => (
            <form key={d} action={saveScale} className="stack" style={{ border: "1px solid var(--line)", borderRadius: 6, padding: 12 }}>
              <input type="hidden" name="dimension" value={d} />
              <b>{DIMENSIONS[d]}</b>
              {(scale ?? []).filter((l) => l.dimension === d).map((l) => (
                <div key={l.level as number} className="row" style={{ alignItems: "start" }}>
                  <span className="mono" style={{ paddingTop: 26 }}>{l.level as number}</span>
                  <label>
                    Nombre
                    <input name={`label_${l.level}`} defaultValue={l.label as string} maxLength={60} size={12} required />
                  </label>
                  <label style={{ flex: 1, minWidth: 200 }}>
                    Definición
                    <textarea name={`description_${l.level}`} defaultValue={(l.description as string) ?? ""} rows={2} maxLength={1000} />
                  </label>
                </div>
              ))}
              <div><button type="submit">Guardar {DIMENSIONS[d].toLowerCase()}</button></div>
            </form>
          ))}
        </div>
      </section>

      <section className="panel">
        <h2>Tipos de activo</h2>
        <p className="small muted">
          Para cada tipo define el identificador único (el primer campo del formulario y de la plantilla) y los campos que
          aplican. La clasificación y la valoración de confidencialidad, integridad y disponibilidad aplican siempre.
        </p>
        {assetTypes.map((t) => {
          const st = readSettings(t.settings);
          return (
            <details key={t.id as string} style={{ borderTop: "1px solid var(--line)", padding: "8px 0" }}>
              <summary>
                {t.label as string} <span className="small muted">· {st.identifier.label}{st.identifier.required ? " (obligatorio)" : " (opcional, número automático)"}</span>
                {!t.active && <span className="tag crit"> Inactivo</span>}
              </summary>
              <form action={saveAssetTypeProfile} className="stack" style={{ marginTop: 10 }}>
                <input type="hidden" name="id" value={t.id as string} />
                <div className="row">
                  <label>Nombre del tipo<input name="label" defaultValue={t.label as string} maxLength={80} required /></label>
                  <label>
                    Identificador único
                    <select name="kind" defaultValue={st.identifier.kind}>
                      {Object.entries(IDENTIFIER_KINDS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </label>
                  <label>Texto del identificador<input name="id_label" defaultValue={st.identifier.label} maxLength={40} /></label>
                  <label className="check"><input type="checkbox" name="required" defaultChecked={st.identifier.required} /> Obligatorio</label>
                  <label>Texto del nombre (opcional)<input name="name_label" defaultValue={st.name_label ?? ""} maxLength={40} placeholder="Nombre del activo" /></label>
                  <label className="check"><input type="checkbox" name="active" defaultChecked={t.active as boolean} /> Activo</label>
                </div>
                <fieldset style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
                  <legend className="small">Campos que se muestran (en este orden)</legend>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 18px" }}>
                    {OPTIONAL_FIELDS.map((f) => (
                      <label key={f} className="check">
                        <input type="checkbox" name="fields" value={f} defaultChecked={st.fields.includes(f)} />
                        {FIELD_LABELS[f]}
                      </label>
                    ))}
                  </div>
                </fieldset>
                <div><button type="submit">Guardar tipo</button></div>
              </form>
            </details>
          );
        })}
        <form action={saveCatalogItem} className="inline" style={{ marginTop: 10 }}>
          <input type="hidden" name="catalog" value="asset_type" />
          <input name="label" placeholder="Nuevo tipo de activo" maxLength={80} required aria-label="Nuevo tipo de activo" />
          <button type="submit">Agregar tipo</button>
        </form>
      </section>
    </>
  );
}
