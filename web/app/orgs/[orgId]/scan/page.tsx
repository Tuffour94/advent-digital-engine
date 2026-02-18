export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function sha256(input: string) {
  return require("crypto").createHash("sha256").update(input).digest("hex");
}

export default async function ScanPage({ params }: { params: Promise<{ orgId: string }> }) {
  await requireUser("/orgs");
  const { orgId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase.from("organizations").select("id,name,type").eq("id", orgId).maybeSingle();

  const { data: jobs } = await supabase
    .from("scan_jobs")
    .select("id,status,cache_hit,used_ai,actual_token_cost,created_at,error")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(20);

  async function startScan(formData: FormData) {
    "use server";
    const user = await requireUser(`/orgs/${orgId}/scan`);
    const supabase = await createSupabaseServerClient();

    const website = String(formData.get("website_url") || "").trim();
    const youtube = String(formData.get("youtube_url") || "").trim();
    const facebook = String(formData.get("facebook_url") || "").trim();

    if (!website) return;

    const inputs = { website_url: website, youtube_url: youtube || null, facebook_url: facebook || null };
    const input_hash = sha256(JSON.stringify(inputs));

    // Cache check: if we already have an auditor artifact for same inputs, mark cache_hit and skip.
    const { data: cached } = await supabase
      .from("scan_artifacts")
      .select("id")
      .eq("org_id", orgId)
      .eq("artifact_type", "auditor.score")
      .eq("input_hash", input_hash)
      .limit(1)
      .maybeSingle();

    const cache_hit = Boolean(cached?.id);

    await supabase.from("scan_jobs").insert({
      org_id: orgId,
      requested_by: user.id,
      status: cache_hit ? "succeeded" : "queued",
      inputs,
      cache_hit,
      used_ai: false,
      estimated_token_cost: 0,
      actual_token_cost: 0,
      filter_stage: cache_hit ? "cache" : "queue",
    });

    // If not cache hit, worker would pick it up. For v1 scaffold, we just create placeholder artifacts.
    if (!cache_hit) {
      await supabase.from("scan_artifacts").insert({
        org_id: orgId,
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

      await supabase
        .from("scan_jobs")
        .update({ status: "succeeded", filter_stage: "stub", finished_at: new Date().toISOString() })
        .eq("org_id", orgId)
        .eq("inputs", inputs);
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/orgs" className="text-sm font-semibold text-slate-900">
          ← Orgs
        </Link>
        <Link href={`/orgs/${orgId}/cost`} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          Cost & Cache
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-900">Scan</h1>
      <p className="mt-2 text-sm text-slate-600">Org: {org?.name ?? orgId}</p>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">ade_scan_job (v1)</div>
        <div className="mt-1 text-xs text-slate-600">Website required. YouTube/Facebook optional. Public-only.</div>

        <form action={startScan} className="mt-4 grid gap-3">
          <input name="website_url" placeholder="Website URL (required)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="youtube_url" placeholder="YouTube channel URL (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <input name="facebook_url" placeholder="Facebook Page URL (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">Start scan</button>
        </form>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Recent scans</div>
        <div className="mt-3 space-y-2">
          {(jobs ?? []).map((j: any) => (
            <div key={j.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900">{j.status}</div>
                <div className="text-xs text-slate-500">{new Date(j.created_at).toLocaleString()}</div>
              </div>
              <div className="mt-1 text-xs text-slate-600">
                cache_hit: {String(j.cache_hit)} • used_ai: {String(j.used_ai)} • token_cost: {j.actual_token_cost ?? 0}
              </div>
              {j.error ? <div className="mt-2 text-xs text-red-700">{j.error}</div> : null}
            </div>
          ))}
          {(jobs ?? []).length === 0 ? <div className="text-sm text-slate-600">No scans yet.</div> : null}
        </div>
      </div>
    </main>
  );
}
