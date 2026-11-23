import "server-only";
import { headers } from "next/headers";
import { SITE_URL } from "@/lib/env";

/**
 * URL pública para enlaces de invitación y acceso. Usa la variable si es
 * válida; si no, el dominio con el que llegó la petición.
 */
export async function getSiteUrl(): Promise<string> {
  if (!SITE_URL.includes("localhost")) return SITE_URL;
  const h = await headers();
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0].trim();
  if (!/^[a-z0-9.-]+(:\d+)?$/i.test(host)) return SITE_URL;
  const proto = (h.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https")).split(",")[0].trim();
  return `${proto === "http" ? "http" : "https"}://${host}`;
}
