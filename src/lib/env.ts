// Variables de entorno. Las públicas se insertan en el navegador al compilar.
export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000").replace(/\/$/, "");

export function serviceRoleKey(): string {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new Error("Falta SUPABASE_SERVICE_ROLE_KEY en el servidor");
  return key;
}

/** Acepta solo rutas internas (evita redirecciones abiertas). */
export function safeNext(value: string | null | undefined, fallback = "/"): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || value.startsWith("/\\")) return fallback;
  return value;
}
