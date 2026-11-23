import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { GAP_STATUS, label } from "@/lib/labels";
import Flash from "@/components/flash";
import ActionForm, { type ActionValues } from "../action-form";

export const metadata: Metadata = { title: "Actividad" };

type Props = {
  params: Promise<{ id: string; actionId: string }>;
  searchParams: Promise<{ error?: string; ok?: string; back?: string; terminar?: string }>;
};

export default async function ActionPage({ params, searchParams }: Props) {
  const ctx = await requirePermission("plans.read");
  const { id, actionId } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id) || !/^[0-9a-f-]{36}$/.test(actionId)) notFound();
  const supabase = await createClient();
  const { data: action } = await supabase
    .from("actions")
    .select("*, requirement:requirements(clause, title, framework:frameworks(code)), gap_item:gap_items(id, assessment_id, status, justification)")
    .eq("id", actionId)
    .eq("plan_id", id)
    .maybeSingle();
  if (!action) notFound();
  const req = action.requirement as { clause: string; title: string; framework: { code: string } | null } | null;
  const gi = action.gap_item as { id: string; assessment_id: string; status: string | null; justification: string | null } | null;
  const back = sp.back && /^[\w=&%.-]*$/.test(sp.back) ? sp.back : "";

  return (
    <>
      <div className="head">
        <Link href={`/plan/${id}${back ? `?${back}` : ""}`} className="small">← Plan de trabajo</Link>
        <h1>{action.title as string}</h1>
        {req && (
          <p className="lead small">
            Requisito {req.framework?.code} {req.clause} · {req.title}
            {gi && (
              <> · Brecha: {label(GAP_STATUS, gi.status)}{ctx.can("gap.read") && <> · <Link href={`/gap/${gi.assessment_id}#r-${gi.id}`}>ver en el GAP</Link></>}</>
            )}
          </p>
        )}
      </div>
      <Flash error={sp.error} ok={sp.ok} />
      <section className="panel">
        <ActionForm planId={id} action={action as ActionValues} back={back} readOnly={!ctx.can("plans.write")} focusClose={sp.terminar === "1"} />
      </section>
    </>
  );
}
