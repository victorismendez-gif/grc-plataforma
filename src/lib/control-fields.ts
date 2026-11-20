// Campos del módulo de controles: orden, etiquetas, valores permitidos y
// explicación (la usan el formulario, el importador y la plantilla).
import {
  CONTROL_NATURE,
  CONTROL_TYPES,
  DOCUMENTATION,
  EVIDENCE,
  FREQUENCIES,
  IMPLEMENTATION,
  RATINGS,
} from "@/lib/labels";

export type ControlField =
  | "code" | "name" | "description" | "owner" | "process" | "control_type" | "nature" | "frequency"
  | "documentation" | "evidence" | "design_rating" | "application_rating" | "effectiveness_rating"
  | "implementation_status";

type Def = {
  field: ControlField;
  header: string;
  required: boolean;
  help: string;
  options?: Record<string | number, string>;
  definitions?: Record<string, string>;
  width: number;
};

/** Orden solicitado: ID, Control, Descripción, Responsable, Proceso, Tipo, Clase, Periodicidad,
 *  Documentación, Evidencia, Diseño, Aplicación, Efectividad, Estado. */
export const CONTROL_FIELDS: Def[] = [
  { field: "code", header: "ID", required: true, width: 14,
    help: "Identificador único del control. Es la llave que lo reconoce entre una carga y la siguiente. Letras, números, punto, guion o guion bajo, sin espacios (máx. 30)." },
  { field: "name", header: "Control", required: true, width: 34, help: "Nombre corto del control (2 a 200 caracteres)." },
  { field: "description", header: "Descripción", required: false, width: 48,
    help: "Qué se hace, quién lo hace, cómo y con qué frecuencia, y qué pasa cuando se detecta una desviación." },
  { field: "owner", header: "Responsable", required: false, width: 28,
    help: "Correo o nombre del responsable. Si es usuario de la plataforma se enlaza a su cuenta; si no, se guarda el texto." },
  { field: "process", header: "Proceso", required: false, width: 26,
    help: "Proceso al que pertenece el control. Si no existe en la plataforma, se crea en Estructura." },
  { field: "control_type", header: "Tipo", required: true, width: 14, options: CONTROL_TYPES,
    help: "Momento en que actúa el control frente al riesgo.",
    definitions: {
      Preventivo: "Actúa antes de que el riesgo se materialice, sobre sus causas.",
      Detectivo: "Identifica el evento mientras ocurre o poco después.",
      Correctivo: "Reduce el impacto una vez el riesgo se materializó.",
    } },
  { field: "nature", header: "Clase", required: true, width: 16, options: CONTROL_NATURE,
    help: "Forma de ejecución del control.",
    definitions: {
      Manual: "Lo ejecuta una persona.",
      Automático: "Lo ejecuta un sistema sin intervención humana.",
      Semiautomático: "Combina la ejecución de un sistema y de una persona.",
    } },
  { field: "frequency", header: "Periodicidad", required: true, width: 15, options: FREQUENCIES,
    help: "Cada cuánto se ejecuta el control." },
  { field: "documentation", header: "Documentación", required: false, width: 16, options: DOCUMENTATION,
    help: "Si el control está descrito en un documento aprobado.",
    definitions: {
      Documentado: "Está descrito en un procedimiento, política u otro documento aprobado.",
      "Sin documentar": "Se ejecuta pero no está descrito en un documento aprobado.",
    } },
  { field: "evidence", header: "Evidencia", required: false, width: 15, options: EVIDENCE,
    help: "Si la ejecución del control deja un registro verificable.",
    definitions: {
      "Con registro": "Deja evidencia verificable de cada ejecución (acta, reporte, log, firma).",
      "Sin registro": "No deja evidencia de su ejecución.",
    } },
  { field: "design_rating", header: "Diseño", required: false, width: 12, options: RATINGS,
    help: "Qué tan bien está diseñado el control para mitigar el riesgo.",
    definitions: { Fuerte: "Cubre la causa del riesgo de forma suficiente.", Moderado: "La cubre parcialmente.", Débil: "No la cubre o tiene vacíos importantes." } },
  { field: "application_rating", header: "Aplicación", required: false, width: 12, options: RATINGS,
    help: "Qué tan consistentemente se ejecuta el control como fue diseñado.",
    definitions: { Fuerte: "Se ejecuta siempre como está diseñado.", Moderado: "Se ejecuta con algunas fallas u omisiones.", Débil: "No se ejecuta o se ejecuta de forma esporádica." } },
  { field: "effectiveness_rating", header: "Efectividad", required: false, width: 12, options: RATINGS,
    help: "Resultado del control frente al riesgo. Si se deja vacía y hay diseño y aplicación, se toma el menor de los dos." },
  { field: "implementation_status", header: "Estado", required: false, width: 18, options: IMPLEMENTATION,
    help: "Situación del control. Vacío = Planeado." },
];

export const CONTROL_CODE_RE = /^[A-Za-z0-9._-]{1,30}$/;

/** Efectividad por defecto: el menor entre diseño y aplicación. */
export function defaultEffectiveness(design: number | null, application: number | null, effectiveness: number | null): number | null {
  if (effectiveness) return effectiveness;
  if (design && application) return Math.min(design, application);
  return null;
}
