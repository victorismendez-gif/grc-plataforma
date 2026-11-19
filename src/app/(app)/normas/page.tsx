import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { FRAMEWORK_TYPES, label } from "@/lib/labels";
import Flash, { type FlashParams } from "@/components/flash";
import { EnumField, TextArea, TextField } from "@/components/fields";
import { createFramework, loadIso27001 } from "./actions";

export const metadata: Metadata = { title: "Normas y requisitos" };

export default async function FrameworksPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("frameworks.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("frameworks")
    .select("id, code, name, version, framework_type, source, active, requirements(count)")
    .order("name");
  const hasIso = (data ?? []).some((f) => f.code === "ISO27001");

  return (
    <>
      <div className="head">
        <h1>Normas y requisitos</h1>
        <p className="lead">
          Catálogo de normas, marcos y requisitos legales que la organización gestiona. Los requisitos se importan desde Excel
          y se enlazan con controles y documentos como evidencia.
        </p>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <div className="tablewrap">
          <table>
            <thead><tr><th>Norma</th><th>Versión</th><th>Tipo</th><th>Requisitos</th><th>Estado</th></tr></thead>
            <tbody>
              {(data ?? []).map((f) => (
                <tr key={f.id as string}>
                  <td><Link href={`/normas/${f.id}`}><b>{f.name as string}</b></Link> <span className="mono muted">{f.code as string}</span></td>
                  <td>{(f.version as string) || "—"}</td>
                  <td className="small">{label(FRAMEWORK_TYPES, f.framework_type)}</td>
                  <td>{(f.requirements as unknown as { count: number }[])?.[0]?.count ?? 0}</td>
                  <td><span className={`tag ${f.active ? "good" : "crit"}`}>{f.active ? "Activa" : "Inactiva"}</span></td>
                </tr>
              ))}
              {(data ?? []).length === 0 && <tr><td colSpan={5} className="muted">Aún no hay normas registradas.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {ctx.can("frameworks.write") && (
        <div className="grid2">
          {!hasIso && (
            <section className="panel">
              <h2>Empezar con ISO/IEC 27001:2022</h2>
              <p className="small muted">
                Carga la estructura de cláusulas 4 a 10 y los 93 controles del Anexo A, con títulos parafraseados. El texto
                oficial de la norma se incorporará cuando se firme la licencia con ISO.
              </p>
              <form action={loadIso27001}>
                <button type="submit">Cargar estructura base</button>
              </form>
            </section>
          )}
          <section className="panel">
            <h2>Nueva norma o marco</h2>
            <form action={createFramework} className="stack">
              <div className="row">
                <TextField name="code" label="Código" required placeholder="ISO9001" maxLength={40} />
                <TextField name="version" label="Versión" placeholder="2015" maxLength={20} />
                <EnumField name="framework_type" label="Tipo" map={FRAMEWORK_TYPES} value="certificable" />
              </div>
              <TextField name="name" label="Nombre" required wide />
              <TextArea name="description" label="Descripción" rows={2} />
              <div><button type="submit">Crear norma</button></div>
            </form>
          </section>
        </div>
      )}
    </>
  );
}
