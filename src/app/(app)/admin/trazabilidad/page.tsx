import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { describeChange, parseAuditFilters } from "@/lib/audit";
import { queryAudit } from "@/lib/audit-query";

export const metadata: Metadata = { title: "Trazabilidad" };

const PAGE_SIZE = 50;
const TABLES = ["organizations", "profiles", "roles", "role_permissions", "user_roles", "evento"];
const ACTIONS = ["INSERT", "UPDATE", "DELETE", "LOGIN", "LOGOUT", "MFA_ENROLLED", "MFA_VERIFIED", "MFA_RESET", "PASSWORD_CHANGED", "EXPORT"];

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function AuditPage({ searchParams }: Props) {
  await requirePermission("audit_log.read");
  const sp = await searchParams;
  const filters = parseAuditFilters(sp);
  const page = Math.max(1, Number.parseInt(String(sp.pagina ?? "1"), 10) || 1);
  const { rows, count } = await queryAudit(filters, (page - 1) * PAGE_SIZE, PAGE_SIZE);
  const pages = Math.max(1, Math.ceil(count / PAGE_SIZE));

  let chain: { checked: number; broken: number | null } | null = null;
  if (sp.verificar === "1") {
    const supabase = await createClient();
    const { data } = await supabase.rpc("verify_audit_chain");
    const r = (data as { checked: number; first_broken_id: number | null }[] | null)?.[0];
    if (r) chain = { checked: r.checked, broken: r.first_broken_id };
  }

  const qs = new URLSearchParams(Object.entries(filters).filter(([, v]) => v) as [string, string][]);
  const pageLink = (p: number) => `?${new URLSearchParams({ ...Object.fromEntries(qs), pagina: String(p) })}`;

  return (
    <>
      <div className="head">
        <h1>Trazabilidad</h1>
        <p className="lead">
          Registro inalterable de quién hizo qué y cuándo, con el valor anterior y el nuevo. Cada fila se encadena con
          la anterior mediante un hash SHA-256: si alguien la alterara, la verificación lo detecta.
        </p>
      </div>

      <section className="panel">
        <form className="row" method="get">
          <label>
            Tabla
            <select name="tabla" defaultValue={filters.tabla ?? ""}>
              <option value="">Todas</option>
              {TABLES.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </label>
          <label>
            Acción
            <select name="accion" defaultValue={filters.accion ?? ""}>
              <option value="">Todas</option>
              {ACTIONS.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
          </label>
          <label>
            Usuario
            <input name="usuario" defaultValue={filters.usuario ?? ""} placeholder="correo" />
          </label>
          <label>
            Desde
            <input type="date" name="desde" defaultValue={filters.desde ?? ""} />
          </label>
          <label>
            Hasta
            <input type="date" name="hasta" defaultValue={filters.hasta ?? ""} />
          </label>
          <button type="submit">Filtrar</button>
          <a className="btn ghost" href={`/admin/trazabilidad/exportar?${qs}`}>Exportar CSV</a>
          <Link className="btn ghost" href={`?${new URLSearchParams({ ...Object.fromEntries(qs), verificar: "1" })}`}>
            Verificar integridad
          </Link>
        </form>
        {chain &&
          (chain.broken === null ? (
            <div className="alert ok">Cadena íntegra: {chain.checked} registros verificados.</div>
          ) : (
            <div className="alert error">
              Alerta: la cadena se rompe en el registro {chain.broken}. Reporta este hallazgo de seguridad.
            </div>
          ))}
      </section>

      <section className="panel">
        <h2>{count} registros</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Usuario</th>
                <th>Acción</th>
                <th>Tabla · registro</th>
                <th>Cambio</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="mono">{new Date(r.occurred_at).toLocaleString("es-CO", { timeZone: "America/Bogota" })}</td>
                  <td className="small">{r.actor_email ?? "sistema"}</td>
                  <td><span className="tag warn">{r.action}</span></td>
                  <td className="small">
                    {r.table_name}
                    <div className="mono muted">{r.record_id?.slice(0, 18)}</div>
                  </td>
                  <td><pre className="diff">{describeChange(r)}</pre></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row small">
          {page > 1 && <Link href={pageLink(page - 1)}>← Anterior</Link>}
          <span className="muted">Página {page} de {pages}</span>
          {page < pages && <Link href={pageLink(page + 1)}>Siguiente →</Link>}
        </div>
      </section>
    </>
  );
}
