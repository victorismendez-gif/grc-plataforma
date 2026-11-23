import { describe, expect, it } from "vitest";
import { compliance, groupBy, parseGapStatus, planKpis } from "@/lib/gap";

describe("cumplimiento del GAP", () => {
  it("aplica la fórmula (cumple + 0,5 × parcial) ÷ aplicables", () => {
    const c = compliance(["cumple", "parcial", "no_cumple", "no_aplica", null]);
    expect(c).toMatchObject({ total: 5, aplicables: 3, pendientes: 1, noAplica: 1 });
    expect(c.pct).toBe(50);
  });
  it("usa el peso configurable del cumplimiento parcial", () => {
    expect(compliance(["parcial", "cumple"], 0.25).pct).toBe(62.5);
  });
  it("sin requisitos aplicables no calcula porcentaje", () => {
    expect(compliance(["no_aplica", null]).pct).toBeNull();
  });
  it("agrupa conservando el orden", () => {
    expect(groupBy([{ k: "b" }, { k: "a" }, { k: "b" }], (x) => x.k).map(([k, v]) => `${k}${v.length}`)).toEqual(["b2", "a1"]);
  });
  it("interpreta los estados escritos en Excel", () => {
    expect(parseGapStatus("Cumple parcial")).toBe("parcial");
    expect(parseGapStatus("NO CUMPLE")).toBe("no_cumple");
    expect(parseGapStatus("N/A")).toBe("no_aplica");
    expect(parseGapStatus("")).toBe("");
    expect(parseGapStatus("quizás")).toBeUndefined();
  });
});

describe("KPIs del plan de trabajo", () => {
  it("calcula avance a la fecha y vencidas", () => {
    const k = planKpis(
      [
        { status: "terminada", due_on: "2026-01-10" },
        { status: "pendiente", due_on: "2026-01-15" },
        { status: "en_curso", due_on: "2026-12-31", progress: 50 },
        { status: "cancelada", due_on: "2026-01-01" },
      ],
      "2026-02-01",
    );
    expect(k).toMatchObject({ total: 3, terminadas: 1, abiertas: 2, vencidas: 1, avanceFecha: 50, pctVencidas: 50, avance: 50 });
  });
});

import { buildGapWorkbook, mapGapRows } from "@/lib/gap-sheet";
import { buildXlsx } from "@/lib/xlsx-writer";

describe("Excel del GAP", () => {
  it("lee la hoja de calificación y omite filas sin estado", () => {
    const { rows, errors } = mapGapRows([
      { Norma: "ISO27001", "Cláusula": "4.1", Estado: "Cumple", "Evidencia": "Acta" },
      { Norma: "ISO27001", "Cláusula": "4.2", Estado: "" },
      { Norma: "ISO27001", "Cláusula": "5.1", Estado: "tal vez" },
    ]);
    expect(rows).toEqual([{ line: 2, framework: "ISO27001", clause: "4.1", status: "cumple", justification: "", evidence_note: "Acta" }]);
    expect(errors[0]).toMatch(/Fila 4/);
  });
  it("exige las columnas Cláusula y Estado", () => {
    expect(mapGapRows([{ Requisito: "x" }]).errors).toHaveLength(2);
  });
  it("genera el libro con resumen, calificación e instrucciones", () => {
    const wb = buildGapWorkbook({
      orgName: "Org", code: "GAP-2026-01", name: "Inicial", scope: null, partialWeight: 0.5,
      items: [{ framework: "ISO27001", frameworkName: "ISO/IEC 27001", clause: "4.1", title: "Contexto", topClause: "4", topTitle: "Contexto",
        criticality: 3, status: "parcial", justification: "Falta", evidence: "Acta", commonWith: null, validated: false }],
    });
    expect(wb.sheets.map((s) => s.name)).toEqual(["Resumen", "Calificación", "Instrucciones"]);
    expect(buildXlsx(wb).length).toBeGreaterThan(1000);
  });
});
