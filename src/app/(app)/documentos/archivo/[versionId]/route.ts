import { NextResponse, type NextRequest } from "next/server";
import { getSessionState } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

/** Descarga: verifica permiso (RLS) y redirige a un enlace firmado de 60 segundos. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ versionId: string }> }) {
  const { versionId } = await params;
  const state = await getSessionState();
  if (state.status !== "ok" || !state.ctx.can("documents.read")) {
    return NextResponse.json({ error: "Sin permiso" }, { status: 403 });
  }
  if (!/^[0-9a-f-]{36}$/.test(versionId)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const supabase = await createClient();
  const { data: v } = await supabase.from("document_versions").select("file_path, file_name").eq("id", versionId).maybeSingle();
  if (!v?.file_path) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const { data, error } = await supabase.storage
    .from("documentos")
    .createSignedUrl(v.file_path as string, 60, { download: (v.file_name as string) ?? true });
  if (error || !data) return NextResponse.json({ error: "No disponible" }, { status: 404 });
  return NextResponse.redirect(data.signedUrl, { status: 303 });
}
