import { describe, expect, it } from "vitest";
import { detectControlMapping, mapControlRows } from "@/lib/control-import";
import { CONTROL_FIELDS, defaultEffectiveness } from "@/lib/control-fields";
import { buildControlTemplate } from "@/lib/control-template";

const people = [{ id: "p1", email: "ana@empresa.co", name: "Ana Ruiz" }];

describe("campos de controles", () => {
  it("siguen el orden solicitado", () => {
    expect(CONTROL_FIELDS.map((d) => d.header)).toEqual([
      "ID", "Control", "Descripción", "Responsable", "Tipo", "Clase", "Periodicidad",
      "Documentación", "Evidencia", "Diseño", "Aplicación", "Efectividad", "Estado",
    ]);
  });
  it("la plantilla usa los mismos encabezados y el importador los reconoce todos", () => {
    const wb = buildControlTemplate({ orgName: "X", people: [] });
    const headers = (wb.sheets[1].rows[0] as { v: string }[]).map((c) => c.v);
    expect(headers).toEqual(CONTROL_FIELDS.map((d) => d.header));
    expect(Object.values(detectControlMapping(headers))).not.toContain("ignorada");
  });
  it("la efectividad por defecto es el menor entre diseño y aplicación", () => {
    expect(defaultEffectiveness(3, 2, null)).toBe(2);
    expect(defaultEffectiveness(3, 2, 3)).toBe(3);
    expect(defaultEffectiveness(3, null, null)).toBeNull();
  });
});

describe("importación de controles", () => {
  it("traduce valores por etiqueta o número y enlaza al responsable", () => {
    const { rows, errors } = mapControlRows(
      [{ ID: "CTL-01", Control: "Copias", Responsable: "ANA@empresa.co", Tipo: "preventivo", Clase: "Automático",
         Periodicidad: "Diario", Documentación: "Documentado", Evidencia: "Con registro", Diseño: "Fuerte", Aplicación: 2, Estado: "Implementado" }],
      people,
    );
    expect(errors).toEqual([]);
    expect(rows[0]).toMatchObject({
      code: "CTL-01", owner_id: "p1", owner_text: null, control_type: "preventivo", nature: "automatico", frequency: "diario",
      documentation: "documentado", evidence: "con_registro", design_rating: 3, application_rating: 2, effectiveness_rating: 2,
      implementation_status: "implementado",
    });
  });
  it("guarda como texto al responsable que no es usuario", () => {
    const { rows, warnings } = mapControlRows([{ ID: "C1", Control: "Ctl", Responsable: "Mesa de ayuda" }], people);
    expect(rows[0]).toMatchObject({ owner_id: null, owner_text: "Mesa de ayuda" });
    expect(warnings[0]).toMatch(/Mesa de ayuda/);
  });
  it("reporta valores inválidos, ID con espacios, repetidos y columnas faltantes", () => {
    const r = mapControlRows(
      [
        { ID: "CTL 02", Control: "x", Tipo: "Rápido" },
        { ID: "A", Control: "Uno" },
        { ID: "A", Control: "Dos" },
      ],
      people,
    );
    const e = r.errors.join(" ");
    expect(e).toMatch(/«CTL 02» solo admite/);
    expect(e).toMatch(/falta el nombre del control/);
    expect(e).toMatch(/«Rápido» no es un valor válido de Tipo/);
    expect(e).toMatch(/ID repetidos en el archivo: A/);
    expect(mapControlRows([{ Nombre: "x" }], people).errors[0]).toMatch(/columna «ID»/);
  });
});
