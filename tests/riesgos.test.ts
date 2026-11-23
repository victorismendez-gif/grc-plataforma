import { describe, expect, it } from "vitest";
import { heatMap, parseControlCodes, parseLevel, parseStrategy, riskKpis, score, zoneFor, type Methodology } from "@/lib/risk";
import { buildRiskWorkbook, detectRiskColumns, mapRiskRows } from "@/lib/risk-sheet";
import { buildXlsx } from "@/lib/xlsx-writer";

const lv = (n: number) => Array.from({ length: n }, (_, k) => ({ level: k + 1, name: ["Rara vez", "Improbable", "Posible", "Probable", "Casi seguro"][k] }));
const M: Methodology = {
  id: "m", version: 1, probability_levels: lv(5), impact_levels: lv(5), formula: "producto",
  zones: [{ name: "Bajo", color: "#2E8B57", min: 1 }, { name: "Moderado", color: "#D4A017", min: 5 }, { name: "Alto", color: "#E07B00", min: 10 }, { name: "Extremo", color: "#B3312E", min: 17 }],
  appetite: 4, tolerance: 9, control_reduction: { "1": 0.1, "2": 0.25, "3": 0.5 },
};

describe("metodología", () => {
  it("calcula nivel y zona", () => {
    expect(score(M, 4, 5)).toBe(20);
    expect(zoneFor(M.zones, 20).name).toBe("Extremo");
    expect(zoneFor(M.zones, 9).name).toBe("Moderado");
    expect(score({ formula: "suma" }, 4, 5)).toBe(9);
  });
  it("arma el mapa de calor con la probabilidad mayor arriba", () => {
    const hm = heatMap(M, [{ p: 5, i: 5 }, { p: 5, i: 5 }, { p: 1, i: 2 }, { p: null, i: null }]);
    expect(hm[0].p).toBe(5);
    expect(hm[0].cells[4]).toMatchObject({ count: 2, score: 25 });
    expect(hm[4].cells[1].count).toBe(1);
  });
  it("calcula los indicadores ISO 31000", () => {
    const k = riskKpis([
      { inherent_score: 20, residual_score: 16, out_of_tolerance: true, has_treatment: true, accepted_at: null },
      { inherent_score: 20, residual_score: 4, out_of_tolerance: false, has_treatment: false, accepted_at: null },
      { inherent_score: null, residual_score: null, out_of_tolerance: false, has_treatment: false, accepted_at: null },
    ]);
    expect(k).toMatchObject({ total: 3, evaluados: 2, fueraTolerancia: 1, pctFueraTolerancia: 50, pctConTratamiento: 100, reduccion: 50 });
  });
});

describe("lectura del archivo de causas y riesgos", () => {
  it("interpreta estrategia, niveles y controles", () => {
    expect(parseStrategy("Mitigar y transferir cuando aplique — mantener")).toBe("mitigar_transferir");
    expect(parseStrategy("Mitigar — mantener y monitorear")).toBe("mitigar");
    expect(parseLevel("3 - Posible", M.probability_levels)).toBe(3);
    expect(parseLevel("Casi seguro", M.probability_levels)).toBe(5);
    expect(parseLevel("9", M.probability_levels)).toBeUndefined();
    expect(parseControlCodes("COTI-1 – Política; COTI-10 – Firewall", ["COTI-1", "COTI-10", "COTI-11"])).toEqual(["COTI-1", "COTI-10"]);
    expect(parseControlCodes("COTI-1 – Política de seguridad; COTI-3 – Accesos")).toEqual(["COTI-1", "COTI-3"]);
  });
  it("reconoce los encabezados del archivo de la organización", () => {
    const cols = detectRiskColumns(["Cod Causa/falla", "Causa / Falla", "Tipo de Riesgo", "Factor de Riesgo",
      "Eventos de amenaza de seguridad de la información", "Cod Riesgo", "Riegos CID", "Controles DIT relacionados", "Tratamiento posible"]);
    expect(Object.values(cols).sort()).toEqual(["category", "cause", "cause_code", "controls", "event", "factor", "risk_code", "risk_name", "treatment"].sort());
  });
  it("mapea filas, omite repetidas y valida niveles", () => {
    const row = {
      "Cod Causa/falla": "CAU01", "Causa / Falla": "Acciones de terceros", "Tipo de Riesgo": " Riesgos Operativos ",
      "Factor de Riesgo": "Recurso humano ", "Eventos de amenaza de seguridad de la información": "Adversarial — terceros",
      "Cod Riesgo": "R3", "Riegos CID": "Inaccesibilidad, destrucción o pérdida de la información.",
      "Controles DIT relacionados": "COTI-1 – Política; COTI-3 – Accesos", "Tratamiento posible": "Mitigar — mantener",
    };
    const res = mapRiskRows([row, row, { ...row, "Cod Riesgo": "R1", Probabilidad: "7", Impacto: "2" }], M, ["COTI-1", "COTI-3"]);
    expect(res.rows).toHaveLength(1);
    expect(res.rows[0]).toMatchObject({ risk_code: "R3", cause_code: "CAU01", category: "Riesgos Operativos", factor: "Recurso humano",
      controls: ["COTI-1", "COTI-3"], strategy: "mitigar", dimension: "disponibilidad" });
    expect(res.warnings[0]).toMatch(/repite la fila 2/);
    expect(res.errors[0]).toMatch(/probabilidad/);
  });
  it("exporta el registro con escalas y listas", () => {
    const wb = buildRiskWorkbook({ orgName: "Org", m: M, entries: [{
      code: "RG-0001", risk_code: "R1", risk_name: "Divulgación", cause_code: "CAU01", cause: "Error", category: "TI", factor: "Personas",
      threat_event: "Error humano", controls: ["COTI-1"], treatment_description: "Mitigar", treatment_strategy: "mitigar", process: null, owner: null,
      inherent_probability: 4, inherent_impact: 5, inherent_score: 20, inherent_zone: "Extremo", residual_probability: 2, residual_impact: 4,
      residual_score: 8, residual_zone: "Moderado", out_of_tolerance: false, accepted: false }] });
    expect(wb.sheets.map((s) => s.name)).toEqual(["Registro", "Escalas", "Instrucciones", "Listas"]);
    expect(buildXlsx(wb).length).toBeGreaterThan(1500);
    const back = mapRiskRows([{ ID: "RG-0001", "Cod Riesgo": "R1", Probabilidad: "4 - Probable", Impacto: "5 - Casi seguro" }], M, []);
    expect(back.rows[0]).toMatchObject({ code: "RG-0001", probability: 4, impact: 5 });
  });
});
