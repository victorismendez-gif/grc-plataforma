import { requireContext } from "@/lib/auth";
import NavLinks, { type NavItem } from "@/components/nav-links";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireContext();
  const org = ctx.organization;

  const items: NavItem[] = [{ href: "/", label: "Inicio" }];
  if (ctx.can("assets.read")) items.push({ href: "/activos", label: "Activos" }, { href: "/estructura", label: "Estructura" });
  if (ctx.can("assets.self") && !ctx.can("assets.write")) items.push({ href: "/mis-equipos", label: "Mis equipos" });
  if (ctx.can("frameworks.read")) items.push({ href: "/normas", label: "Normas" });
  if (ctx.can("controls.read")) items.push({ href: "/controles", label: "Controles" });
  if (ctx.can("documents.read")) items.push({ href: "/documentos", label: "Documentos" }, { href: "/politicas", label: "Políticas" });
  if (ctx.can("users.manage")) items.push({ href: "/admin/usuarios", label: "Usuarios" });
  if (ctx.can("roles.manage")) items.push({ href: "/admin/roles", label: "Roles y permisos" });
  if (ctx.can("audit_log.read")) items.push({ href: "/admin/trazabilidad", label: "Trazabilidad" });
  if (ctx.can("org.manage")) items.push({ href: "/admin/organizacion", label: "Organización" });

  const initials = org.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();

  return (
    <div className="wrap" style={{ "--brand": org.brand_color } as React.CSSProperties}>
      <header className="topbar">
        <div className="who">
          <div className="logo" aria-hidden="true">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {org.logo_url ? <img src={org.logo_url} alt="" /> : initials}
          </div>
          <div>
            <b>{org.name}</b>
            <span className="muted small">Plataforma GRC</span>
          </div>
        </div>
        <div className="userbox">
          <a href="/cuenta/clave">{ctx.fullName}</a>
          <form action="/auth/salir" method="post">
            <button type="submit" className="ghost">Salir</button>
          </form>
        </div>
      </header>
      <NavLinks items={items} />
      <main>{children}</main>
    </div>
  );
}
