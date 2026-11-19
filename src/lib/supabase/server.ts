import "server-only";
import { createServerClient } from "@supabase/ssr";
import { createClient as createJsClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { SUPABASE_ANON_KEY, SUPABASE_URL, serviceRoleKey } from "@/lib/env";

/** Cliente con la sesión del usuario: todo pasa por la seguridad a nivel de fila. */
export async function createClient() {
  const cookieStore = await cookies();
  return createServerClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Llamado desde un Server Component: el proxy refresca la sesión.
        }
      },
    },
  });
}

/**
 * Cliente con la llave de servicio. Solo para operaciones de Auth que la
 * base no permite (invitar, bloquear, restablecer doble factor), siempre
 * después de verificar el permiso del usuario en el servidor.
 */
export function createAdminClient() {
  return createJsClient(SUPABASE_URL, serviceRoleKey(), {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
