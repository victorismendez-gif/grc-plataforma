import "server-only";
import { dbMessage, str } from "@/lib/forms";
import { oneOf, optDate, optText, optUuid } from "@/lib/forms-parse";
import { isEmail, isIp, NAME_MAX } from "@/lib/asset-profiles";
import { ASSET_STATUS, keysOf } from "@/lib/labels";

/** Solo incluye los campos que el formulario envió (los ocultos por el tipo no se tocan). */
export function assetRecord(fd: FormData): { record: Record<string, unknown>; error?: string } {
  const r: Record<string, unknown> = {};
  const has = (k: string) => fd.has(k);
  if (has("code")) r.code = str(fd, "code").slice(0, 60) || null;
  if (has("asset_type_id")) r.asset_type_id = optUuid(fd, "asset_type_id");
  if (has("name")) {
    const name = str(fd, "name");
    if (name.length > NAME_MAX) return { record: r, error: `El nombre del activo admite máximo ${NAME_MAX} caracteres.` };
    r.name = name || null;
  }
  if (has("description")) r.description = optText(fd, "description");
  if (has("custodian")) r.custodian = optText(fd, "custodian", 200);
  if (has("custodian_email")) {
    const email = str(fd, "custodian_email").toLowerCase();
    if (email && !isEmail(email)) return { record: r, error: `«${email}» no es un correo válido para el custodio.` };
    r.custodian_email = email || null;
  }
  if (has("location")) r.location = optText(fd, "location", 200);
  if (has("classification_id")) r.classification_id = optUuid(fd, "classification_id");
  for (const k of ["confidentiality", "integrity", "availability"] as const) if (has(k)) r[k] = optLevel5(fd, k);
  if (has("status")) r.status = oneOf(fd, "status", keysOf(ASSET_STATUS), "activo");
  if (has("brand")) r.brand = optText(fd, "brand", 120);
  if (has("model")) r.model = optText(fd, "model", 120);
  if (has("serial_number")) r.serial_number = optText(fd, "serial_number", 120);
  if (has("operating_system")) r.operating_system = optText(fd, "operating_system", 120);
  if (has("acquired_on")) r.acquired_on = optDate(fd, "acquired_on");
  if (has("ip_address")) {
    const ip = str(fd, "ip_address");
    if (ip && !isIp(ip)) return { record: r, error: `«${ip}» no es una dirección IP válida.` };
    r.ip_address = ip || null;
  }
  return { record: r };
}

function optLevel5(fd: FormData, key: string): number | null {
  const v = Number(fd.get(key));
  return Number.isInteger(v) && v >= 1 && v <= 5 ? v : null;
}

/** Mensaje claro para errores de la base (identificador faltante, duplicado…). */
export function assetDbMessage(error: { code?: string; message?: string } | null): string {
  if (error?.code === "23502" && error.message?.startsWith("Falta el identificador")) return error.message + ".";
  if (error?.code === "23505") return "Ya existe un activo con ese identificador.";
  return dbMessage(error, "No se pudo guardar el activo.");
}

