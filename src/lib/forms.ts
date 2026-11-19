import { redirect } from "next/navigation";

/** Redirige con un mensaje de error visible en la página. */
export function fail(path: string, message: string): never {
  redirect(`${path}?error=${encodeURIComponent(message)}`);
}

/** Redirige con un mensaje de confirmación. */
export function done(path: string, message: string): never {
  redirect(`${path}?ok=${encodeURIComponent(message)}`);
}

export function str(formData: FormData, key: string): string {
  return (formData.get(key)?.toString() ?? "").trim();
}

/** Traduce errores de la base a mensajes comprensibles. */
export function dbMessage(error: { code?: string; message?: string } | null | undefined, fallback: string): string {
  if (!error) return fallback;
  if (error.code === "42501") return error.message?.startsWith("new row violates") ? "No tienes permiso para esta operación." : (error.message ?? fallback);
  if (error.code === "23505") return "Ya existe un registro con ese código o nombre.";
  if (error.code === "23514") return "Algún dato no cumple el formato esperado.";
  return fallback;
}
