import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { AuditFilters, AuditRow } from "@/lib/audit";

const COLUMNS = "id, occurred_at, actor_email, action, table_name, record_id, changed_fields, old_data, new_data, hash";

/** Consulta paginada del registro de auditoría (la RLS limita a la organización y al permiso). */
export async function queryAudit(filters: AuditFilters, offset: number, limit: number) {
  const supabase = await createClient();
  let q = supabase.from("audit_log").select(COLUMNS, { count: "exact" }).order("id", { ascending: false });
  if (filters.tabla) q = q.eq("table_name", filters.tabla);
  if (filters.accion) q = q.eq("action", filters.accion);
  if (filters.usuario) q = q.ilike("actor_email", `%${filters.usuario}%`);
  if (filters.desde) q = q.gte("occurred_at", `${filters.desde}T00:00:00Z`);
  if (filters.hasta) q = q.lte("occurred_at", `${filters.hasta}T23:59:59.999Z`);
  const { data, count, error } = await q.range(offset, offset + limit - 1);
  return { rows: (data ?? []) as unknown as AuditRow[], count: count ?? 0, error };
}
