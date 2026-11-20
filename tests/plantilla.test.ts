import { describe, expect, it } from "vitest";
import { buildAssetTemplate, templateColumns } from "@/lib/asset-template";
import { buildXlsx, colName } from "@/lib/xlsx-writer";
import { detectMapping } from "@/lib/asset-import";

const input = {
  orgName: "Prueba",
  types: [{ code: "servidor", label: "Servidor", settings: { identifier: { kind: "serial", label: "Serial", required: true }, fields: ["name", "ip_address"] } }],
  classifications: ["Pública", "Uso Interno", "Confidencial"],
  scale: [1, 2, 3, 4, 5].map((level) => ({ dimension: "confidentiality" as const, level, label: `N${level}`, description: null })),
  people: [{ name: "Ana", email: "ana@x.co" }],
};

describe("plantilla de carga de activos", () => {
  it("empieza por el identificador y el tipo, y el importador reconoce todos sus encabezados", () => {
    const cols = templateColumns(input);
    expect(cols[0].header).toBe("Identificador único");
    expect(cols[1].header).toBe("Tipo de activo");
    expect(cols.map((c) => c.header)).toContain("Proceso");
    const mapping = detectMapping(cols.map((c) => c.header));
    expect(Object.values(mapping)).not.toContain("attributes");
  });

  it("incluye instrucciones, hoja de carga con listas y hoja de listas oculta", () => {
    const wb = buildAssetTemplate(input);
    expect(wb.sheets.map((s) => s.name)).toEqual(["Instrucciones", "Activos", "Listas"]);
    expect(wb.sheets[2].hidden).toBe(true);
    const v = wb.sheets[1].validations ?? [];
    expect(v.some((x) => x.formula1 === "TiposActivo")).toBe(true);
    expect(v.filter((x) => x.type === "whole" && x.formula2 === "5")).toHaveLength(3);
    expect(wb.definedNames?.TiposActivo).toBe("Listas!$A$2:$A$2");
    expect(v.some((x) => x.formula1 === "Procesos" && x.errorStyle === "warning")).toBe(true);
  });

  it("genera un archivo ZIP válido (firma PK y directorio central)", () => {
    const bytes = buildXlsx(buildAssetTemplate(input));
    expect([bytes[0], bytes[1], bytes[2], bytes[3]]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    const tail = bytes.slice(bytes.length - 22);
    expect([tail[0], tail[1], tail[2], tail[3]]).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("nombra columnas de Excel", () => {
    expect([colName(0), colName(25), colName(26), colName(701)]).toEqual(["A", "Z", "AA", "ZZ"]);
  });
});
