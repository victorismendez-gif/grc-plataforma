import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { DOC_TYPES, label, VERSION_STATUS } from "@/lib/labels";
import Flash from "@/components/flash";
import { getProcesses } from "@/lib/lookups";
import DocForm from "./doc-form";
import { createDocument } from "./actions";

export const metadata: Metadata = { title: "Documentos" };

type SP = { error?: string; ok?: string; tipo?: string; q?: string; proceso?: string };
type Row = {
  id: string;
  code: string;
  title: string;
  doc_type: string;
  version_label: string | null;
  next_review_on: string | null;
  active: boolean;
  process_id: string | null;
  owner_text: string | null;
  owner: { full_name: string } | null;
  current: { version_no: number; published_at: string } | null;
  document_versions: { status: string; version_no: number }[];
};

export default async function DocumentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  const ctx = await requirePermission("documents.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const processes = await getProcesses();
  const processName = new Map(processes.map((p) => [p.id, p.label]));
  let q = supabase
    .from("documents")
    .select("id, code, title, doc_type, version_label, next_review_on, active, process_id, owner_text, owner:profiles!documents_organization_id_owner_id_fkey(full_name), current:document_versions!documents_current_version_fkey(version_no, published_at), document_versions!document_versions_organization_id_document_id_fkey(status, version_no)")
    .order("code")
    .limit(500);
  if (sp.tipo && sp.tipo in DOC_TYPES) q = q.eq("doc_type", sp.tipo);
  if (sp.proceso && /^[0-9a-f-]{36}$/.test(sp.proceso)) q = q.eq("process_id", sp.proceso);
  if (sp.q) {
    const term = sp.q.replace(/[%,()*]/g, " ").trim().slice(0, 60);
    if (term) q = q.or(`code.ilike.%${term}%,title.ilike.%${term}%`);
  }
  const [{ data }, { count: total }] = await Promise.all([q, supabase.from("documents").select("id", { count: "exact", head: true })]);
  const today = new Date().toISOString().slice(0, 10);
  const rows = ((data ?? []) as unknown as Row[]).filter((d) => d.active || ctx.can("documents.write"));
  const vigentes = rows.filter((d) => d.current).length;
  const vencidos = rows.filter((d) => d.current && d.next_review_on && d.next_review_on < today).length;

  return (
    <>
      <div className="head">
        <h1>Documentos y políticas</h1>
        <p className="lead">
          Control documental con versiones y flujo elaborar → revisar → aprobar → publicar. Quien elabora no puede revisar
          ni aprobar su propio documento. Solo la versión vigente es visible para consulta.
        </p>
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <div className="kpis">
        <div className="kpi"><b>{total ?? rows.length}</b><small>documentos</small></div>
        <div className="kpi ok"><b>{vigentes}</b><small>con versión vigente</small></div>
        <div className={`kpi ${vencidos ? "bad" : ""}`}><b>{vencidos}</b><small>con revisión vencida</small></div>
      </div>
      <section className="panel">
        <form method="get" className="row">
          <label style={{ flex: 1 }}>Buscar<input name="q" defaultValue={sp.q ?? ""} /></label>
          <label>
            Tipo
            <select name="tipo" defaultValue={sp.tipo ?? ""}>
              <option value="">Todos</option>
              {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </label>
          <label>
            Proceso
            <select name="proceso" defaultValue={sp.proceso ?? ""} style={{ maxWidth: 280 }}>
              <option value="">Todos</option>
              {processes.map((p) => <option key={p.id} value={p.id}>{p.code ? `${p.code} · ` : ""}{p.label}</option>)}
            </select>
          </label>
          <button type="submit">Filtrar</button>
        </form>
        {rows.length >= 500 && <p className="small muted">Se muestran los primeros 500 de {total ?? "muchos"} documentos. Usa los filtros para acotar.</p>}
        <div className="tablewrap">
          <table>
            <thead><tr><th>Código</th><th>Título</th><th>Tipo</th><th>Proceso</th><th>Responsable</th><th>Vigente</th><th>En curso</th><th>Próxima revisión</th></tr></thead>
            <tbody>
              {rows.map((d) => {
                const open = d.document_versions.find((v) => !["publicado", "obsoleto"].includes(v.status));
                const overdue = d.next_review_on && d.next_review_on < today;
                return (
                  <tr key={d.id}>
                    <td className="mono"><Link href={`/documentos/${d.id}`}>{d.code}</Link></td>
                    <td>{d.title} {d.version_label && <span className="small muted">v{d.version_label}</span>} {!d.active && <span className="tag crit">Inactivo</span>}</td>
                    <td className="small">{label(DOC_TYPES, d.doc_type)}</td>
                    <td className="small">{(d.process_id && processName.get(d.process_id)) || "—"}</td>
                    <td className="small">{d.owner?.full_name ?? d.owner_text ?? "—"}</td>
                    <td>{d.current ? <span className="tag good">v{d.current.version_no}</span> : <span className="muted small">Sin publicar</span>}</td>
                    <td className="small">{open ? `v${open.version_no} · ${label(VERSION_STATUS, open.status)}` : "—"}</td>
                    <td className="small">{d.next_review_on ? <span className={overdue ? "tag crit" : ""}>{d.next_review_on}</span> : "—"}</td>
                  </tr>
                );
              })}
              {rows.length === 0 && <tr><td colSpan={8} className="muted">Aún no hay documentos.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      {ctx.can("documents.write") && (
        <section className="panel">
          <details>
            <summary>Nuevo documento</summary>
            <div style={{ marginTop: 12 }}><DocForm action={createDocument} /></div>
          </details>
        </section>
      )}
    </>
  );
}
