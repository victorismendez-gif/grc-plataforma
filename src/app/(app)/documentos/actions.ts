"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { dbMessage, done, fail, str } from "@/lib/forms";
import { oneOf, optInt, optText, optUuid } from "@/lib/forms-parse";
import { DOC_TYPES, keysOf } from "@/lib/labels";

function docRecord(fd: FormData) {
  return {
    title: str(fd, "title").slice(0, 250),
    doc_type: oneOf(fd, "doc_type", keysOf(DOC_TYPES), "procedimiento"),
    description: optText(fd, "description"),
    process_id: optUuid(fd, "process_id"),
    owner_id: optUuid(fd, "owner_id"),
    classification_id: optUuid(fd, "classification_id"),
    review_months: optInt(fd, "review_months", 1, 60) ?? 12,
    requires_acknowledgment: fd.get("requires_acknowledgment") === "on",
  };
}

export async function createDocument(formData: FormData) {
  const ctx = await requirePermission("documents.write");
  const code = str(formData, "code").replace(/\s+/g, "").slice(0, 40);
  const rec = docRecord(formData);
  if (!/^[A-Za-z0-9._-]{1,40}$/.test(code) || rec.title.length < 2) fail("/documentos", "Escribe un código (sin espacios) y un título.");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("documents")
    .insert({ ...rec, code, organization_id: ctx.organization.id })
    .select("id")
    .single();
  if (error || !data) fail("/documentos", dbMessage(error, "No se pudo crear el documento."));
  await supabase.rpc("document_new_version", { p_document_id: data.id, p_change_summary: "Versión inicial" });
  revalidatePath("/documentos");
  redirect(`/documentos/${data.id}?ok=${encodeURIComponent("Documento creado. Carga el archivo de la versión 1.")}`);
}

export async function updateDocument(formData: FormData) {
  await requirePermission("documents.write");
  const id = optUuid(formData, "id");
  if (!id) fail("/documentos", "Documento no válido.");
  const rec = docRecord(formData);
  if (rec.title.length < 2) fail(`/documentos/${id}`, "El título es obligatorio.");
  const supabase = await createClient();
  const { error } = await supabase.from("documents").update(rec).eq("id", id);
  if (error) fail(`/documentos/${id}`, dbMessage(error, "No se pudo guardar."));
  revalidatePath(`/documentos/${id}`);
  done(`/documentos/${id}`, "Datos del documento guardados.");
}

export async function newVersion(formData: FormData) {
  await requirePermission("documents.write");
  const id = optUuid(formData, "document_id");
  if (!id) fail("/documentos", "Documento no válido.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("document_new_version", {
    p_document_id: id,
    p_change_summary: optText(formData, "change_summary", 1000),
  });
  if (error) fail(`/documentos/${id}`, error.code === "23505" ? "Ya hay una versión en curso." : error.message);
  revalidatePath(`/documentos/${id}`);
  done(`/documentos/${id}`, "Nueva versión en borrador. Carga el archivo actualizado.");
}

const ACTIONS = ["enviar_revision", "revisar", "devolver", "aprobar", "publicar"] as const;
const MESSAGES: Record<(typeof ACTIONS)[number], string> = {
  enviar_revision: "Enviado a revisión.",
  revisar: "Marcado como revisado. Pasa a aprobación.",
  devolver: "Devuelto al autor con observaciones.",
  aprobar: "Aprobado. Ya se puede publicar.",
  publicar: "Publicado. Es la versión vigente.",
};

export async function transition(formData: FormData) {
  const ctx = await requirePermission("documents.read");
  const documentId = optUuid(formData, "document_id");
  const versionId = optUuid(formData, "version_id");
  const action = oneOf(formData, "action", ACTIONS, "enviar_revision");
  if (!documentId || !versionId) fail("/documentos", "Datos no válidos.");
  // El permiso exacto lo verifica la base en document_transition
  if (!ctx.can("documents.write") && !ctx.can("documents.approve")) fail(`/documentos/${documentId}`, "Sin permiso.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("document_transition", {
    p_version_id: versionId,
    p_action: action,
    p_notes: optText(formData, "notes", 2000),
  });
  if (error) fail(`/documentos/${documentId}`, error.message);
  revalidatePath(`/documentos/${documentId}`);
  revalidatePath("/documentos");
  revalidatePath("/politicas");
  done(`/documentos/${documentId}`, MESSAGES[action]);
}

/** Registra el archivo ya subido a Storage (la ruta debe corresponder a la versión). */
export async function registerFile(input: {
  documentId: string;
  versionId: string;
  path: string;
  name: string;
  size: number;
  sha256: string;
  mime: string;
}): Promise<{ ok: boolean; message?: string }> {
  const ctx = await requirePermission("documents.write");
  const prefix = `${ctx.organization.id}/${input.documentId}/${input.versionId}/`;
  if (!input.path.startsWith(prefix) || input.path.slice(prefix.length).includes("/")) return { ok: false, message: "Ruta no válida." };
  if (!/^[0-9a-f]{64}$/.test(input.sha256)) return { ok: false, message: "Huella del archivo no válida." };
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("document_versions")
    .update({
      file_path: input.path,
      file_name: input.name.slice(0, 250),
      file_size: Math.max(0, Math.floor(input.size)),
      file_sha256: input.sha256,
      mime_type: input.mime.slice(0, 120) || null,
    })
    .eq("id", input.versionId)
    .eq("document_id", input.documentId)
    .eq("status", "borrador")
    .select("id");
  if (error || !data?.length) return { ok: false, message: "La versión no está en borrador o no tienes permiso." };
  revalidatePath(`/documentos/${input.documentId}`);
  return { ok: true };
}

export async function linkDocRequirement(formData: FormData) {
  const ctx = await requirePermission("documents.write");
  const documentId = optUuid(formData, "document_id");
  const ids = formData.getAll("requirement_id").map(String).filter((v) => /^[0-9a-f-]{36}$/.test(v));
  if (!documentId) fail("/documentos", "Documento no válido.");
  if (!ids.length) fail(`/documentos/${documentId}`, "Selecciona al menos un requisito.");
  const supabase = await createClient();
  const { error } = await supabase.from("document_requirements").upsert(
    ids.map((requirement_id) => ({ organization_id: ctx.organization.id, document_id: documentId, requirement_id })),
    { onConflict: "document_id,requirement_id", ignoreDuplicates: true },
  );
  if (error) fail(`/documentos/${documentId}`, dbMessage(error, "No se pudo asociar."));
  revalidatePath(`/documentos/${documentId}`);
  done(`/documentos/${documentId}`, `${ids.length} requisito(s) asociado(s) como evidencia.`);
}

export async function unlinkDocRequirement(formData: FormData) {
  await requirePermission("documents.write");
  const documentId = optUuid(formData, "document_id");
  const requirementId = optUuid(formData, "requirement_id");
  if (!documentId || !requirementId) fail("/documentos", "Datos no válidos.");
  const supabase = await createClient();
  await supabase.from("document_requirements").delete().eq("document_id", documentId).eq("requirement_id", requirementId);
  revalidatePath(`/documentos/${documentId}`);
  done(`/documentos/${documentId}`, "Requisito retirado.");
}

export async function acknowledge(formData: FormData) {
  await requirePermission("documents.read");
  const versionId = optUuid(formData, "version_id");
  if (!versionId) fail("/politicas", "Política no válida.");
  const supabase = await createClient();
  const { error } = await supabase.rpc("acknowledge_policy", { p_version_id: versionId });
  if (error) fail("/politicas", error.message);
  revalidatePath("/politicas");
  done("/politicas", "Gracias. Quedó registrada tu aceptación.");
}
