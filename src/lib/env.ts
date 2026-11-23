// Variables de entorno. Las públicas se insertan en el navegador al compilar.
export const SUPABASE_URL = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
export const SUPABASE_ANON_KEY = (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();
/**
 * Dirección pública del sitio (enlaces de invitación y acceso). Si la variable
 * no es una URL válida (p. ej., se pegó otra clave por error), usa la URL que
 * Netlify asigna al sitio y, en local, localhost.
 */
function siteUrl(): string {
  for (const raw of [process.env.NEXT_PUBLIC_SITE_URL, process.env.URL]) {
    const v = (raw ?? "").trim().replace(/\/$/, "");
    if (/^https?:\/\/[a-z0-9.-]+(:\d+)?$/i.test(v)) return v;
  }
  return "http://localhost:3000";
}
export const SITE_URL = siteUrl();

export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el servidor");
  return key;
}

/** Acepta solo rutas internas (evita redirecciones abiertas). */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
