// Traduce las filas de un Excel/CSV de inventario a registros de activos.
// Es código puro (sin red) para poder probarlo y usarlo en servidor.
import { clean, normalize } from "@/lib/text";

export type Lookup = { id: string; code?: string | null; label?: string | null; name?: string | null; email?: string | null };
export type Lookups = {
  assetTypes: Lookup[];
  classifications: Lookup[];
  units: Lookup[];
  profiles: Lookup[];
};

export type AssetField =
  | "code" | "name" | "asset_type_id" | "description" | "owner_id" | "custodian" | "unit_id" | "location"
  | "classification_id" | "confidentiality" | "integrity" | "availability" | "status" | "brand" | "model"
  | "serial_number" | "acquired_on";

/** Encabezados aceptados (normalizados) por campo. */
const HEADER_ALIASES: Record<AssetField, string[]> = {
  code: ["codigo", "cod", "codigoactivo", "idactivo", "id", "placa", "consecutivo", "activoid"],
  name: ["nombre", "nombreactivo", "activo", "nombredelactivo"],
  asset_type_id: ["tipo", "tipoactivo", "tipodeactivo", "categoria"],
  description: ["descripcion", "descripciondelactivo", "detalle"],
  owner_id: ["dueno", "propietario", "responsable", "duenodelactivo", "correoresponsable"],
  custodian: ["custodio", "custodiodelactivo"],
  unit_id: ["unidad", "area", "sede", "dependencia", "unidadorganizacional"],
  location: ["ubicacion", "ubicacionfisica", "lugar"],
  classification_id: ["clasificacion", "nivelclasificacion", "clasificaciondelainformacion"],
  confidentiality: ["confidencialidad", "c"],
  integrity: ["integridad", "i"],
  availability: ["disponibilidad", "d"],
  status: ["estado", "estadoactivo"],
  brand: ["marca", "fabricante"],
  model: ["modelo"],
  serial_number: ["serial", "serie", "numerodeserie", "numeroserie", "sn"],
  acquired_on: ["fechaadquisicion", "fechadeadquisicion", "fechacompra", "fechadecompra"],
};

const STATUS_ALIASES: Record<string, string> = {
  activo: "activo", enuso: "activo", operativo: "activo", asignado: "activo", disponible: "activo",
  enreparacion: "en_reparacion", reparacion: "en_reparacion", mantenimiento: "en_reparacion",
  dadodebaja: "dado_de_baja", baja: "dado_de_baja", retirado: "dado_de_baja",
  perdido: "perdido", hurtado: "perdido", hurto: "perdido", robado: "perdido", perdidoohurtado: "perdido",
};

const LEVEL_ALIASES: Record<string, number> = {
  "1": 1, bajo: 1, baja: 1, b: 1,
  "2": 2, medio: 2, media: 2, m: 2,
  "3": 3, alto: 3, alta: 3, a: 3,
};

export type MappedRow = Record<string, unknown> & { code: string };
export type MappingResult = {
  /** encabezado del archivo → campo (o "attributes" si va a datos adicionales) */
  mapping: Record<string, AssetField | "attributes">;
  /** campos presentes en el archivo (los demás no se modifican) */
  fields: string[];
  rows: MappedRow[];
  warnings: string[];
  errors: string[];
};

export function detectMapping(headers: string[]): Record<string, AssetField | "attributes"> {
  const mapping: Record<string, AssetField | "attributes"> = {};
  const used = new Set<AssetField>();
  for (const h of headers) {
    const n = normalize(h);
    const field = (Object.keys(HEADER_ALIASES) as AssetField[]).find((f) => !used.has(f) && HEADER_ALIASES[f].includes(n));
    if (field) {
      mapping[h] = field;
      used.add(field);
    } else if (n) {
      mapping[h] = "attributes";
    }
  }
  return mapping;
}

function findLookup(list: Lookup[], value: string): Lookup | undefined {
  const n = normalize(value);
  if (!n) return undefined;
  return list.find(
    (x) => normalize(x.code) === n || normalize(x.label) === n || normalize(x.name) === n || normalize(x.email) === n,
  );
}

function toLevel(value: unknown): number | null | "invalid" {
  const s = clean(value);
  if (s === null) return null;
  const lvl = LEVEL_ALIASES[normalize(s)];
  return lvl ?? "invalid";
}

function toDate(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/aaaa (formato Colombia)
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "invalid";
}

/** Convierte filas crudas en registros listos para public.import_assets. */
export function mapAssetRows(raw: Record<string, unknown>[], lookups: Lookups): MappingResult {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const mapping = detectMapping(headers);
  const warnings: string[] = [];
  const errors: string[] = [];
  const fieldsPresent = new Set<string>(Object.values(mapping).filter((f) => f !== "code"));

  if (!Object.values(mapping).includes("code")) {
    errors.push("No se encontró la columna de código del activo (por ejemplo «Código» o «Placa»).");
    return { mapping, fields: [], rows: [], warnings, errors };
  }
  const otherType = lookups.assetTypes.find((t) => t.code === "otro");
  const rows: MappedRow[] = [];

  raw.forEach((r, i) => {
    const line = i + 2; // fila 1 = encabezados
    const out: Record<string, unknown> = {};
    const attributes: Record<string, string> = {};
    for (const [header, field] of Object.entries(mapping)) {
      const value = r[header];
      if (field === "attributes") {
        const s = clean(value instanceof Date ? value.toISOString().slice(0, 10) : value);
        if (s !== null) attributes[header.trim()] = s.slice(0, 500);
        continue;
      }
      switch (field) {
        case "code":
        case "name":
        case "description":
        case "custodian":
        case "location":
        case "brand":
        case "model":
        case "serial_number":
          out[field] = clean(value)?.slice(0, field === "description" ? 2000 : 200) ?? null;
          break;
        case "asset_type_id": {
          const s = clean(value);
          const hit = s ? findLookup(lookups.assetTypes, s) : undefined;
          if (hit) out[field] = hit.id;
          else {
            out[field] = otherType?.id ?? null;
            if (s) attributes["Tipo original"] = s;
            if (s) warnings.push(`Fila ${line}: tipo «${s}» no está en el catálogo; se registró como «Otro».`);
          }
          break;
        }
        case "classification_id":
        case "unit_id":
        case "owner_id": {
          const s = clean(value);
          const list =
            field === "classification_id" ? lookups.classifications : field === "unit_id" ? lookups.units : lookups.profiles;
          const hit = s ? findLookup(list, s) : undefined;
          out[field] = hit?.id ?? null;
          if (s && !hit) {
            const names = { classification_id: "Clasificación", unit_id: "Unidad", owner_id: "Dueño" } as const;
            attributes[`${names[field]} original`] = s;
            warnings.push(`Fila ${line}: ${names[field].toLowerCase()} «${s}» no coincide con ningún registro; se guardó como dato adicional.`);
          }
          break;
        }
        case "confidentiality":
        case "integrity":
        case "availability": {
          const lvl = toLevel(value);
          if (lvl === "invalid") {
            errors.push(`Fila ${line}: «${String(value)}» no es un nivel válido (use 1-3 o Bajo/Medio/Alto).`);
            out[field] = null;
          } else out[field] = lvl;
          break;
        }
        case "status": {
          const s = clean(value);
          if (s === null) out[field] = null;
          else {
            const st = STATUS_ALIASES[normalize(s)];
            if (!st) errors.push(`Fila ${line}: estado «${s}» no reconocido.`);
            out[field] = st ?? null;
          }
          break;
        }
        case "acquired_on": {
          const d = toDate(value);
          if (d === "invalid") {
            warnings.push(`Fila ${line}: fecha «${String(value)}» no reconocida; se dejó vacía.`);
            out[field] = null;
          } else out[field] = d;
          break;
        }
      }
    }
    const code = typeof out.code === "string" ? out.code : "";
    if (!code) {
      // Filas completamente vacías se ignoran; las que tienen datos sin código son error
      if (Object.values(out).some((v) => v !== null) || Object.keys(attributes).length) {
        errors.push(`Fila ${line}: falta el código del activo.`);
      }
      return;
    }
    if (fieldsPresent.has("attributes") || Object.keys(attributes).length) {
      out.attributes = attributes;
      fieldsPresent.add("attributes");
    }
    if (!("asset_type_id" in out)) out.asset_type_id = otherType?.id ?? null;
    rows.push({ ...out, code } as MappedRow);
  });

  const seen = new Map<string, number>();
  for (const r of rows) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
  if (dupes.length) errors.push(`Códigos repetidos en el archivo: ${dupes.slice(0, 20).join(", ")}.`);
  if (rows.length > 5000) errors.push("El archivo supera 5.000 activos; divídelo en varias cargas.");

  return { mapping, fields: [...fieldsPresent], rows, warnings: warnings.slice(0, 200), errors: errors.slice(0, 200) };
}
