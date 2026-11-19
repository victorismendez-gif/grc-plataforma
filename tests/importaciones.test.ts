import { describe, expect, it } from "vitest";
import { detectMapping, mapAssetRows, type Lookups } from "@/lib/asset-import";
import { mapRequirementRows } from "@/lib/requirements-import";
import { ISO27001_TEMPLATE } from "@/lib/templates/iso27001";

const lookups: Lookups = {
  assetTypes: [
    { id: "t-port", code: "portatil", label: "Computador portátil" },
    { id: "t-tab", code: "tableta", label: "Tableta" },
    { id: "t-otro", code: "otro", label: "Otro" },
  ],
  classifications: [
    { id: "c-pub", code: "publica", label: "Pública" },
    { id: "c-int", code: "uso_interno", label: "Uso interno" },
    { id: "c-conf", code: "confidencial", label: "Confidencial" },
  ],
  units: [{ id: "u-ti", code: "TI", name: "Tecnología" }],
  profiles: [{ id: "p-1", email: "ana@empresa.co", name: "Ana Ruiz" }],
};

describe("importación de activos", () => {
  it("reconoce encabezados en español con tildes y mayúsculas", () => {
    const m = detectMapping(["Código", "Nombre del activo", "Clasificación", "Disponibilidad", "Color"]);
    expect(m).toEqual({
      "Código": "code",
      "Nombre del activo": "name",
      "Clasificación": "classification_id",
      Disponibilidad: "availability",
      Color: "attributes",
    });
  });

  it("traduce catálogos, niveles, estados, fechas y columnas adicionales", () => {
    const res = mapAssetRows(
      [
        {
          Placa: "PC-01",
          Nombre: "Portátil gerencia",
          Tipo: "Computador Portátil",
          Clasificación: "uso interno",
          Confidencialidad: "Alto",
          Integridad: 2,
          Disponibilidad: "bajo",
          Estado: "En reparación",
          Responsable: "ANA@empresa.co",
          Área: "Tecnología",
          "Fecha de compra": "15/03/2024",
          Color: "Gris",
        },
      ],
      lookups,
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({
      code: "PC-01",
      asset_type_id: "t-port",
      classification_id: "c-int",
      confidentiality: 3,
      integrity: 2,
      availability: 1,
      status: "en_reparacion",
      owner_id: "p-1",
      unit_id: "u-ti",
      acquired_on: "2024-03-15",
      attributes: { Color: "Gris" },
    });
    expect(res.fields).toContain("attributes");
    expect(res.fields).not.toContain("code");
  });

  it("usa «Otro» para tipos desconocidos y avisa", () => {
    const res = mapAssetRows([{ Código: "X1", Tipo: "Impresora 3D" }], lookups);
    expect(res.rows[0].asset_type_id).toBe("t-otro");
    expect(res.rows[0].attributes).toEqual({ "Tipo original": "Impresora 3D" });
    expect(res.warnings[0]).toMatch(/Impresora 3D/);
  });

  it("reporta niveles inválidos, códigos faltantes y repetidos", () => {
    const res = mapAssetRows(
      [
        { Código: "A", Confidencialidad: "muy alto" },
        { Código: "", Nombre: "Sin código" },
        { Código: "B" },
        { Código: "B" },
        { Código: "", Nombre: "" },
      ],
      lookups,
    );
    expect(res.errors.join(" ")).toMatch(/Fila 2: «muy alto»/);
    expect(res.errors.join(" ")).toMatch(/Fila 3: falta el código/);
    expect(res.errors.join(" ")).toMatch(/repetidos en el archivo: B/);
    expect(res.errors.join(" ")).not.toMatch(/Fila 6/);
  });

  it("exige la columna de código", () => {
    expect(mapAssetRows([{ Nombre: "x" }], lookups).errors[0]).toMatch(/código del activo/);
  });
});

describe("importación de requisitos", () => {
  it("lee cláusula, título y criticidad", () => {
    const { rows, errors } = mapRequirementRows([
      { Cláusula: "4.1.", Título: "Contexto", Criticidad: "Alta" },
      { Cláusula: "", Título: "" },
      { Cláusula: "4.2", Título: "Partes", Auditable: "No" },
    ]);
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { clause: "4.1", title: "Contexto", description: null, evidence_guidance: null, criticality: 3, is_auditable: true },
      { clause: "4.2", title: "Partes", description: null, evidence_guidance: null, criticality: 2, is_auditable: false },
    ]);
  });
});

describe("plantilla ISO/IEC 27001:2022", () => {
  it("tiene los 93 controles del Anexo A sin repetir cláusulas", () => {
    const controls = ISO27001_TEMPLATE.rows.filter((r) => /^A\.\d+\.\d+$/.test(r.clause));
    expect(controls).toHaveLength(93);
    const byTheme = (t: string) => controls.filter((r) => r.clause.startsWith(`A.${t}.`)).length;
    expect([byTheme("5"), byTheme("6"), byTheme("7"), byTheme("8")]).toEqual([37, 8, 14, 34]);
    const clauses = ISO27001_TEMPLATE.rows.map((r) => r.clause);
    expect(new Set(clauses).size).toBe(clauses.length);
  });
});
