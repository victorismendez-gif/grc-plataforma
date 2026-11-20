// Plantilla de carga de activos (y exportación del inventario en el mismo
// formato). Se arma con la configuración de la organización: tipos de activo
// con su identificador, clasificación y escala de valoración.
import {
  DIMENSIONS,
  fieldLabel,
  NAME_MAX,
  OPTIONAL_FIELDS,
  readSettings,
  type ScaleLevel,
} from "@/lib/asset-profiles";
import { ASSET_STATUS } from "@/lib/labels";
import { colName, STYLE, type Cell, type Sheet, type Validation, type Workbook } from "@/lib/xlsx-writer";

export type TemplateInput = {
  orgName: string;
  brandColor?: string;
  types: { code: string; label: string; settings: unknown }[];
  classifications: string[];
  scale: ScaleLevel[];
  people: { name: string; email: string }[];
  assets?: TemplateAsset[];
  generatedAt?: Date;
};

export type TemplateAsset = {
  code: string;
  type: string;
  name: string | null;
  ip_address: string | null;
  status: string | null;
  brand: string | null;
  model: string | null;
  operating_system: string | null;
  serial_number: string | null;
  owner_email: string | null;
  custodian: string | null;
  location: string | null;
  acquired_on: string | null;
  description: string | null;
  classification: string | null;
  confidentiality: number | null;
  integrity: number | null;
  availability: number | null;
  attributes: Record<string, string>;
};

type Column = {
  key: keyof TemplateAsset | "type";
  header: string;
  width: number;
  style?: number;
  required: string;
  help: string;
  allowed: string;
};

const MAX_ROW = 5001; // filas de datos con validación (2..5001)

/** Columnas de la hoja de carga, en orden fijo (empieza por el identificador). */
export function templateColumns(input: Pick<TemplateInput, "classifications" | "scale">): Column[] {
  const statuses = Object.values(ASSET_STATUS).join(", ");
  return [
    { key: "code", header: "Identificador único", width: 22, style: STYLE.text, required: "Según el tipo",
      help: "Primer dato de cada activo y la llave que lo reconoce entre una carga y la siguiente: placa (computadores), IMEI (celulares y tabletas), serial (servidores), documento de identidad (empleados) o etiqueta. Si el tipo no exige identificador y el activo no tiene etiqueta, déjalo vacío: la plataforma asigna un número aleatorio único.",
      allowed: "Texto, hasta 60 caracteres. Sin espacios al inicio ni al final." },
    { key: "type", header: "Tipo de activo", width: 26, required: "Sí",
      help: "Define qué identificador y qué campos aplican (ver la tabla «Campos por tipo de activo»).", allowed: "Lista desplegable." },
    { key: "name", header: "Nombre del activo", width: 34, required: "Según el tipo",
      help: `Nombre con el que se reconoce el activo. Para servidores, el nombre de host (hostname). Para celulares y tabletas puede quedar vacío: se arma con el tipo, la marca y el modelo.`,
      allowed: `Texto, máximo ${NAME_MAX} caracteres.` },
    { key: "ip_address", header: "IP", width: 16, style: STYLE.text, required: "No",
      help: "Dirección IP del servidor o equipo de red.", allowed: "IPv4 (10.0.0.15) o IPv6." },
    { key: "status", header: "Estado", width: 16, required: "No (por defecto Activo)",
      help: "Situación actual del activo.", allowed: statuses },
    { key: "brand", header: "Marca", width: 16, required: "No", help: "Fabricante.", allowed: "Texto." },
    { key: "model", header: "Modelo", width: 18, required: "No", help: "Modelo comercial.", allowed: "Texto." },
    { key: "operating_system", header: "Sistema operativo", width: 20, required: "No",
      help: "Sistema operativo y versión, por ejemplo Windows 11 Pro, Android 14, Ubuntu 22.04.", allowed: "Texto." },
    { key: "serial_number", header: "Serial", width: 20, style: STYLE.text, required: "No",
      help: "Número de serie del fabricante. En servidores el serial va en «Identificador único».", allowed: "Texto." },
    { key: "owner_email", header: "Responsable (correo)", width: 30, required: "No",
      help: "Correo del usuario de la plataforma responsable del activo. Si la persona aún no es usuaria, el dato se guarda como información adicional.",
      allowed: "Lista desplegable de usuarios (se acepta otro correo con advertencia)." },
    { key: "custodian", header: "Custodio", width: 22, required: "No",
      help: "Persona o área que tiene el activo bajo su cuidado (por ejemplo Mesa de ayuda).", allowed: "Texto." },
    { key: "location", header: "Ubicación", width: 22, required: "No", help: "Ubicación física.", allowed: "Texto." },
    { key: "acquired_on", header: "Fecha de adquisición (AAAA-MM-DD)", width: 18, style: STYLE.date, required: "No",
      help: "Fecha de compra o de alta.", allowed: "Fecha, por ejemplo 2026-03-15." },
    { key: "description", header: "Descripción", width: 36, required: "No", help: "Información relevante del activo.", allowed: "Texto." },
    { key: "classification", header: "Clasificación de la información", width: 22, required: "Recomendado",
      help: "Nivel de clasificación según la política de la organización.", allowed: input.classifications.join(", ") },
    ...(Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).map((d): Column => ({
      key: d,
      header: `${DIMENSIONS[d]} (1-5)`,
      width: 14,
      required: "Recomendado",
      help: `Valor de ${DIMENSIONS[d].toLowerCase()} según la escala de la organización (ver «Escala de valoración»).`,
      allowed: input.scale.filter((s) => s.dimension === d).map((s) => `${s.level} ${s.label}`).join(", ") || "1 a 5",
    })),
  ];
}

/** Arma el libro: Instrucciones, Activos y Listas (oculta). */
export function buildAssetTemplate(input: TemplateInput): Workbook {
  const cols = templateColumns(input);
  const typeLabels = input.types.map((t) => t.label);
  const statusLabels = Object.values(ASSET_STATUS);
  const emails = input.people.map((p) => p.email);
  const attrKeys = [...new Set((input.assets ?? []).flatMap((a) => Object.keys(a.attributes ?? {})))].sort();
  const col = (key: Column["key"]) => colName(cols.findIndex((c) => c.key === key));

  // ---------------- Listas (oculta) ----------------
  const lists: string[][] = [typeLabels, statusLabels, input.classifications, emails.length ? emails : [""]];
  const listRows: Cell[][] = [["Tipos de activo", "Estados", "Clasificación", "Responsables"]];
  const maxLen = Math.max(...lists.map((l) => l.length));
  for (let i = 0; i < maxLen; i++) listRows.push(lists.map((l) => (l[i] ? { v: l[i], s: STYLE.text } : null)));
  const listsSheet: Sheet = { name: "Listas", rows: listRows, hidden: true, columns: lists.map(() => ({ width: 30 })) };
  const ref = (i: number, n: number) => `Listas!$${colName(i)}$2:$${colName(i)}$${Math.max(2, n + 1)}`;
  const definedNames = {
    TiposActivo: ref(0, typeLabels.length),
    EstadosActivo: ref(1, statusLabels.length),
    ClasificacionInformacion: ref(2, input.classifications.length),
    Responsables: ref(3, Math.max(1, emails.length)),
  };

  // ---------------- Activos ----------------
  const headers: Cell[] = [...cols.map((c) => ({ v: c.header, s: STYLE.header })), ...attrKeys.map((k) => ({ v: k, s: STYLE.header }))];
  const dataRows: Cell[][] = (input.assets ?? []).map((a) => [
    ...cols.map((c): Cell => {
      const v = a[c.key as keyof TemplateAsset];
      if (v === null || v === undefined) return null;
      if (c.key === "acquired_on" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) {
        const [y, m, d] = v.split("-").map(Number);
        return (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000; // fecha de Excel
      }
      if (typeof v === "number") return v;
      return typeof v === "string" ? v : null;
    }),
    ...attrKeys.map((k): Cell => a.attributes?.[k] ?? null),
  ]);
  const range = (key: Column["key"]) => `${col(key)}2:${col(key)}${MAX_ROW}`;
  const validations: Validation[] = [
    { sqref: range("type"), type: "list", formula1: "TiposActivo", allowBlank: false, promptTitle: "Tipo de activo",
      prompt: "Elige el tipo de la lista. Define el identificador y los campos que aplican.", errorTitle: "Tipo no válido", error: "Elige un tipo de la lista." },
    { sqref: range("status"), type: "list", formula1: "EstadosActivo", promptTitle: "Estado", prompt: "Elige el estado de la lista. Vacío = Activo.",
      errorTitle: "Estado no válido", error: "Elige un estado de la lista." },
    { sqref: range("classification"), type: "list", formula1: "ClasificacionInformacion", promptTitle: "Clasificación",
      prompt: "Nivel de clasificación de la información según la política.", errorTitle: "Clasificación no válida", error: "Elige un valor de la lista." },
    { sqref: range("owner_email"), type: "list", formula1: "Responsables", errorStyle: "warning", promptTitle: "Responsable",
      prompt: "Correo de un usuario de la plataforma.", errorTitle: "Responsable", error: "Ese correo no es un usuario de la plataforma. Se guardará como dato adicional." },
    ...(Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).map((d): Validation => ({
      sqref: range(d), type: "whole", formula1: "1", formula2: "5", promptTitle: DIMENSIONS[d],
      prompt: input.scale.filter((s) => s.dimension === d).map((s) => `${s.level} ${s.label}`).join(" · ").slice(0, 250) || "Valor de 1 a 5",
      errorTitle: "Valor no válido", error: "Escribe un número entero de 1 a 5.",
    })),
    { sqref: range("acquired_on"), type: "date", formula1: "32874", formula2: "73051", promptTitle: "Fecha", prompt: "Formato AAAA-MM-DD, por ejemplo 2026-03-15.",
      errorTitle: "Fecha no válida", error: "Escribe una fecha válida (AAAA-MM-DD)." },
    { sqref: range("code"), type: "textLength", formula1: "1", formula2: "60", promptTitle: "Identificador único",
      prompt: "Placa, IMEI, serial, documento o etiqueta según el tipo. Vacío solo si el tipo lo permite (se asigna un número automático).",
      errorTitle: "Identificador", error: "Máximo 60 caracteres." },
    { sqref: range("name"), type: "textLength", formula1: "1", formula2: String(NAME_MAX), promptTitle: "Nombre del activo",
      prompt: `Máximo ${NAME_MAX} caracteres. En servidores, el hostname.`, errorTitle: "Nombre muy largo", error: `Máximo ${NAME_MAX} caracteres.` },
  ];

  const assetsSheet: Sheet = {
    name: "Activos",
    rows: [headers, ...dataRows],
    columns: [...cols.map((c) => ({ width: c.width, style: c.style })), ...attrKeys.map(() => ({ width: 18, style: STYLE.text }))],
    freeze: { rows: 1, cols: 1 },
    validations,
    autoFilter: `A1:${colName(headers.length - 1)}${Math.max(1, dataRows.length + 1)}`,
    rowHeights: { 0: 32 },
    fitWidth: true,
  };

  // ---------------- Instrucciones ----------------
  const ins: Cell[][] = [];
  const merges: string[] = [];
  const rowHeights: Record<number, number> = {};
  // Las celdas combinadas no ajustan su alto solas: se calcula por longitud.
  const line = (text: string, style: number = STYLE.wrap) => {
    ins.push([{ v: text, s: style }]);
    merges.push(`A${ins.length}:D${ins.length}`);
    const lines = Math.max(1, Math.ceil(text.length / 150));
    if (style === STYLE.title) rowHeights[ins.length - 1] = 24;
    else if (lines > 1) rowHeights[ins.length - 1] = 15 * lines + 2;
  };
  const blank = () => ins.push([]);
  const date = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);

  line(`Plantilla de carga de activos de información · ${input.orgName}`, STYLE.title);
  line(`Generada el ${date}. Los tipos, la clasificación y la escala corresponden a la configuración vigente de la organización.`);
  blank();
  line("Cómo diligenciarla", STYLE.bold);
  [
    "1. Llena la hoja «Activos»: una fila por activo. No cambies el nombre ni el orden de las columnas.",
    "2. Empieza siempre por el «Identificador único» y el «Tipo de activo»: el tipo define qué identificador se exige y qué campos aplican.",
    "3. Usa las listas desplegables (tipo, estado, clasificación, responsable). Para confidencialidad, integridad y disponibilidad escribe un número de 1 a 5.",
    "4. Las columnas de identificador, IP y serial están en formato texto para que Excel no altere IMEI, documentos ni números con ceros a la izquierda. No las cambies a formato número.",
    "5. Puedes agregar columnas propias al final: se guardan como datos adicionales del activo.",
    "6. En la plataforma ve a Activos → Importar Excel. Verás qué activos son nuevos, cuáles cambian y cuáles no vienen en el archivo antes de confirmar.",
    "7. Para la carga del mes siguiente parte de «Exportar inventario»: trae los identificadores asignados automáticamente y evita duplicados.",
  ].forEach((t) => line(t));
  blank();

  line("Campos de la hoja «Activos»", STYLE.bold);
  ins.push([{ v: "Columna", s: STYLE.subheader }, { v: "¿Obligatorio?", s: STYLE.subheader }, { v: "Qué escribir", s: STYLE.subheader }, { v: "Valores permitidos", s: STYLE.subheader }]);
  cols.forEach((c) => ins.push([{ v: c.header, s: STYLE.cell }, { v: c.required, s: STYLE.cell }, { v: c.help, s: STYLE.cell }, { v: c.allowed, s: STYLE.cell }]));
  blank();

  line("Identificador y campos por tipo de activo", STYLE.bold);
  ins.push([{ v: "Tipo de activo", s: STYLE.subheader }, { v: "Identificador único", s: STYLE.subheader }, { v: "Campos que aplican", s: STYLE.subheader }, { v: "Nota", s: STYLE.subheader }]);
  input.types.forEach((t) => {
    const s = readSettings(t.settings);
    const fields = OPTIONAL_FIELDS.filter((f) => s.fields.includes(f)).map((f) => fieldLabel(f, s));
    const always = ["Clasificación de la información", "Confidencialidad", "Integridad", "Disponibilidad"];
    ins.push([
      { v: t.label, s: STYLE.cell },
      { v: `${s.identifier.label} (${s.identifier.required ? "obligatorio" : "opcional: si falta se asigna un número aleatorio"})`, s: STYLE.cell },
      { v: [...fields, ...always].join(", "), s: STYLE.cell },
      { v: s.identifier.kind === "imei" ? "El IMEI tiene 15 dígitos; escríbelo completo." : s.identifier.kind === "serial" ? "El serial del servidor va en «Identificador único»; el nombre es el hostname." : "", s: STYLE.cell },
    ]);
  });
  blank();

  line("Escala de valoración (1 a 5)", STYLE.bold);
  line("Definida por la organización en Organización → Escala de valoración. Elige el nivel cuya definición describa mejor el impacto si el activo pierde esa propiedad. La criticidad del activo es el mayor de los tres valores.");
  (Object.keys(DIMENSIONS) as (keyof typeof DIMENSIONS)[]).forEach((d) => {
    ins.push([{ v: DIMENSIONS[d], s: STYLE.subheader }, { v: "Nivel", s: STYLE.subheader }, { v: "Definición", s: STYLE.subheader }, { v: "", s: STYLE.subheader }]);
    input.scale
      .filter((s) => s.dimension === d)
      .forEach((s) => {
        ins.push([{ v: `${s.level}`, s: STYLE.cell }, { v: s.label, s: STYLE.cell }, { v: s.description ?? "", s: STYLE.cell }, { v: "", s: STYLE.cell }]);
        merges.push(`C${ins.length}:D${ins.length}`);
      });
  });
  blank();
  line("Clasificación de la información", STYLE.bold);
  line(`Niveles vigentes: ${input.classifications.join(", ")}.`);

  const instructions: Sheet = {
    name: "Instrucciones",
    rows: ins,
    columns: [{ width: 30 }, { width: 28 }, { width: 70 }, { width: 46 }],
    merges,
    rowHeights,
    fitWidth: true,
  };

  return { sheets: [instructions, assetsSheet, listsSheet], definedNames, brandColor: input.brandColor };
}
