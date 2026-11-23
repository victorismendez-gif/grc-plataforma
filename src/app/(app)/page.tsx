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
      {ctx.can("assets.self") && !ctx.can("assets.write") && (
        <section className="panel">
          <h2>Mis equipos</h2>
          <p className="small">
            Revisa los computadores, tabletas y celulares que tienes asignados y mantén sus datos al día.{" "}
            <a href="/mis-equipos">Ir a Mis equipos →</a>
          </p>
        </section>
      )}
      <section className="panel">
        <h2>Estado de la plataforma</h2>
        <p className="muted small">
          Disponibles: activos de información con importación mensual, estructura de la organización, normas y
          requisitos, controles, documentos con flujo de aprobación y políticas. Próximamente: diagnóstico GAP y plan de
          trabajo, riesgos, terceros, auditoría y tableros.
        </p>
      </section>
    </>
  );
}
