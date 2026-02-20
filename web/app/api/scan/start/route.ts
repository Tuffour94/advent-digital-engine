import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { createSupabaseAdminClient } from "@/lib/supabase/admin";
import { scoutWebsiteV2 } from "@/lib/scout";
import { auditorFromScoutV2 } from "@/lib/auditor";
import { scanInputHash, normalizeInputs, SCOUT_VERSION, AUDITOR_VERSION, REPORT_SCHEMA_VERSION } from "@/lib/scanKey";

export const dynamic = "force-dynamic";

const BodySchema = z.object({
  org_id: z.string().uuid(),
  website_url: z.string().min(1),
  youtube_url: z.string().optional().nullable(),
  facebook_url: z.string().optional().nullable(),
});

export async function POST(req: Request) {
  const supabase = await createSupabaseServerClient();
  const { data: userData } = await supabase.auth.getUser();
  const user = userData.user;
  if (!user) return NextResponse.json({ error: "Not authenticated" }, { status: 401 });

  const json = await req.json().catch(() => null);
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return NextResponse.json({ error: "Invalid body" }, { status: 400 });

  const { org_id, website_url, youtube_url, facebook_url } = parsed.data;

  const inputs = normalizeInputs({ website_url, youtube_url, facebook_url });

  // IMPORTANT: cache key includes schema + scout/auditor versions so new report schema forces fresh artifacts.
  const input_hash = scanInputHash(inputs);

  const jobInputs = {
    ...inputs,
    _meta: {
      report_schema_version: REPORT_SCHEMA_VERSION,
      scout_version: SCOUT_VERSION,
      auditor_version: AUDITOR_VERSION,
      input_hash,
    },
  };

  const admin = createSupabaseAdminClient();

  const ARTIFACT_VERSION = 3;
  const code_commit = process.env.VERCEL_GIT_COMMIT_SHA ?? null;

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

  let cache_hit = Boolean(cachedScout?.id && cachedAuditor?.id);

  // If cache artifacts exist but are missing required fields, do NOT reuse cache.
  if (cache_hit) {
    const { data: cachedAuditorArtifact } = await admin
      .from("scan_artifacts")
      .select("data")
      .eq("org_id", org_id)
      .eq("artifact_type", "auditor.score")
      .eq("input_hash", input_hash)
      .eq("version", ARTIFACT_VERSION)
      .limit(1)
      .maybeSingle();

    const d: any = cachedAuditorArtifact?.data ?? null;
    const ok = Boolean(d?.category_scores && Object.keys(d.category_scores).length && (d?.evidence?.length ?? 0) > 0);
    if (!ok) cache_hit = false;
  }

  // Create job in running state.
  const { data: job, error: jobErr } = await admin
    .from("scan_jobs")
    .insert({
      org_id,
      requested_by: user.id,
      status: "running",
      inputs: jobInputs,
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

    // 1) Scout (v2)
    const deepSample = parseInt(String(input_hash).slice(-2), 16) % 10 === 0;
    const crawl_target = deepSample ? 15 : 6;
    const scoutReport = await scoutWebsiteV2(inputs, { maxPages: crawl_target });
    // Ensure confidence formulas can use the intended target pages.
    (scoutReport as any).signals.crawl_target_pages = crawl_target;

    // Hard requirements for Scout artifact schema
    if (!scoutReport.pages_checked?.length) throw new Error("Scout schema invalid: pages_checked[] is empty");
    if (!scoutReport.evidence?.length) throw new Error("Scout schema invalid: evidence[] is empty");
    (scoutReport as any)._meta_runtime = { crawl_target, deepSample };

    const scoutArtifact = {
      org_id,
      job_id: job.id,
      artifact_type: "scout.report",
      input_hash,
      version: ARTIFACT_VERSION,
      data: {
        _meta: { artifact_version: ARTIFACT_VERSION, scout_version: SCOUT_VERSION, code_commit },
        _runtime: (scoutReport as any)._meta_runtime,
        ...scoutReport,
      },
    };

    const { error: scoutErr } = await admin
      .from("scan_artifacts")
      .upsert(scoutArtifact, { onConflict: "org_id,artifact_type,input_hash,version" });

    if (scoutErr) {
      // Safety: never fail a scan due to duplicate artifact writes.
      if (!/duplicate key value|unique constraint/i.test(scoutErr.message)) {
        throw new Error(`Failed to write scout.report: ${scoutErr.message}`);
      }
    }

    // 2) Auditor
    const score = auditorFromScoutV2(scoutReport);

    // Hard requirements for Auditor schema
    if (!score.category_scores || Object.keys(score.category_scores).length === 0) throw new Error("ERR_AUDITOR_SCHEMA_INVALID: category_scores missing");
    if (!score.evidence || score.evidence.length === 0) throw new Error("ERR_AUDITOR_SCHEMA_INVALID: evidence[] empty");
    if (!score.pages_checked || score.pages_checked.length === 0) throw new Error("ERR_AUDITOR_SCHEMA_INVALID: pages_checked[] empty");

    // Strict validator (fail fast with clear code)
    const { normalizeCategoryScores, validateCategoryScoresStrict, SCORE_SCHEMA_VERSION } = await import("@/lib/scoreSchema");
    const normalized = normalizeCategoryScores(score.category_scores);
    const v = validateCategoryScoresStrict(normalized);
    if (!v.ok) throw new Error(`ERR_AUDITOR_SCHEMA_MISMATCH: ${v.error}`);
    (score as any).category_scores = normalized;
    (score as any)._score_schema_version = SCORE_SCHEMA_VERSION;

    const auditorArtifact = {
      org_id,
      job_id: job.id,
      artifact_type: "auditor.score",
      input_hash,
      version: ARTIFACT_VERSION,
      data: {
        _meta: { artifact_version: ARTIFACT_VERSION, auditor_version: AUDITOR_VERSION, code_commit },
        ...score,
        inputs: jobInputs,
        computed_at: new Date().toISOString(),
      },
    };

    const { error: auditorErr } = await admin
      .from("scan_artifacts")
      .upsert(auditorArtifact, { onConflict: "org_id,artifact_type,input_hash,version" });

    if (auditorErr) {
      // Safety: never fail a scan due to duplicate artifact writes.
      if (!/duplicate key value|unique constraint/i.test(auditorErr.message)) {
        throw new Error(`Failed to write auditor.score: ${auditorErr.message}`);
      }
    }

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
      .update({ status: "succeeded", filter_stage: "auditor", finished_at: new Date().toISOString() })
      .eq("id", job.id);

    return NextResponse.json({ ok: true, job: { ...job, status: "succeeded", cache_hit: false } });
  } catch (e: any) {
    const message = e?.message ?? "Scan failed";
    await admin
      .from("scan_jobs")
      .update({ status: "failed", error: message, finished_at: new Date().toISOString() })
      .eq("id", job.id);

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
