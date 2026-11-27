// Etiquetas en español para los valores codificados de la base.

export const UNIT_TYPES = { sede: "Sede", sucursal: "Sucursal", tienda: "Tienda", area: "Área", otra: "Otra" } as const;
export const PROCESS_TYPES = { estrategico: "Estratégico", misional: "Misional", apoyo: "Apoyo", evaluacion: "Evaluación" } as const;
/** Lugar del proceso en la jerarquía del listado maestro. */
export const PROCESS_TYPOLOGY = { macroproceso: "Macroproceso", proceso: "Proceso", subproceso: "Subproceso" } as const;
export const ASSET_STATUS = {
  activo: "Activo",
  en_reparacion: "En reparación",
  dado_de_baja: "Dado de baja",
  perdido: "Perdido o hurtado",
} as const;
export const LEVELS = { 1: "Bajo", 2: "Medio", 3: "Alto" } as const;
/** Criticidad de requisitos (1-3). */
export const CRITICALITY = { 1: "Baja", 2: "Media", 3: "Alta" } as const;
/** Criticidad de activos: mayor valor de C-I-D en escala 1-5. */
export const ASSET_CRITICALITY = { 1: "Muy baja", 2: "Baja", 3: "Media", 4: "Alta", 5: "Muy alta" } as const;
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
export const RATINGS = { 1: "Débil", 2: "Moderado", 3: "Fuerte" } as const;
export const DOCUMENTATION = { documentado: "Documentado", sin_documentar: "Sin documentar" } as const;
export const EVIDENCE = { con_registro: "Con registro", sin_registro: "Sin registro" } as const;
/** Tipologías documentales del listado maestro (las de proceso están en PROCESS_TYPOLOGY). */
export const DOC_TYPES = {
  anexo: "Anexo",
  diagrama: "Diagrama",
  elearning: "E-learning",
  entorno: "Entorno empresarial",
  formato: "Formato",
  infografia: "Infografía",
  instructivo: "Instructivo",
  manual: "Manual",
  manual_rpa: "Manual de usuario RPA",
  matriz: "Matriz de riesgo",
  modelamiento: "Modelamiento",
  plan: "Plan",
  politica: "Política",
  presentacion: "Presentaciones",
  procedimiento: "Procedimiento",
  programa: "Programa",
  protocolo: "Protocolo",
  registro: "Registro",
  reglamento: "Reglamento",
  video: "Videos",
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

/** Clase de color para la escala 1-5 de activos. */
export function level5Tone(level: number | null | undefined): string {
  if (!level) return "";
  if (level >= 4) return "crit";
  if (level === 3) return "warn";
  return "good";
}

export function keysOf<T extends Record<string, string>>(map: T): (keyof T & string)[] {
  return Object.keys(map) as (keyof T & string)[];
}

// --- Diagnóstico GAP y planes ---------------------------------------
export const GAP_STATUS = {
  cumple: "Cumple",
  parcial: "Cumple parcial",
  no_cumple: "No cumple",
  no_aplica: "No aplica",
} as const;
export const GAP_ASSESSMENT_STATUS = { en_curso: "En curso", cerrado: "Cerrado" } as const;
export const PRIORITY = { alta: "Alta", media: "Media", baja: "Baja" } as const;
export const ACTION_STATUS = {
  pendiente: "Pendiente",
  en_curso: "En curso",
  terminada: "Terminada",
  cancelada: "Cancelada",
} as const;
export const PLAN_ORIGIN = {
  gap: "Diagnóstico GAP",
  auditoria: "Auditoría",
  riesgo: "Riesgos",
  tercero: "Terceros",
  direccion: "Revisión por la dirección",
  otro: "Otro",
} as const;

export function gapTone(status: string | null | undefined): string {
  if (status === "cumple") return "good";
  if (status === "parcial") return "warn";
  if (status === "no_cumple") return "crit";
  return "";
}

export function priorityTone(p: string | null | undefined): string {
  return p === "alta" ? "crit" : p === "media" ? "warn" : p === "baja" ? "good" : "";
}
