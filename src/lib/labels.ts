// Etiquetas en español para los valores codificados de la base.

export const UNIT_TYPES = { sede: "Sede", sucursal: "Sucursal", tienda: "Tienda", area: "Área", otra: "Otra" } as const;
export const PROCESS_TYPES = { estrategico: "Estratégico", misional: "Misional", apoyo: "Apoyo", evaluacion: "Evaluación" } as const;
export const ASSET_STATUS = {
  activo: "Activo",
  en_reparacion: "En reparación",
  dado_de_baja: "Dado de baja",
  perdido: "Perdido o hurtado",
} as const;
export const LEVELS = { 1: "Bajo", 2: "Medio", 3: "Alto" } as const;
export const CRITICALITY = { 1: "Baja", 2: "Media", 3: "Alta" } as const;
export const FRAMEWORK_TYPES = {
  certificable: "Certificable",
  referencia: "Marco de referencia",
  legal: "Requisito legal",
  interno: "Interno",
} as const;
export const CONTROL_TYPES = { preventivo: "Preventivo", detectivo: "Detectivo", correctivo: "Correctivo" } as const;
export const CONTROL_NATURE = { manual: "Manual", automatico: "Automático", semiautomatico: "Semiautomático" } as const;
export const FREQUENCIES = {
  continuo: "Continuo",
  diario: "Diario",
  semanal: "Semanal",
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  por_evento: "Por evento",
} as const;
export const IMPLEMENTATION = {
  planeado: "Planeado",
  en_implementacion: "En implementación",
  implementado: "Implementado",
  no_aplica: "No aplica",
} as const;
export const RATINGS = { 1: "Deficiente", 2: "Aceptable", 3: "Fuerte" } as const;
export const DOC_TYPES = {
  politica: "Política",
  manual: "Manual",
  procedimiento: "Procedimiento",
  instructivo: "Instructivo",
  formato: "Formato",
  plan: "Plan",
  registro: "Registro",
  otro: "Otro",
} as const;
export const VERSION_STATUS = {
  borrador: "Borrador",
  en_revision: "En revisión",
  revisado: "Revisado",
  aprobado: "Aprobado",
  publicado: "Vigente",
  obsoleto: "Obsoleto",
} as const;

export function label<T extends Record<string | number, string>>(map: T, key: unknown): string {
  if (key === null || key === undefined || key === "") return "—";
  return (map as Record<string, string>)[String(key)] ?? String(key);
}

/** Clase de color para niveles 1-3 (bajo = verde, alto = rojo). */
export function levelTone(level: number | null | undefined): string {
  if (level === 3) return "crit";
  if (level === 2) return "warn";
  if (level === 1) return "good";
  return "";
}

export function keysOf<T extends Record<string, string>>(map: T): (keyof T & string)[] {
  return Object.keys(map) as (keyof T & string)[];
}
