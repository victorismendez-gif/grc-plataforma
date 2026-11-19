import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/permissions";

const migrationsDir = path.resolve(__dirname, "../supabase/migrations");

function permissionCodesInMigrations(): string[] {
  const sql = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(path.join(migrationsDir, f), "utf8"))
    .join("\n");
  const block = sql.split("insert into public.permissions").slice(1);
  const codes = new Set<string>();
  for (const b of block) {
    const values = b.split(";")[0];
    for (const m of values.matchAll(/\(\s*'([a-z_]+\.[a-z_]+)'/g)) codes.add(m[1]);
  }
  return [...codes].sort();
}

describe("catálogo de permisos", () => {
  it("coincide entre la aplicación y la base de datos", () => {
    expect([...PERMISSIONS].sort()).toEqual(permissionCodesInMigrations());
  });

  it("no tiene códigos repetidos", () => {
    expect(new Set(PERMISSIONS).size).toBe(PERMISSIONS.length);
  });
});
