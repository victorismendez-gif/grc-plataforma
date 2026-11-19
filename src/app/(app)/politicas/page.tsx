import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Flash, { type FlashParams } from "@/components/flash";
import { acknowledge } from "../documentos/actions";

export const metadata: Metadata = { title: "Políticas" };

type Policy = {
  id: string;
  code: string;
  title: string;
  description: string | null;
  requires_acknowledgment: boolean;
  current: { id: string; version_no: number; published_at: string; file_name: string | null } | null;
};

export default async function PoliciesPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("documents.read");
  const sp = await searchParams;
  const supabase = await createClient();
  const { data } = await supabase
    .from("documents")
    .select("id, code, title, description, requires_acknowledgment, current:document_versions!documents_current_version_fkey(id, version_no, published_at, file_name)")
    .eq("doc_type", "politica")
    .eq("active", true)
    .not("current_version_id", "is", null)
    .order("code");
  const policies = (data ?? []) as unknown as Policy[];
  const versionIds = policies.map((p) => p.current?.id).filter(Boolean) as string[];
  const canSeeAll = ctx.can("documents.approve") || ctx.can("documents.write");
  const [{ data: acks }, { count: people }] = await Promise.all([
    versionIds.length
      ? supabase.from("policy_acknowledgments").select("document_version_id, user_id, acknowledged_at").in("document_version_id", versionIds)
      : Promise.resolve({ data: [] as { document_version_id: string; user_id: string; acknowledged_at: string }[] }),
    supabase.from("profiles").select("id", { count: "exact", head: true }).eq("active", true),
  ]);
  const mine = new Map((acks ?? []).filter((a) => a.user_id === ctx.userId).map((a) => [a.document_version_id as string, a.acknowledged_at as string]));
  const countBy = new Map<string, number>();
  for (const a of acks ?? []) countBy.set(a.document_version_id as string, (countBy.get(a.document_version_id as string) ?? 0) + 1);

  return (
    <>
      <div className="head">
        <h1>Políticas vigentes</h1>
        <p className="lead">Léelas y registra tu aceptación. Cada nueva versión publicada requiere una nueva aceptación.</p>
      </div>
      <Flash {...sp} />
      {policies.length === 0 && <section className="panel"><p className="muted">No hay políticas publicadas todavía.</p></section>}
      {policies.map((p) => {
        const v = p.current!;
        const ackAt = mine.get(v.id);
        return (
          <section key={p.id} className="panel">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <h2>{p.title} <span className="muted small">v{v.version_no}</span></h2>
                <p className="small muted">{p.code} · publicada el {new Date(v.published_at).toLocaleDateString("es-CO")}</p>
              </div>
              {v.file_name && <a className="btn ghost" href={`/documentos/archivo/${v.id}`}>Leer la política</a>}
            </div>
            {p.description && <p className="small">{p.description}</p>}
            {p.requires_acknowledgment &&
              (ackAt ? (
                <div className="alert ok small">Aceptaste esta versión el {new Date(ackAt).toLocaleString("es-CO", { timeZone: "America/Bogota" })}.</div>
              ) : (
                <form action={acknowledge} className="row">
                  <input type="hidden" name="version_id" value={v.id} />
                  <label className="check"><input type="checkbox" required /> Leí la política y me comprometo a cumplirla</label>
                  <button type="submit">Registrar aceptación</button>
                </form>
              ))}
            {canSeeAll && p.requires_acknowledgment && (
              <p className="small muted">
                Cobertura: {countBy.get(v.id) ?? 0} de {people ?? 0} personas activas (
                {people ? Math.round(((countBy.get(v.id) ?? 0) / people) * 100) : 0}%). <Link href={`/documentos/${p.id}`}>Ver documento</Link>
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
