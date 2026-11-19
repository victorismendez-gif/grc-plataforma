"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

export default function NavLinks({ items }: { items: NavItem[] }) {
  const pathname = usePathname();
  return (
    <nav className="tabs" aria-label="Módulos">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link key={item.href} href={item.href} aria-current={active ? "page" : undefined}>
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
