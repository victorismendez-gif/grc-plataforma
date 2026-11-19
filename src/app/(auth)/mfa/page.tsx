import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getSessionState } from "@/lib/auth";
import { safeNext } from "@/lib/env";
import MfaClient from "./mfa-client";

export const metadata: Metadata = { title: "Doble factor" };

type Props = { searchParams: Promise<{ next?: string }> };

export default async function MfaPage({ searchParams }: Props) {
  const sp = await searchParams;
  const next = safeNext(sp.next);
  const state = await getSessionState();
  if (state.status === "anon") redirect("/login");
  if (state.status === "ok") redirect(next);
  return (
    <div className="auth">
      <div className="card">
        <MfaClient next={next} />
      </div>
    </div>
  );
}
