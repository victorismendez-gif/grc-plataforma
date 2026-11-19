import type { Metadata } from "next";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Flash, { type FlashParams } from "@/components/flash";
import { createRole, deleteRole, saveRolePermissions } from "./actions";

export const metadata: Metadata = { title: "Roles y permisos" };

type Perm = { code: string; module: string; description: string };
type Role = { id: string; code: string; name: string; description: string | null; is_system: boolean };

export default async function RolesPage({ searchParams }: { searchParams: FlashParams }) {
  await requirePermission("roles.manage");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: perms }, { data: roles }, { data: rolePerms }] = await Promise.all([
    supabase.from("permissions").select("code, module, description").order("sort_order"),
    supabase.from("roles").select("id, code, name, description, is_system").order("is_system", { ascending: false }).order("name"),
    supabase.from("role_permissions").select("role_id, permission_code"),
  ]);
  const permList = (perms ?? []) as Perm[];
  const roleList = (roles ?? []) as Role[];
  const granted = new Set((rolePerms ?? []).map((rp) => `${rp.role_id}:${rp.permission_code}`));
  const modules = [...new Set(permList.map((p) => p.module))];

  return (
    <>
      <div className="head">
        <h1>Roles y permisos</h1>
        <p className="lead">
          Los cinco roles base vienen precargados y se pueden ajustar, salvo el de administrador. Crea roles propios
          para necesidades específicas. Los permisos se aplican en el servidor y en la base de datos.
        </p>
      </div>
      <Flash {...sp} />

      <section className="panel">
        <h2>Nuevo rol</h2>
        <form action={createRole} className="row">
          <label>
            Nombre
            <input name="name" required minLength={2} maxLength={80} />
          </label>
          <label style={{ flex: 1, minWidth: 240 }}>
            Descripción
            <input name="description" maxLength={300} />
          </label>
          <button type="submit">Crear rol</button>
        </form>
      </section>

      {roleList.map((role) => {
        const locked = role.is_system && role.code === "administrador";
        return (
          <section key={role.id} className="panel">
            <details>
              <summary>
                {role.name} {role.is_system && <span className="tag warn">base</span>}{" "}
                <span className="small muted">
                  {permList.filter((p) => granted.has(`${role.id}:${p.code}`)).length} de {permList.length} permisos
                </span>
              </summary>
              {role.description && <p className="small muted" style={{ marginTop: 8 }}>{role.description}</p>}
              <form action={saveRolePermissions} className="stack" style={{ marginTop: 12 }}>
                <input type="hidden" name="role_id" value={role.id} />
                <div className="grid2">
                  {modules.map((m) => (
                    <fieldset key={m} disabled={locked} style={{ border: "1px solid var(--line)", borderRadius: 6 }}>
                      <legend className="small"><b>{m}</b></legend>
                      {permList
                        .filter((p) => p.module === m)
                        .map((p) => (
                          <label key={p.code} className="check">
                            <input
                              type="checkbox"
                              name="perm"
                              value={p.code}
                              defaultChecked={granted.has(`${role.id}:${p.code}`)}
                            />
                            <span>
                              {p.description} <span className="mono muted">{p.code}</span>
                            </span>
                          </label>
                        ))}
                    </fieldset>
                  ))}
                </div>
                {!locked && <button type="submit">Guardar permisos</button>}
              </form>
              {!role.is_system && (
                <form action={deleteRole} style={{ marginTop: 8 }}>
                  <input type="hidden" name="role_id" value={role.id} />
                  <button type="submit" className="danger">Eliminar rol</button>
                </form>
              )}
            </details>
          </section>
        );
      })}
    </>
  );
}
