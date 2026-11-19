"use server";
import { requireContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { done, fail, str } from "@/lib/forms";
import { passwordProblem } from "@/lib/password";

const PATH = "/cuenta/clave";

export async function changePassword(formData: FormData) {
  await requireContext();
  const password = str(formData, "password");
  const confirm = str(formData, "confirm");
  if (password !== confirm) fail(PATH, "Las contraseñas no coinciden.");
  const problem = passwordProblem(password);
  if (problem) fail(PATH, problem);

  const supabase = await createClient();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) fail(PATH, "No se pudo cambiar la contraseña. Usa una distinta a la anterior.");
  await supabase.rpc("log_event", { p_action: "PASSWORD_CHANGED", p_detail: {} });
  done(PATH, "Contraseña actualizada.");
}
