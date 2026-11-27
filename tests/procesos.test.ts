import { describe, expect, it } from "vitest";
import { detectMasterColumns, mapMasterRows, parseDate } from "@/lib/process-master";

const H = {
  Código: "", Versión: "", Nombre: "", Tipología: "", "Jerarquía Documental": "", "Código documento padre": "",
  "Responsable del documento": "", "Área Líder": "", Estado: "", Elaborador: "", Vigencia: "",
};

describe("listado maestro de procesos", () => {
  it("reconoce las columnas del archivo de la organización", () => {
    const cols = detectMasterColumns(Object.keys(H));
    expect(Object.values(cols).sort()).toEqual(["area", "code", "name", "owner", "parent", "status", "typology", "valid_from", "version"].sort());
  });

  it("deja solo lo vigente, una fila por código y la versión más alta", () => {
    const res = mapMasterRows([
      { ...H, Código: "PROC-GSI-004", Versión: 1, Nombre: "Gestión de seguridad IT", Tipología: "Proceso", Estado: "OBSOLETO" },
      { ...H, Código: "PROC-GSI-004", Versión: 2, Nombre: "Gestión de solicitudes de seguridad ", Tipología: "Proceso", Estado: "VIGENTE", "Área Líder": "DIRECCIÓN IT", Vigencia: "2024-10-22" },
      { ...H, Código: "A- SUBP-LOGT-013-01", Versión: 1, Nombre: "Speech", Tipología: "Anexo", "Código documento padre": "PROC-LOGT-013", Estado: "VIGENTE" },
      { ...H, Código: "F-X-1", Versión: "1.1", Nombre: "Formato viejo", Tipología: "Formato", Estado: "VIGENTE" },
      { ...H, Código: "F-X-1", Versión: "1.2", Nombre: "Formato nuevo", Tipología: "Formato", Estado: "VIGENTE" },
      { ...H, Código: "SIN-1", Nombre: "Sin estado", Tipología: "Formato", Estado: null },
    ]);
    expect(res.errors).toEqual([]);
    expect(res.skipped).toBe(2);
    expect(res.rows.map((r) => r.code)).toEqual(["PROC-GSI-004", "A-SUBP-LOGT-013-01", "F-X-1"]);
    expect(res.rows[0]).toMatchObject({ name: "Gestión de solicitudes de seguridad", version: "2", area: "DIRECCIÓN IT", valid_from: "2024-10-22" });
    expect(res.rows[1].parent).toBe("PROC-LOGT-013");
    expect(res.rows[2].name).toBe("Formato nuevo");
    expect(res.warnings[0]).toMatch(/F-X-1 aparece varias veces/);
  });

  it("exige código, nombre y tipología", () => {
    expect(mapMasterRows([{ Código: "X", Nombre: "Y" }]).errors).toEqual(["Falta la columna «Tipología»."]);
  });

  it("lee fechas en varios formatos", () => {
    expect(parseDate("22/10/2024")).toBe("2024-10-22");
    expect(parseDate(45587)).toBe("2024-10-22");
    expect(parseDate("")).toBeUndefined();
  });
});
