export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

function JsonBlock({ data }: { data: any }) {
  return (
    <pre className="mt-3 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">
      {JSON.stringify(data, null, 2)}
    </pre>
  );
}

export default async function ScanJobPage({
  params,
}: {
  params: Promise<{ orgId: string; jobId: string }>;
}) {
  await requireUser("/orgs");
  const { orgId, jobId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("id,name")
    .eq("id", orgId)
    .maybeSingle();

  const { data: job } = await supabase
    .from("scan_jobs")
    .select("id,org_id,status,inputs,cache_hit,used_ai,filter_stage,reason_ai_used,actual_token_cost,created_at,error")
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();

  function sha256(input: string) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require("crypto").createHash("sha256").update(input).digest("hex");
  }

  const inputHash = job?.inputs ? sha256(JSON.stringify(job.inputs)) : null;

  // Prefer artifact linked to this job_id, but fall back to cache by input_hash (older jobs / cache hits).
  const { data: artifactByJob } = await supabase
    .from("scan_artifacts")
    .select("id,artifact_type,data,created_at,input_hash,version")
    .eq("org_id", orgId)
    .eq("job_id", jobId)
    .eq("artifact_type", "auditor.score")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { data: artifactByHash } = inputHash
    ? await supabase
        .from("scan_artifacts")
        .select("id,artifact_type,data,created_at,input_hash,version")
        .eq("org_id", orgId)
        .eq("artifact_type", "auditor.score")
        .eq("input_hash", inputHash)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : ({ data: null } as any);

  const artifact = artifactByJob ?? artifactByHash;

  const a = artifact?.data ?? null;
  const redFlags = (a?.redFlags ?? a?.red_flags ?? []) as any[];
  const priority = (a?.priorityActions ?? a?.priority_actions ?? []) as any[];

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href={`/orgs/${orgId}/scan`} className="text-sm font-semibold text-slate-900">
          ← Back to Scan
        </Link>
        <Link href={`/orgs/${orgId}/cost`} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
          Cost & Cache
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-900">Scan Results</h1>
      <p className="mt-2 text-sm text-slate-600">Org: {org?.name ?? orgId}</p>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Job</div>
        <div className="mt-2 text-xs text-slate-600">
          status: {job?.status ?? "—"} • cache_hit: {String(job?.cache_hit ?? false)} • used_ai: {String(job?.used_ai ?? false)} • token_cost: {job?.actual_token_cost ?? 0}
        </div>
        <div className="mt-1 text-xs text-slate-500">{job?.created_at ? new Date(job.created_at).toLocaleString() : ""}</div>
        {job?.error ? <div className="mt-3 text-xs text-red-700">{job.error}</div> : null}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Latest Results (Auditor)</div>
        {a ? (
          <>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-600">ekklesiaScore</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{a.ekklesiaScore ?? a.ekklesia_score ?? 0}</div>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-600">grade</div>
                <div className="mt-1 text-2xl font-semibold text-slate-900">{a.grade ?? "—"}</div>
              </div>
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-700">Red flags</div>
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                  {(redFlags ?? []).length ? redFlags.map((x, i) => <li key={i}>{String(x)}</li>) : <li>None</li>}
                </ul>
              </div>
              <div className="rounded-xl border border-slate-200 p-3">
                <div className="text-xs font-semibold text-slate-700">Priority actions</div>
                <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                  {(priority ?? []).length ? priority.map((x, i) => <li key={i}>{String(x)}</li>) : <li>None</li>}
                </ul>
              </div>
            </div>

            <details className="mt-5">
              <summary className="cursor-pointer text-sm font-semibold text-slate-900">View Raw JSON</summary>
              <JsonBlock data={a} />
            </details>

            <div className="mt-4 text-[11px] text-slate-500">
              artifact: {artifact?.artifact_type} • v{artifact?.version} • {artifact?.created_at ? new Date(artifact.created_at).toLocaleString() : ""}
            </div>
          </>
        ) : (
          <div className="mt-3 text-sm text-slate-600">No auditor artifact found for this job yet.</div>
        )}
      </div>

      <details className="mt-6">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">View Job Inputs (Raw JSON)</summary>
        <JsonBlock data={job?.inputs ?? null} />
      </details>
    </main>
  );
}
