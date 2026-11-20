// Generador mínimo de archivos .xlsx (Office Open XML) sin dependencias.
// Soporta: varias hojas, hojas ocultas, estilos básicos, formato de texto por
// columna, paneles inmovilizados, celdas combinadas, nombres definidos y
// validación de datos (listas desplegables, números enteros y fechas).

export const STYLE = {
  normal: 0,
  header: 1, // negrita, blanco sobre color de marca, ajuste de texto, borde
  text: 2, // formato texto (@): conserva ceros y números largos
  wrap: 3, // ajuste de texto, alineado arriba
  title: 4, // título grande
  bold: 5,
  subheader: 6, // negrita sobre fondo suave, borde
  date: 7, // fecha AAAA-MM-DD
  cell: 8, // ajuste de texto con borde (tablas de instrucciones)
} as const;

export type Cell = string | number | null | undefined | { v: string | number | null; s?: number };

export type Validation = {
  sqref: string;
  type: "list" | "whole" | "date" | "textLength";
  formula1: string;
  formula2?: string;
  allowBlank?: boolean;
  errorStyle?: "stop" | "warning" | "information";
  promptTitle?: string;
  prompt?: string;
  errorTitle?: string;
  error?: string;
};

export type Sheet = {
  name: string;
  rows: Cell[][];
  columns?: { width?: number; style?: number }[];
  freeze?: { rows?: number; cols?: number };
  merges?: string[];
  validations?: Validation[];
  hidden?: boolean;
  autoFilter?: string;
  /** Alto de filas específicas (índice base 0 → puntos). */
  rowHeights?: Record<number, number>;
  /** Imprimir horizontal y ajustado al ancho de la página. */
  fitWidth?: boolean;
};

export type Workbook = { sheets: Sheet[]; definedNames?: Record<string, string>; brandColor?: string };

// ---------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------
export function colName(index: number): string {
  let n = index + 1;
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    // Caracteres de control no permitidos en XML 1.0
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
}

/** Nombre de hoja válido para Excel (31 caracteres, sin : \ / ? * [ ]). */
export function sheetName(name: string): string {
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Hoja";
}

// ---------------------------------------------------------------------
// XML de las partes
// ---------------------------------------------------------------------
function sheetXml(sheet: Sheet): string {
  const out: string[] = [];
  out.push('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>');
  out.push('<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">');
  if (sheet.fitWidth) out.push('<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>');
  const fr = sheet.freeze?.rows ?? 0;
  const fc = sheet.freeze?.cols ?? 0;
  if (fr || fc) {
    const top = `${colName(fc)}${fr + 1}`;
    const pane = fr && fc ? "bottomRight" : fr ? "bottomLeft" : "topRight";
    out.push(
      `<sheetViews><sheetView workbookViewId="0"><pane${fc ? ` xSplit="${fc}"` : ""}${fr ? ` ySplit="${fr}"` : ""} topLeftCell="${top}" activePane="${pane}" state="frozen"/><selection pane="${pane}" activeCell="${top}" sqref="${top}"/></sheetView></sheetViews>`,
    );
  } else {
    out.push('<sheetViews><sheetView workbookViewId="0"/></sheetViews>');
  }
  out.push('<sheetFormatPr defaultRowHeight="15"/>');
  if (sheet.columns?.length) {
    out.push("<cols>");
    sheet.columns.forEach((c, i) => {
      const attrs = [`min="${i + 1}"`, `max="${i + 1}"`, `width="${c.width ?? 12}"`, 'customWidth="1"'];
      if (c.style) attrs.push(`style="${c.style}"`);
      out.push(`<col ${attrs.join(" ")}/>`);
    });
    out.push("</cols>");
  }
  out.push("<sheetData>");
  sheet.rows.forEach((row, ri) => {
    const cells: string[] = [];
    row.forEach((raw, ci) => {
      if (raw === null || raw === undefined) return;
      const cell = typeof raw === "object" ? raw : { v: raw };
      const colStyle = sheet.columns?.[ci]?.style;
      const s = cell.s ?? colStyle ?? 0;
      const ref = `${colName(ci)}${ri + 1}`;
      const sAttr = s ? ` s="${s}"` : "";
      if (cell.v === null || cell.v === "") {
        if (s) cells.push(`<c r="${ref}"${sAttr}/>`);
      } else if (typeof cell.v === "number" && Number.isFinite(cell.v)) {
        cells.push(`<c r="${ref}"${sAttr}><v>${cell.v}</v></c>`);
      } else {
        cells.push(`<c r="${ref}"${sAttr} t="inlineStr"><is><t xml:space="preserve">${esc(String(cell.v))}</t></is></c>`);
      }
    });
    const ht = sheet.rowHeights?.[ri];
    if (cells.length || ht) out.push(`<row r="${ri + 1}"${ht ? ` ht="${ht}" customHeight="1"` : ""}>${cells.join("")}</row>`);
  });
  out.push("</sheetData>");
  if (sheet.autoFilter) out.push(`<autoFilter ref="${sheet.autoFilter}"/>`);
  if (sheet.merges?.length) {
    out.push(`<mergeCells count="${sheet.merges.length}">${sheet.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>`);
  }
  if (sheet.validations?.length) {
    out.push(`<dataValidations count="${sheet.validations.length}">`);
    for (const v of sheet.validations) {
      const attrs = [
        `type="${v.type}"`,
        `allowBlank="${v.allowBlank === false ? 0 : 1}"`,
        'showInputMessage="1"',
        'showErrorMessage="1"',
        `sqref="${v.sqref}"`,
      ];
      if (v.type !== "list") attrs.push('operator="between"');
      if (v.errorStyle && v.errorStyle !== "stop") attrs.push(`errorStyle="${v.errorStyle}"`);
      if (v.promptTitle) attrs.push(`promptTitle="${esc(v.promptTitle.slice(0, 32))}"`);
      if (v.prompt) attrs.push(`prompt="${esc(v.prompt.slice(0, 255))}"`);
      if (v.errorTitle) attrs.push(`errorTitle="${esc(v.errorTitle.slice(0, 32))}"`);
      if (v.error) attrs.push(`error="${esc(v.error.slice(0, 255))}"`);
      out.push(
        `<dataValidation ${attrs.join(" ")}><formula1>${esc(v.formula1)}</formula1>${v.formula2 ? `<formula2>${esc(v.formula2)}</formula2>` : ""}</dataValidation>`,
      );
    }
    out.push("</dataValidations>");
  }
  out.push('<pageMargins left="0.5" right="0.5" top="0.6" bottom="0.6" header="0.3" footer="0.3"/>');
  if (sheet.fitWidth) out.push('<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0"/>');
  out.push("</worksheet>");
  return out.join("");
}

function stylesXml(brand: string): string {
  const color = `FF${brand.replace("#", "").toUpperCase()}`;
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="yyyy\\-mm\\-dd"/></numFmts>
<fonts count="4">
<font><sz val="11"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="14"/><name val="Calibri"/><family val="2"/></font>
<font><b/><sz val="11"/><name val="Calibri"/><family val="2"/></font>
</fonts>
<fills count="4">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="${color}"/><bgColor indexed="64"/></patternFill></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFE6F0F1"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="2">
<border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"><color rgb="FFD8E0E4"/></left><right style="thin"><color rgb="FFD8E0E4"/></right><top style="thin"><color rgb="FFD8E0E4"/></top><bottom style="thin"><color rgb="FFD8E0E4"/></bottom><diagonal/></border>
</borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="9">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="49" fontId="1" fillId="2" borderId="1" xfId="0" applyNumberFormat="1" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="49" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="3" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
}

function workbookXml(wb: Workbook): string {
  const sheets = wb.sheets
    .map((s, i) => `<sheet name="${esc(sheetName(s.name))}" sheetId="${i + 1}"${s.hidden ? ' state="hidden"' : ""} r:id="rId${i + 1}"/>`)
    .join("");
  const names = Object.entries(wb.definedNames ?? {})
    .map(([n, ref]) => `<definedName name="${esc(n)}">${esc(ref)}</definedName>`)
    .join("");
  const firstVisible = Math.max(0, wb.sheets.findIndex((s) => !s.hidden));
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><bookViews><workbookView activeTab="${firstVisible}" firstSheet="${firstVisible}"/></bookViews><sheets>${sheets}</sheets>${names ? `<definedNames>${names}</definedNames>` : ""}</workbook>`;
}

function contentTypesXml(n: number): string {
  const sheets = Array.from({ length: n }, (_, i) =>
    `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets}</Types>`;
}

const ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`;

function workbookRels(n: number): string {
  const sheets = Array.from({ length: n }, (_, i) =>
    `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  ).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets}<Relationship Id="rId${n + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`;
}

// ---------------------------------------------------------------------
// ZIP (método "store", sin compresión) con CRC-32
// ---------------------------------------------------------------------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(data: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function zip(files: { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  // Fecha DOS fija (1-ene-2026) para salidas reproducibles
  const dosTime = 0;
  const dosDate = ((2026 - 1980) << 9) | (1 << 5) | 1;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(6, 0x0800, true); // nombres en UTF-8
    local.setUint16(8, 0, true);
    local.setUint16(10, dosTime, true);
    local.setUint16(12, dosDate, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, f.data.length, true);
    local.setUint32(22, f.data.length, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    chunks.push(new Uint8Array(local.buffer), name, f.data);

    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true);
    cen.setUint16(4, 20, true);
    cen.setUint16(6, 20, true);
    cen.setUint16(8, 0x0800, true);
    cen.setUint16(10, 0, true);
    cen.setUint16(12, dosTime, true);
    cen.setUint16(14, dosDate, true);
    cen.setUint32(16, crc, true);
    cen.setUint32(20, f.data.length, true);
    cen.setUint32(24, f.data.length, true);
    cen.setUint16(28, name.length, true);
    cen.setUint16(30, 0, true);
    cen.setUint16(32, 0, true);
    cen.setUint16(34, 0, true);
    cen.setUint16(36, 0, true);
    cen.setUint32(38, 0, true);
    cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name);
    offset += 30 + name.length + f.data.length;
  }
  const centralSize = central.reduce((n, c) => n + c.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, files.length, true);
  end.setUint16(10, files.length, true);
  end.setUint32(12, centralSize, true);
  end.setUint32(16, offset, true);
  const all = [...chunks, ...central, new Uint8Array(end.buffer)];
  const total = all.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const c of all) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

/** Genera el archivo .xlsx completo. */
export function buildXlsx(wb: Workbook): Uint8Array {
  const enc = new TextEncoder();
  const files = [
    { name: "[Content_Types].xml", data: enc.encode(contentTypesXml(wb.sheets.length)) },
    { name: "_rels/.rels", data: enc.encode(ROOT_RELS) },
    { name: "xl/workbook.xml", data: enc.encode(workbookXml(wb)) },
    { name: "xl/_rels/workbook.xml.rels", data: enc.encode(workbookRels(wb.sheets.length)) },
    { name: "xl/styles.xml", data: enc.encode(stylesXml(wb.brandColor ?? "#0B6B74")) },
    ...wb.sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: enc.encode(sheetXml(s)) })),
  ];
  return zip(files);
}
