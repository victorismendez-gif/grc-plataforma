/** Política de contraseñas: 12+ caracteres con mayúscula, minúscula, número y símbolo. */
export function passwordProblem(password: string): string | null {
  if (password.length < 12) return "La contraseña debe tener al menos 12 caracteres.";
  if (password.length > 128) return "La contraseña es demasiado larga.";
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password)) return "Usa mayúsculas y minúsculas.";
  if (!/\d/.test(password)) return "Incluye al menos un número.";
  if (!/[^A-Za-z0-9]/.test(password)) return "Incluye al menos un símbolo.";
  return null;
}
