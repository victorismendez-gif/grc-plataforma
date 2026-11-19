import { requireContext } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

export default async function HomePage() {
  const ctx = await requireContext();
  const supabase = await createClient();
  const { data: myRoles } = await supabase
    .from("user_roles")
    .select("role:roles(name)")
    .eq("user_id", ctx.userId);
  const roleNames = (myRoles ?? [])
    .map((r) => (r.role as unknown as { name: string } | null)?.name)
    .filter(Boolean) as string[];

  return (
    <>
      <div className="head">
        <h1>Hola, {ctx.fullName}</h1>
        <p className="lead">
          Ingresaste con doble factor a {ctx.organization.name}. Tus roles:{" "}
          {roleNames.length ? roleNames.join(", ") : "ninguno asignado todavía"}.
        </p>
      </div>
      <div className="kpis">
        <div className="kpi">
          <b>{ctx.permissions.size}</b>
          <small>permisos efectivos</small>
        </div>
        <div className="kpi">
          <b>{roleNames.length}</b>
          <small>roles asignados</small>
        </div>
      </div>
      <section className="panel">
        <h2>Estado de la plataforma</h2>
        <p className="muted small">
          Fase 1 activa: ingreso con doble factor, usuarios, roles y permisos verificados en el servidor y en la base,
          y registro de auditoría inalterable. Los módulos de activos, normas, GAP, riesgos, terceros, auditoría y
          tableros se habilitan en las siguientes fases.
        </p>
      </section>
    </>
  );
}
