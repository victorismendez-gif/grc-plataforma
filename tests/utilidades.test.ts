import { describe, expect, it } from "vitest";
import { csvCell, describeChange, parseAuditFilters, toCsv, type AuditRow } from "@/lib/audit";
import { safeNext } from "@/lib/env";
import { passwordProblem } from "@/lib/password";

describe("safeNext (evita redirecciones abiertas)", () => {
  it("acepta rutas internas", () => {
    expect(safeNext("/admin/usuarios")).toBe("/admin/usuarios");
  });
  it.each(["https://malo.com", "//malo.com", "/\\malo.com", "", null, undefined])("rechaza %s", (v) => {
    expect(safeNext(v as string)).toBe("/");
  });
});

describe("política de contraseñas", () => {
  it("rechaza contraseñas débiles", () => {
    expect(passwordProblem("corta")).not.toBeNull();
    expect(passwordProblem("todasminusculas123!")).not.toBeNull();
    expect(passwordProblem("SinNumerosNiSimbolos")).not.toBeNull();
  });
  it("acepta una contraseña robusta", () => {
    expect(passwordProblem("Gestion-Riesgos-2026")).toBeNull();
  });
});

describe("exportación CSV", () => {
  it("escapa comillas, comas y saltos de línea", () => {
    expect(csvCell('a,"b"\nc')).toBe('"a,""b""\nc"');
  });
  it("neutraliza fórmulas (inyección CSV)", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
  });
  it("serializa objetos como JSON", () => {
    expect(csvCell({ a: 1 })).toBe('"{""a"":1}"');
  });
  it("incluye BOM y encabezado", () => {
    const csv = toCsv([]);
    expect(csv.startsWith("﻿id,fecha_utc")).toBe(true);
  });
});

describe("filtros de trazabilidad", () => {
  it("descarta valores no válidos", () => {
    expect(parseAuditFilters({ tabla: "roles; drop", accion: "insert", desde: "2026-13", hasta: "2026-11-19" })).toEqual({
      accion: "INSERT",
      hasta: "2026-11-19",
    });
  });
});

describe("resumen de cambios", () => {
  it("muestra campo, valor anterior y nuevo", () => {
    const row: AuditRow = {
      id: 1,
      occurred_at: "2026-11-19T00:00:00Z",
      actor_email: "a@b.co",
      action: "UPDATE",
      table_name: "profiles",
      record_id: "x",
      changed_fields: ["active", "updated_at"],
      old_data: { active: true },
      new_data: { active: false },
      hash: "h",
    };
    expect(describeChange(row)).toBe("active: true → false");
  });
});
