import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const next = url.searchParams.get("next") || "/";

  const supabase = await createSupabaseServerClient();
  await supabase.auth.getUser();

  return NextResponse.redirect(new URL(next, url.origin));
}
