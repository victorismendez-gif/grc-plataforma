import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requirePermission } from "@/lib/auth";
import Flash from "@/components/flash";
import ActionForm from "../action-form";

export const metadata: Metadata = { title: "Nueva actividad" };

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ error?: string; ok?: string }> };

export default async function NewActionPage({ params, searchParams }: Props) {
  await requirePermission("plans.write");
  const { id } = await params;
  const sp = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  return (
    <>
      <div className="head">
        <Link href={`/plan/${id}`} className="small">← Plan de trabajo</Link>
        <h1>Nueva actividad</h1>
      </div>
      <Flash {...sp} />
      <section className="panel"><ActionForm planId={id} /></section>
    </>
  );
}
