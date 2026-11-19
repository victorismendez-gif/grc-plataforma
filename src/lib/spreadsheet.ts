"use client";
// Lectura de Excel (.xlsx/.xls) y CSV en el navegador con SheetJS.
// El archivo nunca sale del equipo: solo se envían las filas al servidor.

export type SheetData = { name: string; rows: unknown[][] };

export async function readWorkbook(file: File): Promise<SheetData[]> {
  const XLSX = await import("xlsx");
  const buffer = await file.arrayBuffer();
  const wb = XLSX.read(buffer, { type: "array", cellDates: true, dense: true });
  return wb.SheetNames.map((name) => ({
    name,
    rows: XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[name], { header: 1, defval: null, blankrows: false, raw: true }),
  }));
}

/** Convierte una hoja en objetos usando la fila de encabezados indicada (base 0). */
export function rowsToObjects(rows: unknown[][], headerIndex: number): Record<string, unknown>[] {
  const header = (rows[headerIndex] ?? []).map((h, i) => String(h ?? "").trim() || `Columna ${i + 1}`);
  const seen = new Map<string, number>();
  const names = header.map((h) => {
    const n = (seen.get(h) ?? 0) + 1;
    seen.set(h, n);
    return n > 1 ? `${h} (${n})` : h;
  });
  return rows.slice(headerIndex + 1).map((r) => {
    const o: Record<string, unknown> = {};
    names.forEach((name, i) => {
      let v = r[i];
      if (v instanceof Date) v = Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
      else if (typeof v === "string") v = v.trim();
      o[name] = v ?? null;
    });
    return o;
  });
}

export async function writeWorkbook(fileName: string, sheets: { name: string; rows: Record<string, unknown>[] }[]) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const s of sheets) XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(s.rows), s.name.slice(0, 31));
  XLSX.writeFile(wb, fileName);
}
