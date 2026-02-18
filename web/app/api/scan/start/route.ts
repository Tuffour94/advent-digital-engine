import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  org_id: z.string().uuid(),
  website_url: z.string().min(1),
  youtube_url: z.string().optional().nullable(),
  facebook_url: z.string().optional().nullable(),
});

function sha256(input: string) {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require("crypto").createHash("sha256").update(input).digest("hex");
}

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { org_id, website_url, youtube_url, facebook_url } = parsed.data;
  const inputs = {
    website_url: website_url.trim(),
    youtube_url: (youtube_url ?? "").trim() || null,
    facebook_url: (facebook_url ?? "").trim() || null,
  };
  const input_hash = sha256(JSON.stringify(inputs));

  const admin = createSupabaseAdminClient();

  // Cache check
  const { data: cached } = await admin
    .from("scan_artifacts")
    .select("id")
    .eq("org_id", org_id)
    .eq("artifact_type", "auditor.score")
    .eq("input_hash", input_hash)
    .limit(1)
    .maybeSingle();

  const cache_hit = Boolean(cached?.id);

  const { data: job, error: jobErr } = await admin
    .from("scan_jobs")
    .insert({
      org_id,
      requested_by: user.id,
      status: cache_hit ? "succeeded" : "queued",
      inputs,
      cache_hit,
      used_ai: false,
      estimated_token_cost: 0,
      actual_token_cost: 0,
      filter_stage: cache_hit ? "cache" : "queue",
    })
    .select("id,status,cache_hit,used_ai,actual_token_cost,created_at")
    .maybeSingle();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 400 });
  if (!job?.id) return NextResponse.json({ error: "Job insert returned no id" }, { status: 500 });

  // Stub artifacts if not cache-hit (Phase 1 scaffold)
  if (!cache_hit) {
    await admin.from("scan_artifacts").insert({
      org_id,
      job_id: job.id,
      artifact_type: "auditor.score",
      input_hash,
      version: 1,
      data: {
        ekklesiaScore: 0,
        grade: "F",
        note: "Worker not implemented yet (scaffold).",
        inputs,
      },
    });

    await admin
      .from("scan_jobs")
      .update({ status: "succeeded", filter_stage: "stub", finished_at: new Date().toISOString() })
      .eq("id", job.id);
  }

  return NextResponse.json({ ok: true, job });
}
