// Catálogo de permisos. Debe coincidir con public.permissions (lo verifica
// tests/permissions.test.ts contra la migración).
export const PERMISSIONS = [
  "org.manage",
  "users.manage",
  "roles.manage",
  "audit_log.read",
  "assets.read",
  "assets.write",
  "frameworks.read",
  "frameworks.write",
  "controls.read",
  "controls.write",
  "documents.read",
  "documents.write",
  "documents.approve",
  "gap.read",
  "gap.write",
  "gap.validate",
  "plans.read",
  "plans.write",
  "risks.read",
  "risks.write",
  "risks.configure",
  "third_parties.read",
  "third_parties.write",
  "audits.read",
  "audits.write",
  "audits.lead",
  "findings.read",
  "findings.write",
  "findings.verify",
  "dashboard.read",
  "reports.read",
  "reports.export",
  "notifications.configure",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

export const SYSTEM_ROLE_CODES = ["administrador", "lider_sistema", "auditor", "responsable_area", "consulta"] as const;
