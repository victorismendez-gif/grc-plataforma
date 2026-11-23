import type { Metadata } from "next";
import Link from "next/link";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { getPeople, getProcesses, getUnits } from "@/lib/lookups";
import Flash, { type FlashParams } from "@/components/flash";
import ComboField from "@/components/combo-field";
import { createGap } from "../actions";

export const metadata: Metadata = { title: "Nuevo diagnóstico GAP" };

export default async function NewGapPage({ searchParams }: { searchParams: FlashParams }) {
  const ctx = await requirePermission("gap.write");
  const sp = await searchParams;
  const supabase = await createClient();
  const [{ data: fws }, units, processes, people] = await Promise.all([
    supabase.from("frameworks").select("id, code, name, version, requirements(count)").eq("active", true).order("code"),
    getUnits(),
    getProcesses(),
    getPeople(),
  ]);
  const frameworks = (fws ?? []) as unknown as { id: string; code: string; name: string; version: string; requirements: { count: number }[] }[];
  const me = people.find((p) => p.id === ctx.userId)?.label ?? "";

  return (
    <>
      <div className="head">
        <Link href="/gap" className="small">← Diagnóstico GAP</Link>
        <h1>Nuevo diagnóstico</h1>
        <p className="lead">Elige las normas y el alcance. Se crea un ítem por cada requisito auditable; los requisitos comunes entre normas se califican una sola vez.</p>
      </div>
      <Flash {...sp} />
      {!frameworks.length ? (
        <section className="panel">
          <p>No hay normas activas. Ve a <Link href="/normas">Normas</Link> y carga la estructura de ISO/IEC 27001 o importa tus requisitos.</p>
        </section>
      ) : (
        <form action={createGap} className="stack">
          <section className="panel">
            <div className="form-grid">
              <label className="span-2">
                Nombre del diagnóstico *
                <input name="name" required minLength={3} maxLength={160} placeholder="Ej.: Diagnóstico inicial SGSI 2026" />
              </label>
              <ComboField name="leader" label="Líder del diagnóstico" value={me} options={people} placeholder="Elige o escribe un nombre" />
            </div>
          </section>
          <fieldset className="form-section">
            <legend>Normas *</legend>
            <div className="stack" style={{ gap: 6 }}>
              {frameworks.map((f) => (
                <label key={f.id} className="row" style={{ gap: 8, fontWeight: 400 }}>
                  <input type="checkbox" name="framework_ids" value={f.id} defaultChecked={frameworks.length === 1} />
                  <span><b>{f.code}</b> {f.name} {f.version} <span className="muted small">· {f.requirements?.[0]?.count ?? 0} requisitos</span></span>
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="form-section">
            <legend>Alcance</legend>
            <div className="form-grid">
              <label className="span-all">
                Descripción del alcance
                <textarea name="scope_description" rows={2} maxLength={4000} placeholder="Ej.: Procesos de TI de la sede principal" />
              </label>
              {units.length > 0 && (
                <label>
                  Sedes y áreas
                  <select name="unit_ids" multiple size={Math.min(8, units.length)}>
                    {units.map((u) => <option key={u.id} value={u.id}>{"  ".repeat(u.depth)}{u.label}</option>)}
                  </select>
                  <span className="field-hint">Ctrl + clic para elegir varias.</span>
                </label>
              )}
              {processes.length > 0 && (
                <label>
                  Procesos
                  <select name="process_ids" multiple size={Math.min(8, processes.length)}>
                    {processes.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                  <span className="field-hint">Ctrl + clic para elegir varios.</span>
                </label>
              )}
            </div>
          </fieldset>
          <div><button type="submit">Crear diagnóstico</button></div>
        </form>
      )}
    </>
  );
}
