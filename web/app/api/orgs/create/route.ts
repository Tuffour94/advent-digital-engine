import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  name: z.string().min(1),
  type: z.enum(["church", "conference", "institution"]),
  timezone: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid body", details: parsed.error.flatten() }, { status: 400 });
  }

  const { name, type, timezone } = parsed.data;

  const { data: org, error: orgErr } = await supabase
    .from("organizations")
    .insert({ name: name.trim(), type, timezone: (timezone ?? "").trim() || null })
    .select("id")
    .maybeSingle();

  if (orgErr) return NextResponse.json({ error: orgErr.message }, { status: 400 });
  if (!org?.id) return NextResponse.json({ error: "Org insert returned no id" }, { status: 500 });

  const { error: memErr } = await supabase.from("org_members").insert({
    org_id: org.id,
    user_id: user.id,
    role: "owner",
  });

  if (memErr) return NextResponse.json({ error: memErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, org_id: org.id });
}
