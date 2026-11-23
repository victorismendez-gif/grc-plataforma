import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Flash, { type FlashParams } from "@/components/flash";
import { assignRole, inviteUser, removeRole, resetMfa, setActive } from "./actions";
import AccessLinkButton from "./access-link";

export const metadata: Metadata = { title: "Usuarios" };

type Role = { id: string; name: string; code: string };
type UserRow = {
  id: string;
  email: string;
  full_name: string;
  job_title: string | null;
  active: boolean;
  user_roles: { id: string; role: Role | null }[];
};

export default async function UsersPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("users.manage");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: users }, { data: roles }] = await Promise.all([
    supabase
      .from("profiles")
      .select("id, email, full_name, job_title, active, user_roles(id, role:roles(id, name, code))")
      .order("full_name"),
    supabase.from("roles").select("id, name, code").order("is_system", { ascending: false }).order("name"),
  ]);
  const rows = (users ?? []) as unknown as UserRow[];
  const roleList = (roles ?? []) as Role[];

  return (
    <>
      <div className="head">
        <h1>Usuarios</h1>
        <p className="lead">
          Invita personas por correo, asigna sus roles y desactiva el acceso cuando dejen la organización. Todo cambio
          queda en la trazabilidad.
        </p>
      </div>
      <Flash {...sp} />

      <section className="panel">
        <h2>Invitar usuario</h2>
        <form action={inviteUser} className="row">
          <label>
            Correo
            <input name="email" type="email" required />
          </label>
          <label>
            Nombre completo
            <input name="full_name" required minLength={2} />
          </label>
          <label>
            Cargo
            <input name="job_title" />
          </label>
          <label>
            Rol inicial
            <select name="role_id" required defaultValue="">
              <option value="" disabled>Selecciona…</option>
              {roleList.map((r) => (
                <option key={r.id} value={r.id}>{r.name}</option>
              ))}
            </select>
          </label>
          <button type="submit">Enviar invitación</button>
        </form>
        <p className="small muted">
          La persona recibe un enlace, configura el doble factor y luego define su contraseña. Si el enlace del correo le
          aparece vencido (algunos antivirus corporativos lo abren antes), usa «Enlace de acceso» en su fila y envíaselo
          por WhatsApp, Teams o en persona.
        </p>
      </section>

      <section className="panel">
        <h2>{rows.length} usuarios</h2>
        <div className="tablewrap">
          <table>
            <thead>
              <tr>
                <th>Nombre</th>
                <th>Roles</th>
                <th>Estado</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((u) => {
                const assigned = new Set(u.user_roles.map((ur) => ur.role?.id));
                const available = roleList.filter((r) => !assigned.has(r.id));
                return (
                  <tr key={u.id}>
                    <td>
                      <b>{u.full_name || "—"}</b>
                      <div className="small muted">{u.email}{u.job_title ? ` · ${u.job_title}` : ""}</div>
                    </td>
                    <td>
                      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                        {u.user_roles.map((ur) => (
                          <form key={ur.id} action={removeRole} className="inline">
                            <input type="hidden" name="user_role_id" value={ur.id} />
                            <span className="chip">
                              {ur.role?.name}
                              <button type="submit" className="link" aria-label={`Quitar ${ur.role?.name}`}>×</button>
                            </span>
                          </form>
                        ))}
                      </div>
                      {available.length > 0 && (
                        <form action={assignRole} className="inline" style={{ marginTop: 6 }}>
                          <input type="hidden" name="user_id" value={u.id} />
                          <select name="role_id" defaultValue="" required aria-label="Rol a asignar">
                            <option value="" disabled>Agregar rol…</option>
                            {available.map((r) => (
                              <option key={r.id} value={r.id}>{r.name}</option>
                            ))}
                          </select>
                          <button type="submit" className="ghost">Asignar</button>
                        </form>
                      )}
                    </td>
                    <td>
                      <span className={`tag ${u.active ? "good" : "crit"}`}>{u.active ? "Activo" : "Inactivo"}</span>
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                        {u.id !== ctx.userId && (
                          <form action={setActive}>
                            <input type="hidden" name="user_id" value={u.id} />
                            <input type="hidden" name="active" value={String(!u.active)} />
                            <button type="submit" className={u.active ? "danger" : "ghost"}>
                              {u.active ? "Desactivar" : "Activar"}
                            </button>
                          </form>
                        )}
                        {u.active && u.id !== ctx.userId && <AccessLinkButton userId={u.id} />}
                        <form action={resetMfa}>
                          <input type="hidden" name="user_id" value={u.id} />
                          <button type="submit" className="ghost">Restablecer doble factor</button>
                        </form>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
