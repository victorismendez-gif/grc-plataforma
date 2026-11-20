// Perfil de cada tipo de activo: identificador único y campos visibles.
// La configuración vive en catalog_items.settings (parametrizable por
// organización); aquí están los tipos, el orden canónico y los valores
// por defecto. Código puro: lo usan el formulario, el importador y la plantilla.

export type IdentifierKind = "placa" | "imei" | "serial" | "documento" | "etiqueta";

export type AssetTypeSettings = {
  identifier: { kind: IdentifierKind; label: string; required: boolean };
  fields: OptionalField[];
  name_label?: string;
};

/** Campos opcionales por tipo, en el orden en que se muestran. */
export const OPTIONAL_FIELDS = [
  "name",
  "ip_address",
  "status",
  "brand",
  "model",
  "operating_system",
  "serial_number",
  "owner_id",
  "custodian",
  "custodian_email",
  "location",
  "acquired_on",
  "description",
] as const;
export type OptionalField = (typeof OPTIONAL_FIELDS)[number];

export const FIELD_LABELS: Record<OptionalField | "code" | "asset_type_id" | "classification_id" | "confidentiality" | "integrity" | "availability", string> = {
  code: "Identificador",
  asset_type_id: "Tipo de activo",
  name: "Nombre del activo",
  ip_address: "IP",
  status: "Estado",
  brand: "Marca",
  model: "Modelo",
  operating_system: "Sistema operativo",
  serial_number: "Serial",
  owner_id: "Responsable",
  custodian: "Custodio",
  custodian_email: "Correo custodio",
  location: "Ubicación",
  acquired_on: "Fecha de adquisición",
  description: "Descripción",
  classification_id: "Clasificación de la información",
  confidentiality: "Confidencialidad",
  integrity: "Integridad",
  availability: "Disponibilidad",
};

export const IDENTIFIER_KINDS: Record<IdentifierKind, string> = {
  placa: "Placa",
  imei: "IMEI",
  serial: "Serial",
  documento: "Documento de identidad",
  etiqueta: "Etiqueta o número",
};

export const NAME_MAX = 80;

const GENERIC: AssetTypeSettings = {
  identifier: { kind: "etiqueta", label: "Etiqueta o número", required: false },
  fields: ["name", "status", "owner_id", "custodian", "custodian_email", "location", "description"],
};

/** Normaliza la configuración guardada (tolera valores incompletos o antiguos). */
export function readSettings(raw: unknown): AssetTypeSettings {
  const s = (raw && typeof raw === "object" ? raw : {}) as Partial<AssetTypeSettings>;
  const kind = s.identifier?.kind && s.identifier.kind in IDENTIFIER_KINDS ? s.identifier.kind : GENERIC.identifier.kind;
  const fields = Array.isArray(s.fields)
    ? OPTIONAL_FIELDS.filter((f) => (s.fields as string[]).includes(f))
    : GENERIC.fields;
  return {
    identifier: {
      kind,
      label: (s.identifier?.label || IDENTIFIER_KINDS[kind]).slice(0, 40),
      required: s.identifier?.required ?? kind !== "etiqueta",
    },
    fields,
    name_label: s.name_label?.slice(0, 40) || undefined,
  };
}

export function fieldLabel(field: OptionalField, settings: AssetTypeSettings): string {
  if (field === "name" && settings.name_label) return settings.name_label;
  return FIELD_LABELS[field];
}

export type ScaleLevel = { dimension: "confidentiality" | "integrity" | "availability"; level: number; label: string; description: string | null };

export const DIMENSIONS = {
  confidentiality: "Confidencialidad",
  integrity: "Integridad",
  availability: "Disponibilidad",
} as const;

/** Valida un correo electrónico (mismo criterio que la base de datos). */
export function isEmail(value: string): boolean {
  return value.length <= 200 && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value.trim());
}

/** Valida una dirección IPv4 o IPv6 (sin máscara). */
export function isIp(value: string): boolean {
  const v = value.trim();
  const v4 = v.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return v4.slice(1).every((n) => Number(n) <= 255);
  return /^[0-9a-f:]+$/i.test(v) && v.includes(":") && v.split(":").length <= 8;
}
