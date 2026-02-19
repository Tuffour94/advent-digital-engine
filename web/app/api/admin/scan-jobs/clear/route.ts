import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  org_id: z.string().uuid(),
  mode: z.enum(["legacy-failures", "all"]).default("legacy-failures"),
});

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { org_id, mode } = parsed.data;

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

  // Find jobs to delete
  let q = admin.from("scan_jobs").select("id").eq("org_id", org_id);

  if (mode === "legacy-failures") {
    // Legacy failures = failed rows (often from old duplicate-key / RLS problems)
    q = q.eq("status", "failed");
  }

  const { data: jobs, error: jobsErr } = await q.limit(5000);
  if (jobsErr) return NextResponse.json({ error: jobsErr.message }, { status: 400 });

  const ids = (jobs ?? []).map((j: any) => j.id);
  if (ids.length === 0) return NextResponse.json({ ok: true, deleted_jobs: 0, deleted_artifacts: 0 });

  // Delete artifacts linked to those jobs
  const { error: artErr } = await admin.from("scan_artifacts").delete().in("job_id", ids);
  if (artErr) return NextResponse.json({ error: artErr.message }, { status: 400 });

  // Delete jobs
  const { error: delErr } = await admin.from("scan_jobs").delete().in("id", ids);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 400 });

  return NextResponse.json({ ok: true, deleted_jobs: ids.length });
}
