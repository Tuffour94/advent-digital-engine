import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  org_id: z.string().uuid(),
  // delete artifacts older than this artifact_version (inclusive: keep >=)
  keep_artifact_version: z.number().int().min(1),
});

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { org_id, keep_artifact_version } = parsed.data;

  // Authorization: require org owner/admin via RLS check on org_members
  const { data: membership } = await supabase
    .from("org_members")
    .select("role")
    .eq("org_id", org_id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership?.role || !["owner", "admin"].includes(membership.role)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createSupabaseAdminClient();

  // Delete old artifacts for this org (version < keep_artifact_version)
  const { error } = await admin
    .from("scan_artifacts")
    .delete()
    .eq("org_id", org_id)
    .lt("version", keep_artifact_version);

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ ok: true });
}
