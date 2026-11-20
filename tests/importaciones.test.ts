import { describe, expect, it } from "vitest";
import { detectMapping, mapAssetRows, type Lookups } from "@/lib/asset-import";
import { mapRequirementRows } from "@/lib/requirements-import";
import { ISO27001_TEMPLATE } from "@/lib/templates/iso27001";

const t = (code: string, label: string, kind: string, required: boolean) => ({
  id: `t-${code}`,
  code,
  label,
  settings: { identifier: { kind, label: kind, required }, fields: [] },
});
const lookups: Lookups = {
  assetTypes: [
    t("portatil", "Computador portátil", "placa", true),
    t("celular", "Celular", "imei", true),
    t("servidor", "Servidor", "serial", true),
    t("persona", "Empleado", "documento", true),
    t("repositorio", "Repositorio", "etiqueta", false),
  ],
  classifications: [
    { id: "c-pub", code: "publica", label: "Pública" },
    { id: "c-int", code: "uso_interno", label: "Uso Interno" },
    { id: "c-conf", code: "confidencial", label: "Confidencial" },
  ],
  profiles: [{ id: "p-1", email: "ana@empresa.co", name: "Ana Ruiz" }],
  scale: [
    { dimension: "confidentiality", level: 4, label: "Alto" },
    { dimension: "confidentiality", level: 5, label: "Muy alto" },
  ],
};

describe("importación de activos", () => {
  it("reconoce los encabezados de la plantilla (con texto entre paréntesis)", () => {
    const m = detectMapping(["Identificador único", "Tipo de activo", "Nombre del activo", "Confidencialidad (1-5)", "Responsable (correo)", "Color"]);
    expect(m).toEqual({
      "Identificador único": "code",
      "Tipo de activo": "asset_type_id",
      "Nombre del activo": "name",
      "Confidencialidad (1-5)": "confidentiality",
      "Responsable (correo)": "owner_id",
      Color: "attributes",
    });
  });

  it("toma el identificador según el tipo: placa, IMEI, serial o documento", () => {
    const res = mapAssetRows(
      [
        { Tipo: "Computador portátil", Placa: "PC-1", IMEI: "", Serial: "S1", Documento: "" },
        { Tipo: "celular", Placa: "", IMEI: 356938035643809, Serial: "S2", Documento: "" },
        { Tipo: "Servidor", Placa: "", IMEI: "", Serial: "SRV-9", Documento: "" },
        { Tipo: "Empleado", Placa: "", IMEI: "", Serial: "", Documento: "1020304050" },
      ],
      lookups,
    );
    expect(res.errors).toEqual([]);
    expect(res.rows.map((r) => r.code)).toEqual(["PC-1", "356938035643809", "SRV-9", "1020304050"]);
  });

  it("asigna número automático solo a tipos que no exigen identificador", () => {
    const res = mapAssetRows(
      [
        { "Identificador único": "", "Tipo de activo": "Repositorio", "Nombre del activo": "Contratos" },
        { "Identificador único": "", "Tipo de activo": "Computador portátil", "Nombre del activo": "Sin placa" },
      ],
      lookups,
    );
    expect(res.autoCodes).toBe(1);
    expect(res.rows[0].code).toBeNull();
    expect(res.errors.join(" ")).toMatch(/Fila 3: falta placa/);
  });

  it("valida nombre (80), IP, niveles 1-5 por número o nombre, clasificación y estado", () => {
    const res = mapAssetRows(
      [
        {
          "Identificador único": "SRV-1",
          "Tipo de activo": "Servidor",
          IP: "10.0.0.15",
          "Confidencialidad (1-5)": "Muy alto",
          "Integridad (1-5)": 3,
          Clasificación: "uso interno",
          Estado: "En reparación",
          "Responsable (correo)": "ANA@empresa.co",
          "Fecha de adquisición": "15/03/2024",
        },
        { "Identificador único": "SRV-2", "Tipo de activo": "Servidor", IP: "300.1.1.1", "Nombre del activo": "x".repeat(81),
          "Confidencialidad (1-5)": 6, Clasificación: "Secreta", Estado: "Prestado" },
      ],
      lookups,
    );
    expect(res.rows[0]).toMatchObject({
      code: "SRV-1",
      ip_address: "10.0.0.15",
      confidentiality: 5,
      integrity: 3,
      classification_id: "c-int",
      status: "en_reparacion",
      owner_id: "p-1",
      owner_text: null,
      acquired_on: "2024-03-15",
    });
    const e = res.errors.join(" ");
    expect(e).toMatch(/supera 80/);
    expect(e).toMatch(/IP válida/);
    expect(e).toMatch(/«6» no es un nivel válido/);
    expect(e).toMatch(/clasificación «Secreta» no existe/);
    expect(e).toMatch(/estado «Prestado»/);
  });

  it("lee el correo del custodio y rechaza correos inválidos", () => {
    const res = mapAssetRows(
      [
        { "Identificador único": "R1", "Tipo de activo": "Repositorio", Custodio: "Mesa de ayuda", "Correo custodio": "Mesa@Empresa.co" },
        { "Identificador único": "R2", "Tipo de activo": "Repositorio", "Correo custodio": "mesa de ayuda" },
      ],
      lookups,
    );
    expect(res.rows[0]).toMatchObject({ custodian: "Mesa de ayuda", custodian_email: "mesa@empresa.co" });
    expect(res.errors.join(" ")).toMatch(/«mesa de ayuda» no es un correo válido/);
  });

  it("guarda el responsable que no es usuario como texto y lee el proceso", () => {
    const res = mapAssetRows(
      [{ "Identificador único": "R1", "Tipo de activo": "Repositorio", Responsable: "Jefe de compras", Proceso: "Compras" }],
      lookups,
    );
    expect(res.errors).toEqual([]);
    expect(res.rows[0]).toMatchObject({ owner_id: null, owner_text: "Jefe de compras", process_name: "Compras" });
    expect(res.fields).toEqual(expect.arrayContaining(["owner_id", "owner_text", "process_id"]));
    expect(res.rows[0]).not.toHaveProperty("attributes");
  });

  it("rechaza tipos desconocidos e identificadores repetidos", () => {
    const res = mapAssetRows(
      [
        { "Identificador único": "A", "Tipo de activo": "Impresora 3D" },
        { "Identificador único": "B", "Tipo de activo": "Repositorio" },
        { "Identificador único": "B", "Tipo de activo": "Repositorio" },
      ],
      lookups,
    );
    expect(res.errors.join(" ")).toMatch(/tipo «Impresora 3D» no existe/);
    expect(res.errors.join(" ")).toMatch(/repetidos en el archivo: B/);
  });

  it("exige las columnas de tipo e identificador", () => {
    expect(mapAssetRows([{ Nombre: "x" }], lookups).errors.join(" ")).toMatch(/Tipo de activo.*Identificador único/s);
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
