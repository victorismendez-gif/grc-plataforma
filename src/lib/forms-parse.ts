// Lectura tipada de campos de formulario en acciones de servidor.
import { z } from "zod";

const uuid = z.string().uuid();

export function optUuid(fd: FormData, key: string): string | null {
  const v = fd.get(key)?.toString().trim();
  if (!v) return null;
  return uuid.safeParse(v).success ? v : null;
}

export function optText(fd: FormData, key: string, max = 2000): string | null {
  const v = fd.get(key)?.toString().trim();
  return v ? v.slice(0, max) : null;
}

export function optLevel(fd: FormData, key: string): number | null {
  const v = Number(fd.get(key));
  return v === 1 || v === 2 || v === 3 ? v : null;
}

export function optInt(fd: FormData, key: string, min = 0, max = 1_000_000): number | null {
  const raw = fd.get(key)?.toString().trim();
  if (!raw) return null;
  const v = Number.parseInt(raw, 10);
  return Number.isFinite(v) && v >= min && v <= max ? v : null;
}

export function optDate(fd: FormData, key: string): string | null {
  const v = fd.get(key)?.toString().trim();
  return v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null;
}

export function oneOf<T extends string>(fd: FormData, key: string, allowed: readonly T[], fallback: T): T {
  const v = fd.get(key)?.toString() as T;
  return allowed.includes(v) ? v : fallback;
}

export function isUuid(v: unknown): v is string {
  return typeof v === "string" && uuid.safeParse(v).success;
}
