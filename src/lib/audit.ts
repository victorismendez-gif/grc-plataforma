// Utilidades para consultar y exportar el registro de auditoría.

export type AuditFilters = {
  tabla?: string;
  accion?: string;
  usuario?: string;
  desde?: string;
  hasta?: string;
};

export type AuditRow = {
  id: number;
  occurred_at: string;
  actor_email: string | null;
  action: string;
  table_name: string;
  record_id: string | null;
  changed_fields: string[] | null;
  old_data: Record<string, unknown> | null;
  new_data: Record<string, unknown> | null;
  hash: string;
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const WORD_RE = /^[A-Za-z_]{1,40}$/;

/** Normaliza filtros de la URL descartando valores no válidos. */
export function parseAuditFilters(sp: Record<string, string | string[] | undefined>): AuditFilters {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
  };
  const f: AuditFilters = {};
  const tabla = one("tabla");
  const accion = one("accion");
  const usuario = one("usuario");
  const desde = one("desde");
  const hasta = one("hasta");
  if (tabla && WORD_RE.test(tabla)) f.tabla = tabla;
  if (accion && WORD_RE.test(accion)) f.accion = accion.toUpperCase();
  if (usuario && usuario.length <= 120 && !/[,()]/.test(usuario)) f.usuario = usuario;
  if (desde && DATE_RE.test(desde)) f.desde = desde;
  if (hasta && DATE_RE.test(hasta)) f.hasta = hasta;
  return f;
}

/** Valores de un campo en formato CSV (RFC 4180) con protección contra fórmulas. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : typeof value === "string" ? value : JSON.stringify(value);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: AuditRow[]): string {
  const header = ["id", "fecha_utc", "usuario", "accion", "tabla", "registro", "campos_cambiados", "valor_anterior", "valor_nuevo", "hash"];
  const lines = rows.map((r) =>
    [
      r.id,
      r.occurred_at,
      r.actor_email,
      r.action,
      r.table_name,
      r.record_id,
      (r.changed_fields ?? []).join(" "),
      r.old_data,
      r.new_data,
      r.hash,
    ]
      .map(csvCell)
      .join(","),
  );
  // BOM para que Excel abra los acentos correctamente
  return "﻿" + [header.join(","), ...lines].join("\r\n");
}

/** Resume el cambio para mostrarlo en pantalla. */
export function describeChange(r: AuditRow): string {
  if (r.action === "UPDATE" && r.changed_fields?.length) {
    return r.changed_fields
      .filter((f) => f !== "updated_at")
      .map((f) => `${f}: ${short(r.old_data?.[f])} → ${short(r.new_data?.[f])}`)
      .join("\n");
  }
  const data = r.new_data ?? r.old_data;
  if (!data) return "";
  const keys = ["name", "full_name", "email", "code", "permission_code", "role_id", "user_id", "active"].filter((k) => k in data);
  return keys.map((k) => `${k}: ${short(data[k])}`).join("\n");
}

function short(v: unknown): string {
  const s = v === null || v === undefined ? "∅" : typeof v === "string" ? v : JSON.stringify(v);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}
