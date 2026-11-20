// Traduce las filas de un Excel/CSV de inventario a registros de activos.
// Código puro (sin red): se usa en el servidor y en las pruebas.
import { clean, normalize } from "@/lib/text";
import { isEmail, isIp, NAME_MAX, readSettings, type AssetTypeSettings, type ScaleLevel } from "@/lib/asset-profiles";

export type Lookup = { id: string; code?: string | null; label?: string | null; name?: string | null; email?: string | null };
export type TypeLookup = { id: string; code: string; label: string; settings: AssetTypeSettings | unknown };
export type Lookups = {
  assetTypes: TypeLookup[];
  classifications: Lookup[];
  profiles: Lookup[];
  scale: Pick<ScaleLevel, "dimension" | "level" | "label">[];
};

type MappedField =
  | "code" | "id_placa" | "id_imei" | "id_documento"
  | "asset_type_id" | "name" | "ip_address" | "status" | "brand" | "model" | "operating_system" | "serial_number"
  | "owner_id" | "custodian" | "custodian_email" | "location" | "acquired_on" | "description"
  | "classification_id" | "confidentiality" | "integrity" | "availability";

/** Encabezados aceptados (normalizados, sin el texto entre paréntesis). */
const HEADER_ALIASES: Record<MappedField, string[]> = {
  code: ["identificador", "identificadorunico", "codigo", "cod", "codigoactivo", "idactivo", "id", "etiqueta", "consecutivo", "etiquetaonumero"],
  id_placa: ["placa", "numerodeplaca"],
  id_imei: ["imei"],
  id_documento: ["documento", "documentodeidentidad", "cedula", "numerodedocumento", "numerodocumento"],
  asset_type_id: ["tipo", "tipoactivo", "tipodeactivo", "categoria"],
  name: ["nombre", "nombreactivo", "nombredelactivo", "activo", "hostname", "nombrehostname"],
  ip_address: ["ip", "direccionip"],
  status: ["estado", "estadoactivo"],
  brand: ["marca", "fabricante"],
  model: ["modelo"],
  operating_system: ["sistemaoperativo", "so"],
  serial_number: ["serial", "serie", "numerodeserie", "numeroserie", "sn"],
  owner_id: ["responsable", "correoresponsable", "dueno", "propietario"],
  custodian: ["custodio"],
  custodian_email: ["correocustodio", "correodelcustodio", "emailcustodio", "correoelectronicocustodio"],
  location: ["ubicacion", "ubicacionfisica", "lugar"],
  acquired_on: ["fechaadquisicion", "fechadeadquisicion", "fechacompra", "fechadecompra"],
  description: ["descripcion", "detalle"],
  classification_id: ["clasificacion", "clasificaciondelainformacion", "nivelclasificacion"],
  confidentiality: ["confidencialidad", "c"],
  integrity: ["integridad", "i"],
  availability: ["disponibilidad", "d"],
};

const STATUS_ALIASES: Record<string, string> = {
  activo: "activo", enuso: "activo", operativo: "activo", asignado: "activo", disponible: "activo",
  enreparacion: "en_reparacion", reparacion: "en_reparacion", mantenimiento: "en_reparacion",
  dadodebaja: "dado_de_baja", baja: "dado_de_baja", retirado: "dado_de_baja",
  perdido: "perdido", hurtado: "perdido", hurto: "perdido", robado: "perdido", perdidoohurtado: "perdido",
};

const DIMENSION_OF = { confidentiality: "confidentiality", integrity: "integrity", availability: "availability" } as const;

export type MappedRow = Record<string, unknown> & { code: string | null };
export type MappingResult = {
  mapping: Record<string, MappedField | "attributes">;
  fields: string[];
  rows: MappedRow[];
  warnings: string[];
  errors: string[];
  autoCodes: number;
};

/** Normaliza un encabezado: sin texto entre paréntesis, tildes ni símbolos. */
export function headerKey(h: string): string {
  return normalize(String(h).replace(/\(.*?\)/g, " "));
}

export function detectMapping(headers: string[]): Record<string, MappedField | "attributes"> {
  const mapping: Record<string, MappedField | "attributes"> = {};
  const used = new Set<MappedField>();
  for (const h of headers) {
    const n = headerKey(h);
    const field = (Object.keys(HEADER_ALIASES) as MappedField[]).find((f) => !used.has(f) && HEADER_ALIASES[f].includes(n));
    if (field) {
      mapping[h] = field;
      used.add(field);
    } else if (n) {
      mapping[h] = "attributes";
    }
  }
  return mapping;
}

/** ¿Tiene el archivo alguna columna que pueda identificar activos? */
export function hasIdentifierColumn(mapping: Record<string, string>): boolean {
  return Object.values(mapping).some((f) => ["code", "id_placa", "id_imei", "id_documento", "serial_number"].includes(f));
}

function findLookup(list: Lookup[], value: string): Lookup | undefined {
  const n = normalize(value);
  if (!n) return undefined;
  return list.find((x) => normalize(x.code) === n || normalize(x.label) === n || normalize(x.name) === n || normalize(x.email) === n);
}

/** Convierte números de Excel en texto sin notación científica (IMEI, documentos). */
function asText(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Number.isInteger(value) ? BigInt(Math.round(value)).toString() : String(value);
  }
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return clean(value);
}

function toDate(value: unknown): string | null | "invalid" {
  if (value === null || value === undefined || value === "") return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = String(value).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/); // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  return "invalid";
}

/** Convierte filas crudas en registros listos para public.import_assets. */
export function mapAssetRows(raw: Record<string, unknown>[], lookups: Lookups): MappingResult {
  const headers = [...new Set(raw.flatMap((r) => Object.keys(r)))];
  const mapping = detectMapping(headers);
  const warnings: string[] = [];
  const errors: string[] = [];
  const mapped = new Set(Object.values(mapping));

  if (!mapped.has("asset_type_id")) {
    errors.push("Falta la columna «Tipo de activo». Descarga la plantilla para ver el formato.");
  }
  if (!hasIdentifierColumn(mapping)) {
    errors.push("Falta la columna «Identificador único» (o Placa, IMEI, Serial o Documento).");
  }
  if (errors.length) return { mapping, fields: [], rows: [], warnings, errors, autoCodes: 0 };

  const types = lookups.assetTypes.map((t) => ({ ...t, settings: readSettings(t.settings) }));
  const typeNames = types.map((t) => t.label).join(", ");
  const realFields = new Set<string>(
    [...mapped].filter((f) => !["code", "id_placa", "id_imei", "id_documento", "attributes"].includes(f)),
  );
  const rows: MappedRow[] = [];
  let autoCodes = 0;

  raw.forEach((r, i) => {
    const line = i + 2;
    const cell = (field: MappedField): unknown => {
      const header = Object.keys(mapping).find((h) => mapping[h] === field);
      return header === undefined ? undefined : r[header];
    };
    const values = Object.values(r).map(asText).filter((v) => v !== null);
    if (values.length === 0) return; // fila vacía

    const typeText = asText(cell("asset_type_id"));
    const type = typeText ? types.find((t) => normalize(t.code) === normalize(typeText) || normalize(t.label) === normalize(typeText)) : undefined;
    if (!type) {
      errors.push(typeText ? `Fila ${line}: el tipo «${typeText}» no existe. Use uno de: ${typeNames}.` : `Fila ${line}: falta el tipo de activo.`);
      return;
    }
    const idSpec = type.settings.identifier;
    const out: Record<string, unknown> = { asset_type_id: type.id };
    const attributes: Record<string, string> = {};

    // Identificador según el tipo
    const byKind: Record<string, MappedField> = { placa: "id_placa", imei: "id_imei", documento: "id_documento", serial: "serial_number" };
    let code = asText(cell("code"));
    if (!code && byKind[idSpec.kind]) code = asText(cell(byKind[idSpec.kind]));
    if (code && code.length > 60) {
      errors.push(`Fila ${line}: el identificador supera 60 caracteres.`);
      return;
    }
    if (!code) {
      if (idSpec.required) {
        errors.push(`Fila ${line}: falta ${idSpec.label} (obligatorio para «${type.label}»).`);
        return;
      }
      autoCodes++;
    } else if (idSpec.kind === "imei" && !/^\d{14,16}$/.test(code)) {
      warnings.push(`Fila ${line}: el IMEI «${code}» no tiene 15 dígitos; revísalo.`);
    }

    for (const [header, field] of Object.entries(mapping)) {
      const value = r[header];
      if (field === "code" || field === "asset_type_id") continue;
      if (field === "attributes" || field === "id_placa" || field === "id_imei" || field === "id_documento") {
        if (field !== "attributes" && byKind[idSpec.kind] === field) continue; // ya es el identificador
        const s = asText(value);
        if (s !== null) attributes[header.trim()] = s.slice(0, 500);
        continue;
      }
      switch (field) {
        case "name": {
          const s = asText(value);
          if (s && s.length > NAME_MAX) errors.push(`Fila ${line}: el nombre del activo supera ${NAME_MAX} caracteres.`);
          out.name = s;
          break;
        }
        case "brand":
        case "model":
        case "operating_system":
        case "serial_number":
          out[field] = asText(value)?.slice(0, 120) ?? null;
          break;
        case "custodian":
        case "location":
          out[field] = asText(value)?.slice(0, 200) ?? null;
          break;
        case "description":
          out[field] = asText(value)?.slice(0, 2000) ?? null;
          break;
        case "custodian_email": {
          const s = asText(value)?.toLowerCase() ?? null;
          if (s && !isEmail(s)) errors.push(`Fila ${line}: «${s}» no es un correo válido para el custodio.`);
          out.custodian_email = s;
          break;
        }
        case "ip_address": {
          const s = asText(value);
          if (s && !isIp(s)) errors.push(`Fila ${line}: «${s}» no es una dirección IP válida.`);
          out.ip_address = s;
          break;
        }
        case "classification_id":
        case "owner_id": {
          const s = asText(value);
          const list = field === "classification_id" ? lookups.classifications : lookups.profiles;
          const hit = s ? findLookup(list, s) : undefined;
          out[field] = hit?.id ?? null;
          if (s && !hit) {
            if (field === "classification_id") {
              errors.push(`Fila ${line}: la clasificación «${s}» no existe. Use: ${lookups.classifications.map((c) => c.label).join(", ")}.`);
            } else {
              attributes["Responsable original"] = s;
              warnings.push(`Fila ${line}: el responsable «${s}» no es un usuario de la plataforma; se guardó como dato adicional.`);
            }
          }
          break;
        }
        case "confidentiality":
        case "integrity":
        case "availability": {
          const s = asText(value);
          if (s === null) {
            out[field] = null;
            break;
          }
          const levels = lookups.scale.filter((l) => l.dimension === DIMENSION_OF[field]);
          const n = Number(s.replace(",", "."));
          const hit = Number.isInteger(n) && n >= 1 && n <= 5 ? n : levels.find((l) => normalize(l.label) === normalize(s))?.level;
          if (!hit) errors.push(`Fila ${line}: «${s}» no es un nivel válido de ${field === "confidentiality" ? "confidencialidad" : field === "integrity" ? "integridad" : "disponibilidad"} (1 a 5).`);
          out[field] = hit ?? null;
          break;
        }
        case "status": {
          const s = asText(value);
          if (s === null) out.status = null;
          else {
            const st = STATUS_ALIASES[normalize(s)];
            if (!st) errors.push(`Fila ${line}: estado «${s}» no reconocido (Activo, En reparación, Dado de baja, Perdido o hurtado).`);
            out.status = st ?? null;
          }
          break;
        }
        case "acquired_on": {
          const d = toDate(value);
          if (d === "invalid") {
            warnings.push(`Fila ${line}: fecha «${String(value)}» no reconocida (use AAAA-MM-DD); se dejó vacía.`);
            out.acquired_on = null;
          } else out.acquired_on = d;
          break;
        }
      }
    }
    if (Object.keys(attributes).length || realFields.has("attributes")) {
      out.attributes = attributes;
      realFields.add("attributes");
    }
    if (mapped.has("attributes") || mapped.has("id_placa") || mapped.has("id_imei") || mapped.has("id_documento")) realFields.add("attributes");
    rows.push({ ...out, code: code ?? null });
  });

  const seen = new Map<string, number>();
  for (const r of rows) if (r.code) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  const dupes = [...seen].filter(([, n]) => n > 1).map(([c]) => c);
  if (dupes.length) errors.push(`Identificadores repetidos en el archivo: ${dupes.slice(0, 20).join(", ")}.`);
  if (rows.length > 5000) errors.push("El archivo supera 5.000 activos; divídelo en varias cargas.");
  if (autoCodes) {
    warnings.unshift(
      `${autoCodes} activo(s) sin identificador recibirán un número automático. En la próxima carga, usa «Exportar inventario» para conservar esos números y no duplicarlos.`,
    );
  }
  realFields.add("asset_type_id");
  return { mapping, fields: [...realFields], rows, warnings: warnings.slice(0, 200), errors: errors.slice(0, 200), autoCodes };
}
