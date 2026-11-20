// Traduce filas de Excel/CSV a controles (código puro).
import { clean, normalize } from "@/lib/text";
import { CONTROL_CODE_RE, CONTROL_FIELDS, defaultEffectiveness, type ControlField } from "@/lib/control-fields";

type Person = { id: string; name?: string | null; email?: string | null };

const ALIASES: Record<ControlField, string[]> = {
  code: ["id", "idcontrol", "codigo", "codigocontrol", "cod"],
  name: ["control", "nombre", "nombredelcontrol", "nombrecontrol"],
  description: ["descripcion", "descripciondelcontrol", "detalle"],
  owner: ["responsable", "dueno", "propietario", "responsabledelcontrol"],
  process: ["proceso", "procesoasociado", "macroproceso"],
  control_type: ["tipo", "tipodecontrol", "tipocontrol"],
  nature: ["clase", "naturaleza", "implementacion", "clasedecontrol"],
  frequency: ["periodicidad", "frecuencia"],
  documentation: ["documentacion", "documentado"],
  evidence: ["evidencia", "registro"],
  design_rating: ["diseno", "calificaciondeldiseno"],
  application_rating: ["aplicacion", "ejecucion", "calificaciondelaaplicacion"],
  effectiveness_rating: ["efectividad", "eficacia"],
  implementation_status: ["estado", "estadodelcontrol"],
};

export type ControlMappingResult = {
  mapping: Record<string, ControlField | "ignorada">;
  fields: string[];
  rows: Record<string, unknown>[];
  warnings: string[];
  errors: string[];
};

export function headerKey(h: string): string {
  return normalize(String(h).replace(/\(.*?\)/g, " "));
}

export function detectControlMapping(headers: string[]): Record<string, ControlField | "ignorada"> {
  const mapping: Record<string, ControlField | "ignorada"> = {};
  const used = new Set<ControlField>();
  for (const h of headers) {
    const n = headerKey(h);
    const f = (Object.keys(ALIASES) as ControlField[]).find((k) => !used.has(k) && ALIASES[k].includes(n));
    if (f) {
      mapping[h] = f;
      used.add(f);
    } else if (n) mapping[h] = "ignorada";
  }
  return mapping;
}

export function hasControlId(mapping: Record<string, string>): boolean {
  return Object.values(mapping).includes("code");
}

function asText(v: unknown): string | null {
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return clean(v);
}

/** Busca un valor en las opciones por clave, etiqueta o número (para calificaciones). */
function matchOption(options: Record<string | number, string>, value: string): string | number | undefined {
  const n = normalize(value);
  for (const [k, label] of Object.entries(options)) {
    if (normalize(k) === n || normalize(label) === n) return /^\d+$/.test(k) ? Number(k) : k;
  }
  return undefined;
}

export function mapControlRows(raw: Record<string, unknown>[], people: Person[]): ControlMappingResult {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const mapping = detectControlMapping(headers);
  const errors: string[] = [];
  const warnings: string[] = [];
  const present = new Set(Object.values(mapping));
  if (!present.has("code")) errors.push("Falta la columna «ID». Descarga la plantilla para ver el formato.");
  if (!present.has("name")) errors.push("Falta la columna «Control».");
  if (errors.length) return { mapping, fields: [], rows: [], warnings, errors };

  const fields = new Set<string>();
  for (const f of present) {
    if (f === "ignorada" || f === "code") continue;
    if (f === "owner") fields.add("owner_id").add("owner_text");
    else if (f === "process") fields.add("process_id");
    else fields.add(f);
  }
  if (present.has("design_rating") && present.has("application_rating")) fields.add("effectiveness_rating");

  const defs = new Map(CONTROL_FIELDS.map((d) => [d.field, d]));
  const rows: Record<string, unknown>[] = [];

  raw.forEach((r, i) => {
    const line = i + 2;
    if (Object.values(r).every((v) => asText(v) === null)) return;
    const out: Record<string, unknown> = {};
    for (const [header, field] of Object.entries(mapping)) {
      if (field === "ignorada") continue;
      const s = asText(r[header]);
      const def = defs.get(field)!;
      switch (field) {
        case "code":
          if (!s) errors.push(`Fila ${line}: falta el ID del control.`);
          else if (!CONTROL_CODE_RE.test(s)) errors.push(`Fila ${line}: el ID «${s}» solo admite letras, números, punto, guion y guion bajo, sin espacios (máx. 30).`);
          out.code = s;
          break;
        case "name":
          if (!s || s.length < 2) errors.push(`Fila ${line}: falta el nombre del control.`);
          else if (s.length > 200) errors.push(`Fila ${line}: el nombre del control supera 200 caracteres.`);
          out.name = s;
          break;
        case "description":
          out.description = s?.slice(0, 5000) ?? null;
          break;
        case "owner": {
          const n = s ? normalize(s) : "";
          const hit = n ? people.find((p) => normalize(p.email) === n || normalize(p.name) === n) : undefined;
          out.owner_id = hit?.id ?? null;
          out.owner_text = hit ? null : s?.slice(0, 120) ?? null;
          break;
        }
        case "process":
          out.process_name = s?.slice(0, 160) ?? null; // se resuelve en el servidor
          break;
        default: {
          if (s === null) {
            out[field] = null;
            break;
          }
          const v = matchOption(def.options!, s);
          if (v === undefined) {
            errors.push(`Fila ${line}: «${s}» no es un valor válido de ${def.header}. Use: ${Object.values(def.options!).join(", ")}.`);
          }
          out[field] = v ?? null;
        }
      }
    }
    if ("design_rating" in out || "application_rating" in out) {
      out.effectiveness_rating = defaultEffectiveness(
        (out.design_rating as number | null) ?? null,
        (out.application_rating as number | null) ?? null,
        (out.effectiveness_rating as number | null) ?? null,
      );
    }
    rows.push(out);
  });

  const seen = new Map<string, number>();
  for (const r of rows) if (r.code) seen.set(String(r.code), (seen.get(String(r.code)) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
  if (dupes.length) errors.push(`ID repetidos en el archivo: ${dupes.slice(0, 20).join(", ")}.`);
  if (rows.length > 3000) errors.push("El archivo supera 3.000 controles.");
  return { mapping, fields: [...fields], rows, warnings: warnings.slice(0, 200), errors: errors.slice(0, 200) };
}
