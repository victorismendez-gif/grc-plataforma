// Plantilla de carga de controles (y exportación con los mismos campos).
import { CONTROL_FIELDS, type ControlField } from "@/lib/control-fields";
import { colName, STYLE, type Cell, type Sheet, type Validation, type Workbook } from "@/lib/xlsx-writer";

export type ControlRow = Partial<Record<ControlField, string | null>>;

export function buildControlTemplate(input: {
  orgName: string;
  brandColor?: string;
  people: { name: string; email: string }[];
  controls?: ControlRow[];
  generatedAt?: Date;
}): Workbook {
  const MAX_ROW = 3001;
  const defs = CONTROL_FIELDS;

  // Listas (hoja oculta): una columna por campo con opciones, más responsables
  const listDefs = defs.filter((d) => d.options);
  const lists: { name: string; values: string[] }[] = [
    ...listDefs.map((d) => ({ name: d.field, values: Object.values(d.options!) })),
    { name: "owner", values: input.people.map((p) => p.email).filter(Boolean) },
  ];
  const maxLen = Math.max(1, ...lists.map((l) => l.values.length));
  const listRows: Cell[][] = [lists.map((l) => l.name)];
  for (let i = 0; i < maxLen; i++) listRows.push(lists.map((l) => (l.values[i] ? { v: l.values[i], s: STYLE.text } : null)));
  const definedNames: Record<string, string> = {};
  lists.forEach((l, i) => {
    const c = colName(i);
    definedNames[`Lista_${l.name}`] = `Listas!$${c}$2:$${c}$${Math.max(2, l.values.length + 1)}`;
  });

  // Hoja de carga
  const col = (f: ControlField) => colName(defs.findIndex((d) => d.field === f));
  const range = (f: ControlField) => `${col(f)}2:${col(f)}${MAX_ROW}`;
  const validations: Validation[] = [
    { sqref: range("code"), type: "textLength", formula1: "1", formula2: "30", allowBlank: false, promptTitle: "ID",
      prompt: "Identificador único del control, sin espacios (máx. 30).", errorTitle: "ID", error: "Máximo 30 caracteres." },
    { sqref: range("name"), type: "textLength", formula1: "2", formula2: "200", promptTitle: "Control",
      prompt: "Nombre corto del control.", errorTitle: "Control", error: "Entre 2 y 200 caracteres." },
    ...listDefs.map((d): Validation => ({
      sqref: range(d.field), type: "list", formula1: `Lista_${d.field}`, promptTitle: d.header,
      prompt: (d.help + " " + Object.values(d.options!).join(", ")).slice(0, 250),
      errorTitle: `${d.header} no válido`, error: `Elige un valor de la lista: ${Object.values(d.options!).join(", ")}.`.slice(0, 250),
    })),
  ];
  if (input.people.length) {
    validations.push({ sqref: range("owner"), type: "list", formula1: "Lista_owner", errorStyle: "warning", promptTitle: "Responsable",
      prompt: "Correo de un usuario de la plataforma o nombre del responsable.", errorTitle: "Responsable",
      error: "No es usuario de la plataforma; se guardará como texto." });
  }
  const rows: Cell[][] = [
    defs.map((d) => ({ v: d.header, s: STYLE.header })),
    ...(input.controls ?? []).map((c) => defs.map((d): Cell => c[d.field] ?? null)),
  ];
  const sheet: Sheet = {
    name: "Controles",
    rows,
    columns: defs.map((d) => ({ width: d.width, style: d.field === "code" ? STYLE.text : undefined })),
    freeze: { rows: 1, cols: 1 },
    validations,
    autoFilter: `A1:${colName(defs.length - 1)}${Math.max(1, rows.length)}`,
    rowHeights: { 0: 30 },
    fitWidth: true,
  };

  // Instrucciones
  const ins: Cell[][] = [];
  const merges: string[] = [];
  const heights: Record<number, number> = {};
  const line = (text: string, style: number = STYLE.wrap) => {
    ins.push([{ v: text, s: style }]);
    merges.push(`A${ins.length}:D${ins.length}`);
    const n = Math.ceil(text.length / 150);
    if (style === STYLE.title) heights[ins.length - 1] = 24;
    else if (n > 1) heights[ins.length - 1] = 15 * n + 2;
  };
  const date = (input.generatedAt ?? new Date()).toISOString().slice(0, 10);
  line(`Plantilla de carga de controles · ${input.orgName}`, STYLE.title);
  line(`Generada el ${date}.`);
  ins.push([]);
  line("Cómo diligenciarla", STYLE.bold);
  [
    "1. Llena la hoja «Controles»: una fila por control. No cambies el nombre ni el orden de las columnas.",
    "2. El «ID» identifica cada control: si ya existe en la plataforma, la fila actualiza ese control; si no, lo crea.",
    "3. Usa las listas desplegables para Tipo, Clase, Periodicidad, Documentación, Evidencia, Diseño, Aplicación, Efectividad y Estado.",
    "4. En la plataforma ve a Controles → Cargar desde Excel. Verás qué controles son nuevos y cuáles cambian antes de confirmar. Si el archivo tiene errores no se carga nada: corrígelos y vuelve a validarlo.",
    "5. Para actualizar los controles existentes parte de «Exportar controles».",
  ].forEach((t) => line(t));
  ins.push([]);
  line("Campos", STYLE.bold);
  ins.push([
    { v: "Columna", s: STYLE.subheader },
    { v: "¿Obligatorio?", s: STYLE.subheader },
    { v: "Qué escribir", s: STYLE.subheader },
    { v: "Valores permitidos", s: STYLE.subheader },
  ]);
  for (const d of defs) {
    ins.push([
      { v: d.header, s: STYLE.cell },
      { v: d.required ? "Sí" : "No", s: STYLE.cell },
      { v: d.help, s: STYLE.cell },
      { v: d.options ? Object.values(d.options).join(", ") : "Texto", s: STYLE.cell },
    ]);
  }
  ins.push([]);
  line("Definiciones", STYLE.bold);
  for (const d of defs.filter((x) => x.definitions)) {
    ins.push([{ v: d.header, s: STYLE.subheader }, { v: "Valor", s: STYLE.subheader }, { v: "Significado", s: STYLE.subheader }, { v: "", s: STYLE.subheader }]);
    for (const [k, v] of Object.entries(d.definitions!)) {
      ins.push([{ v: "", s: STYLE.cell }, { v: k, s: STYLE.cell }, { v: v, s: STYLE.cell }, { v: "", s: STYLE.cell }]);
      merges.push(`C${ins.length}:D${ins.length}`);
    }
  }

  return {
    sheets: [
      { name: "Instrucciones", rows: ins, columns: [{ width: 24 }, { width: 22 }, { width: 70 }, { width: 46 }], merges, rowHeights: heights, fitWidth: true },
      sheet,
      { name: "Listas", rows: listRows, hidden: true },
    ],
    definedNames,
    brandColor: input.brandColor,
  };
}
