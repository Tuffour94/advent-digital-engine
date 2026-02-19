import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scoutWebsite } from "@/lib/scout";
import { auditorFromScout } from "@/lib/auditor";

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

  const ARTIFACT_VERSION = 2;

  // Cache check: require BOTH scout.report and auditor.score (versioned)
  const { data: cachedScout } = await admin
    .from("scan_artifacts")
    .select("id,version")
    .eq("org_id", org_id)
    .eq("artifact_type", "scout.report")
    .eq("input_hash", input_hash)
    .eq("version", ARTIFACT_VERSION)
    .limit(1)
    .maybeSingle();

  const { data: cachedAuditor } = await admin
    .from("scan_artifacts")
    .select("id,version")
    .eq("org_id", org_id)
    .eq("artifact_type", "auditor.score")
    .eq("input_hash", input_hash)
    .eq("version", ARTIFACT_VERSION)
    .limit(1)
    .maybeSingle();

  const cache_hit = Boolean(cachedScout?.id && cachedAuditor?.id);

  // Create job in running state.
  const { data: job, error: jobErr } = await admin
    .from("scan_jobs")
    .insert({
      org_id,
      requested_by: user.id,
      status: "running",
      inputs,
      cache_hit,
      used_ai: false,
      estimated_token_cost: 0,
      actual_token_cost: 0,
      filter_stage: cache_hit ? "cache" : "scout",
      started_at: new Date().toISOString(),
    })
    .select("id,status,cache_hit,used_ai,actual_token_cost,created_at")
    .maybeSingle();

  if (jobErr) return NextResponse.json({ error: jobErr.message }, { status: 400 });
  if (!job?.id) return NextResponse.json({ error: "Job insert returned no id" }, { status: 500 });

  try {
    if (cache_hit) {
      // No duplicate analysis. Mark succeeded immediately.
      await admin
        .from("scan_jobs")
        .update({ status: "succeeded", filter_stage: "cache", finished_at: new Date().toISOString() })
        .eq("id", job.id);

      return NextResponse.json({ ok: true, job: { ...job, status: "succeeded", cache_hit: true } });
    }

    // 1) Scout
    const scout = await scoutWebsite(inputs.website_url);
    const scoutArtifact = {
      org_id,
      job_id: job.id,
      artifact_type: "scout.report",
      input_hash,
      version: ARTIFACT_VERSION,
      data: {
        inputs,
        fetched_at: new Date().toISOString(),
        html_length: scout.html_length,
        signals: scout.signals,
      },
    };

    const { error: scoutErr } = await admin
      .from("scan_artifacts")
      .upsert(scoutArtifact, { onConflict: "org_id,artifact_type,input_hash,version" });
    if (scoutErr) throw new Error(`Failed to write scout.report: ${scoutErr.message}`);

    // 2) Auditor
    const score = auditorFromScout(scout.signals);
    const auditorArtifact = {
      org_id,
      job_id: job.id,
      artifact_type: "auditor.score",
      input_hash,
      version: ARTIFACT_VERSION,
      data: {
        ...score,
        inputs,
        computed_at: new Date().toISOString(),
      },
    };

    const { error: auditorErr } = await admin
      .from("scan_artifacts")
      .upsert(auditorArtifact, { onConflict: "org_id,artifact_type,input_hash,version" });
    if (auditorErr) throw new Error(`Failed to write auditor.score: ${auditorErr.message}`);

    // Integrity check: verify both artifacts exist (versioned)
    const { data: scoutOk } = await admin
      .from("scan_artifacts")
      .select("id")
      .eq("org_id", org_id)
      .eq("artifact_type", "scout.report")
      .eq("input_hash", input_hash)
      .eq("version", ARTIFACT_VERSION)
      .limit(1)
      .maybeSingle();

    const { data: auditorOk } = await admin
      .from("scan_artifacts")
      .select("id")
      .eq("org_id", org_id)
      .eq("artifact_type", "auditor.score")
      .eq("input_hash", input_hash)
      .eq("version", ARTIFACT_VERSION)
      .limit(1)
      .maybeSingle();

    if (!scoutOk?.id || !auditorOk?.id) {
      throw new Error("Integrity failure: missing scout.report or auditor.score");
    }

    await admin
      .from("scan_jobs")
      .update({ status: "succeeded", filter_stage: cache_hit ? "cache" : "auditor", finished_at: new Date().toISOString() })
      .eq("id", job.id);

    return NextResponse.json({ ok: true, job: { ...job, status: "succeeded", cache_hit } });
  } catch (e: any) {
    const message = e?.message ?? "Scan failed";
    await admin
      .from("scan_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", job.id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
