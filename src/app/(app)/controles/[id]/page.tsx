import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import Flash from "@/components/flash";
import ControlForm, { type ControlData } from "../control-form";
import { linkAssets, linkRequirement, unlinkAsset, unlinkRequirement, updateControl } from "../actions";

export const metadata: Metadata = { title: "Control" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };
type ReqRow = { id: string; clause: string; title: string; framework_id: string; is_auditable: boolean };

export default async function ControlPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("controls.read");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const supabase = await createClient();
  const { data: control } = await supabase.from("controls").select("*").eq("id", id).maybeSingle();
  if (!control) notFound();
  const canWrite = ctx.can("controls.write");
  const [{ data: links }, { data: assetLinks }, { data: frameworks }, { data: reqs }] = await Promise.all([
    supabase.from("control_requirements").select("requirement:requirements(id, clause, title, framework_id)").eq("control_id", id),
    supabase.from("control_assets").select("asset:assets(id, code, name)").eq("control_id", id),
    supabase.from("frameworks").select("id, code, name").eq("active", true).order("name"),
    canWrite
      ? supabase.from("requirements").select("id, clause, title, framework_id, is_auditable").eq("is_auditable", true).order("sort_key").limit(3000)
      : Promise.resolve({ data: [] as ReqRow[] }),
  ]);
  const fwName = new Map((frameworks ?? []).map((f) => [f.id as string, f.code as string]));
  const linked = ((links ?? []).map((l) => l.requirement) as unknown as ReqRow[]).filter(Boolean);
  const linkedIds = new Set(linked.map((r) => r.id));
  const assets = ((assetLinks ?? []).map((l) => l.asset) as unknown as { id: string; code: string; name: string }[]).filter(Boolean);
  const available = ((reqs ?? []) as ReqRow[]).filter((r) => !linkedIds.has(r.id));

  return (
    <>
      <div className="head">
        <Link href="/controles" className="small">← Controles</Link>
        <h1><span className="mono">{control.code}</span> · {control.name}</h1>
      </div>
      <Flash {...sp} />
      <section className="panel">
        <ControlForm control={control as ControlData} action={updateControl} readOnly={!canWrite} />
      </section>

      <div className="grid2">
        <section className="panel">
          <h2>Requisitos que cumple ({linked.length})</h2>
          <p className="small muted">Mapeo cruzado: el mismo control y su evidencia sirven para varias normas.</p>
          <table>
            <tbody>
              {linked.map((r) => (
                <tr key={r.id}>
                  <td className="mono small">{fwName.get(r.framework_id)} {r.clause}</td>
                  <td className="small">{r.title}</td>
                  {canWrite && (
                    <td>
                      <form action={unlinkRequirement}>
                        <input type="hidden" name="control_id" value={id} />
                        <input type="hidden" name="requirement_id" value={r.id} />
                        <button type="submit" className="link small" aria-label={`Quitar ${r.clause}`}>Quitar</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {linked.length === 0 && <tr><td className="muted small">Sin requisitos asociados.</td></tr>}
            </tbody>
          </table>
          {canWrite && available.length > 0 && (
            <form action={linkRequirement} className="stack">
              <input type="hidden" name="control_id" value={id} />
              <label>
                Agregar requisitos (Ctrl o Cmd para elegir varios)
                <select name="requirement_id" multiple size={8}>
                  {(frameworks ?? []).map((f) => (
                    <optgroup key={f.id as string} label={f.name as string}>
                      {available.filter((r) => r.framework_id === f.id).map((r) => (
                        <option key={r.id} value={r.id}>{r.clause} · {r.title}</option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <div><button type="submit">Asociar</button></div>
            </form>
          )}
        </section>

        <section className="panel">
          <h2>Activos que protege ({assets.length})</h2>
          <table>
            <tbody>
              {assets.map((a) => (
                <tr key={a.id}>
                  <td className="mono small"><Link href={`/activos/${a.id}`}>{a.code}</Link></td>
                  <td className="small">{a.name}</td>
                  {canWrite && (
                    <td>
                      <form action={unlinkAsset}>
                        <input type="hidden" name="control_id" value={id} />
                        <input type="hidden" name="asset_id" value={a.id} />
                        <button type="submit" className="link small" aria-label={`Quitar ${a.code}`}>Quitar</button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
              {assets.length === 0 && <tr><td className="muted small">Sin activos asociados.</td></tr>}
            </tbody>
          </table>
          {canWrite && (
            <form action={linkAssets} className="stack">
              <input type="hidden" name="control_id" value={id} />
              <label>
                Códigos de activos (separados por coma, espacio o salto de línea)
                <textarea name="codes" rows={3} placeholder="PC-001, PC-002" />
              </label>
              <div><button type="submit">Asociar activos</button></div>
            </form>
          )}
        </section>
      </div>
    </>
  );
}
