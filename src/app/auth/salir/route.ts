import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createClient();
  await supabase.rpc("log_event", { p_action: "LOGOUT", p_detail: {} });
  await supabase.auth.signOut();
  return NextResponse.redirect(new URL("/login?salida=1", request.nextUrl.origin), { status: 303 });
}
