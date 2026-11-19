import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { CRITICALITY, FRAMEWORK_TYPES, label, levelTone, LEVELS } from "@/lib/labels";
import Flash from "@/components/flash";
import { EnumField, TextArea, TextField } from "@/components/fields";
import { saveRequirement, toggleFramework } from "../actions";
import RequirementImporter from "./importer";

export const metadata: Metadata = { title: "Norma" };

type Req = {
  id: string;
  clause: string;
  title: string;
  description: string | null;
  evidence_guidance: string | null;
  criticality: number;
  is_auditable: boolean;
  parent_id: string | null;
  control_requirements: { count: number }[];
  document_requirements: { count: number }[];
};

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string; q?: string }> };

export default async function FrameworkPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("frameworks.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: fw } = await supabase.from("frameworks").select("*").eq("id", id).maybeSingle();
  if (!fw) notFound();
  const { data } = await supabase
    .from("requirements")
    .select("id, clause, title, description, evidence_guidance, criticality, is_auditable, parent_id, control_requirements(count), document_requirements(count)")
    .eq("framework_id", id)
    .order("sort_key")
    .limit(3000);
  const all = (data ?? []) as unknown as Req[];
  const term = (sp.q ?? "").toLowerCase().trim();
  const reqs = term ? all.filter((r) => r.clause.toLowerCase().includes(term) || r.title.toLowerCase().includes(term)) : all;
  const auditable = all.filter((r) => r.is_auditable);
  const covered = auditable.filter((r) => (r.control_requirements[0]?.count ?? 0) + (r.document_requirements[0]?.count ?? 0) > 0).length;
  const canWrite = ctx.can("frameworks.write");

  return (
    <>
      <div className="head">
        <Link href="/normas" className="small">← Normas</Link>
        <h1>{fw.name} {fw.version && <span className="muted">{fw.version}</span>}</h1>
        <p className="lead">{label(FRAMEWORK_TYPES, fw.framework_type)}. {fw.description}</p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="kpis">
        <div className="kpi"><b>{all.length}</b><small>requisitos y títulos</small></div>
        <div className="kpi"><b>{auditable.length}</b><small>requisitos evaluables</small></div>
        <div className={`kpi ${covered < auditable.length ? "" : "ok"}`}>
          <b>{auditable.length ? Math.round((covered / auditable.length) * 100) : 0}%</b>
          <small>con control o documento asociado</small>
        </div>
      </div>

      <section className="panel">
        <form method="get" className="row">
          <label style={{ flex: 1 }}>Buscar<input name="q" defaultValue={sp.q ?? ""} placeholder="Cláusula o título" /></label>
          <button type="submit">Buscar</button>
        </form>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Cláusula</th><th>Requisito</th><th>Criticidad</th><th>Controles</th><th>Documentos</th>{canWrite && <th></th>}</tr></thead>
            <tbody>
              {reqs.map((r) => {
                const depth = r.clause.split(".").length - 1;
                return (
                  <tr key={r.id} style={!r.is_auditable ? { background: "var(--accent-s)" } : undefined}>
                    <td className="mono">{r.clause}</td>
                    <td style={{ paddingLeft: 10 + Math.min(depth, 3) * 14 }}>
                      {r.is_auditable ? r.title : <b>{r.title}</b>}
                      {r.evidence_guidance && <div className="small muted">Evidencia: {r.evidence_guidance}</div>}
                    </td>
                    <td>{r.is_auditable ? <span className={`tag ${levelTone(r.criticality)}`}>{label(CRITICALITY, r.criticality)}</span> : ""}</td>
                    <td>{r.is_auditable ? r.control_requirements[0]?.count ?? 0 : ""}</td>
                    <td>{r.is_auditable ? r.document_requirements[0]?.count ?? 0 : ""}</td>
                    {canWrite && (
                      <td>
                        <details>
                          <summary className="small">Editar</summary>
                          <RequirementForm frameworkId={id} req={r} />
                        </details>
                      </td>
                    )}
                  </tr>
                );
              })}
              {reqs.length === 0 && <tr><td colSpan={6} className="muted">Sin requisitos. Impórtalos desde Excel o agrégalos uno a uno.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {canWrite && (
        <div className="grid2">
          <section className="panel">
            <h2>Importar requisitos desde Excel</h2>
            <p className="small muted">
              Columnas: <b>Cláusula</b> y <b>Título</b> (obligatorias), y opcionalmente Descripción, Guía de evidencia,
              Criticidad (Baja/Media/Alta) y Auditable (Sí/No). Si la cláusula ya existe se actualiza. La jerarquía se deduce de
              la numeración (4.4.1 depende de 4.4).
            </p>
            <RequirementImporter frameworkId={id} />
          </section>
          <section className="panel">
            <h2>Agregar requisito</h2>
            <RequirementForm frameworkId={id} />
          </section>
        </div>
      )}
      {canWrite && (
        <form action={toggleFramework}>
          <input type="hidden" name="id" value={id} />
          <input type="hidden" name="active" value={String(!fw.active)} />
          <button type="submit" className={fw.active ? "danger" : "ghost"}>{fw.active ? "Desactivar norma" : "Activar norma"}</button>
        </form>
      )}
    </>
  );
}

function RequirementForm({ frameworkId, req }: { frameworkId: string; req?: Req }) {
  return (
    <form action={saveRequirement} className="stack" style={{ marginTop: 8, minWidth: 300 }}>
      <input type="hidden" name="framework_id" value={frameworkId} />
      {req && <input type="hidden" name="id" value={req.id} />}
      <div className="row">
        <TextField name="clause" label="Cláusula" value={req?.clause} required maxLength={30} />
        <EnumField name="criticality" label="Criticidad" map={LEVELS} value={req?.criticality ?? 2} />
        <label className="check"><input type="checkbox" name="is_auditable" defaultChecked={req?.is_auditable ?? true} /> Evaluable</label>
      </div>
      <TextField name="title" label="Título" value={req?.title} required wide maxLength={300} />
      <TextArea name="description" label="Descripción" value={req?.description} rows={2} />
      <TextArea name="evidence_guidance" label="Guía de evidencia" value={req?.evidence_guidance} rows={2} />
      <div><button type="submit">{req ? "Guardar" : "Agregar"}</button></div>
    </form>
  );
}
