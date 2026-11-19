import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DOC_TYPES, label, VERSION_STATUS } from "@/lib/labels";
import Flash from "@/components/flash";
import DocForm, { type DocData } from "../doc-form";
import { linkDocRequirement, newVersion, transition, unlinkDocRequirement, updateDocument } from "../actions";
import VersionUploader from "./uploader";

export const metadata: Metadata = { title: "Documento" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };
type Version = {
  id: string;
  version_no: number;
  status: keyof typeof VERSION_STATUS;
  change_summary: string | null;
  file_name: string | null;
  file_size: number | null;
  file_sha256: string | null;
  created_by: string | null;
  created_at: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  approved_by: string | null;
  approved_at: string | null;
  published_at: string | null;
};

const fmt = (d: string | null) => (d ? new Date(d).toLocaleDateString("es-CO", { timeZone: "America/Bogota" }) : "—");

export default async function DocumentPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("documents.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: doc } = await supabase.from("documents").select("*").eq("id", id).maybeSingle();
  if (!doc) notFound();
  const canWrite = ctx.can("documents.write");
  const canApprove = ctx.can("documents.approve");
  const [{ data: versions }, { data: people }, { data: links }, { data: reqs }, { data: frameworks }] = await Promise.all([
    supabase.from("document_versions").select("*").eq("document_id", id).order("version_no", { ascending: false }),
    supabase.from("profiles").select("id, full_name"),
    supabase.from("document_requirements").select("requirement:requirements(id, clause, title, framework_id)").eq("document_id", id),
    canWrite
      ? supabase.from("requirements").select("id, clause, title, framework_id").eq("is_auditable", true).order("sort_key").limit(3000)
      : Promise.resolve({ data: [] as { id: string; clause: string; title: string; framework_id: string }[] }),
    supabase.from("frameworks").select("id, code, name").order("name"),
  ]);
  const who = new Map((people ?? []).map((p) => [p.id as string, p.full_name as string]));
  const vs = (versions ?? []) as Version[];
  const open = vs.find((v) => !["publicado", "obsoleto"].includes(v.status));
  const fwCode = new Map((frameworks ?? []).map((f) => [f.id as string, f.code as string]));
  const linked = ((links ?? []).map((l) => l.requirement) as unknown as { id: string; clause: string; title: string; framework_id: string }[]).filter(Boolean);
  const linkedIds = new Set(linked.map((r) => r.id));
  const available = ((reqs ?? []) as { id: string; clause: string; title: string; framework_id: string }[]).filter((r) => !linkedIds.has(r.id));

  return (
    <>
      <div className="head">
        <Link href="/documentos" className="small">← Documentos</Link>
        <h1><span className="mono">{doc.code}</span> · {doc.title}</h1>
        <p className="lead">
          {label(DOC_TYPES, doc.doc_type)} · revisión cada {doc.review_months} meses
          {doc.next_review_on && <> · próxima revisión {doc.next_review_on}</>}
        </p>
      </div>
      <Flash {...sp} />

      {open && (canWrite || canApprove) && (
        <section className="panel" style={{ borderColor: "var(--accent)" }}>
          <h2>Versión {open.version_no} en curso: {VERSION_STATUS[open.status]}</h2>
          {open.change_summary && <p className="small">Cambios: {open.change_summary}</p>}
          {open.review_notes && <div className="alert info small"><b>Observaciones:</b> {open.review_notes}</div>}
          <p className="small muted">
            Elaboró: {who.get(open.created_by ?? "") ?? "—"}
            {open.reviewed_by && <> · Revisó: {who.get(open.reviewed_by)}</>}
            {open.approved_by && <> · Aprobó: {who.get(open.approved_by)}</>}
          </p>
          {open.file_name ? (
            <p className="small">
              Archivo: <a href={`/documentos/archivo/${open.id}`}>{open.file_name}</a>{" "}
              <span className="mono muted">SHA-256 {open.file_sha256?.slice(0, 12)}…</span>
            </p>
          ) : (
            <p className="small muted">Aún no tiene archivo.</p>
          )}
          {open.status === "borrador" && canWrite && (
            <VersionUploader orgId={ctx.organization.id} documentId={id} versionId={open.id} />
          )}
          <div className="row">
            {open.status === "borrador" && canWrite && (
              <Step versionId={open.id} documentId={id} action="enviar_revision" text="Enviar a revisión" />
            )}
            {open.status === "en_revision" && canWrite && open.created_by !== ctx.userId && (
              <Step versionId={open.id} documentId={id} action="revisar" text="Marcar como revisado" notes />
            )}
            {open.status === "revisado" && canApprove && open.created_by !== ctx.userId && (
              <Step versionId={open.id} documentId={id} action="aprobar" text="Aprobar" />
            )}
            {open.status === "aprobado" && canApprove && (
              <Step versionId={open.id} documentId={id} action="publicar" text="Publicar como vigente" />
            )}
            {["en_revision", "revisado", "aprobado"].includes(open.status) && (canWrite || canApprove) && (
              <Step versionId={open.id} documentId={id} action="devolver" text="Devolver con observaciones" notes required danger />
            )}
          </div>
          {open.created_by === ctx.userId && ["en_revision", "revisado"].includes(open.status) && (
            <p className="small muted">Elaboraste esta versión: la revisión y la aprobación las hace otra persona.</p>
          )}
        </section>
      )}

      <section className="panel">
        <h2>Versiones</h2>
        <div className="tablewrap">
          <table>
            <thead><tr><th>Versión</th><th>Estado</th><th>Cambios</th><th>Elaboró</th><th>Revisó</th><th>Aprobó</th><th>Publicada</th><th>Archivo</th></tr></thead>
            <tbody>
              {vs.map((v) => (
                <tr key={v.id}>
                  <td>v{v.version_no}</td>
                  <td><span className={`tag ${v.status === "publicado" ? "good" : v.status === "obsoleto" ? "" : "warn"}`}>{VERSION_STATUS[v.status]}</span></td>
                  <td className="small">{v.change_summary ?? "—"}</td>
                  <td className="small">{who.get(v.created_by ?? "") ?? "—"}</td>
                  <td className="small">{v.reviewed_by ? `${who.get(v.reviewed_by)} · ${fmt(v.reviewed_at)}` : "—"}</td>
                  <td className="small">{v.approved_by ? `${who.get(v.approved_by)} · ${fmt(v.approved_at)}` : "—"}</td>
                  <td className="small">{fmt(v.published_at)}</td>
                  <td className="small">{v.file_name ? <a href={`/documentos/archivo/${v.id}`}>Descargar</a> : "—"}</td>
                </tr>
              ))}
              {vs.length === 0 && <tr><td colSpan={8} className="muted">Sin versiones visibles.</td></tr>}
            </tbody>
          </table>
        </div>
        {canWrite && !open && doc.active && (
          <form action={newVersion} className="row">
            <input type="hidden" name="document_id" value={id} />
            <label style={{ flex: 1 }}>Motivo de la nueva versión<input name="change_summary" required maxLength={1000} /></label>
            <button type="submit">Crear nueva versión</button>
          </form>
        )}
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Datos del documento</h2>
          <DocForm doc={doc as DocData} action={updateDocument} readOnly={!canWrite} />
        </section>
        <section className="panel">
          <h2>Requisitos que evidencia ({linked.length})</h2>
          <table>
            <tbody>
              {linked.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{fwCode.get(r.framework_id)} {r.clause}</td>
                  <td className="small">{r.title}</td>
                  {canWrite && (
                    <td>
                      <form action={unlinkDocRequirement}>
                        <input type="hidden" name="document_id" value={id} />
                        <input type="hidden" name="requirement_id" value={r.id} />
                        <button type="submit" className="link small">Quitar</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {linked.length === 0 && <tr><td className="muted small">Sin requisitos asociados.</td></tr>}
            </tbody>
          </table>
          {canWrite && available.length > 0 && (
            <form action={linkDocRequirement} className="stack">
              <input type="hidden" name="document_id" value={id} />
              <label>
                Agregar requisitos (Ctrl o Cmd para elegir varios)
                <select name="requirement_id" multiple size={8}>
                  {(frameworks ?? []).map((f) => (
                    <optgroup key={f.id as string} label={f.name as string}>
                      {available.filter((r) => r.framework_id === f.id).map((r) => (
                        <option key={r.id} value={r.id}>{r.clause} · {r.title}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div><button type="submit">Asociar</button></div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

function Step({
  versionId,
  documentId,
  action,
  text,
  notes,
  required,
  danger,
}: {
  versionId: string;
  documentId: string;
  action: string;
  text: string;
  notes?: boolean;
  required?: boolean;
  danger?: boolean;
}) {
  return (
    <form action={transition} className="inline">
      <input type="hidden" name="version_id" value={versionId} />
      <input type="hidden" name="document_id" value={documentId} />
      <input type="hidden" name="action" value={action} />
      {notes && <input name="notes" placeholder={required ? "Observaciones (obligatorio)" : "Observaciones (opcional)"} required={required} maxLength={2000} />}
      <button type="submit" className={danger ? "danger" : undefined}>{text}</button>
    </form>
  );
}
