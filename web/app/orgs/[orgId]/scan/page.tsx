export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ScanClient from "./ScanClient";
import ClearHistoryClient from "./ClearHistoryClient";

export default async function ScanPage({ params }: { params: Promise<{ orgId: string }> }) {
  await requireUser("/orgs");
  const { orgId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase.from("organizations").select("id,name,type").eq("id", orgId).maybeSingle();

  const { data: jobsAll } = await supabase
    .from("scan_jobs")
    .select("id,status,inputs,cache_hit,created_at,error")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(50);

  // Default: hide legacy failed rows (they destroy trust and aren’t user-facing)
  const jobs = (jobsAll ?? []).filter((j: any) => j.status !== "failed").slice(0, 20);
  const legacyFailedCount = (jobsAll ?? []).filter((j: any) => j.status === "failed").length;

  const { scanInputHash, normalizeInputs } = await import("@/lib/scanKey");

  const latestJob = (jobs ?? [])[0];
  const latestHash = latestJob?.inputs
    ? scanInputHash(
        normalizeInputs({
          website_url: (latestJob.inputs as any).website_url,
          youtube_url: (latestJob.inputs as any).youtube_url,
          facebook_url: (latestJob.inputs as any).facebook_url,
        })
      )
    : null;

  const { data: latestArtifact } = latestHash
    ? await supabase
        .from("scan_artifacts")
        .select("id,artifact_type,data,created_at,version")
        .eq("org_id", orgId)
        .eq("artifact_type", "auditor.score")
        .eq("input_hash", latestHash)
        .order("version", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : ({ data: null } as any);

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
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-slate-900">Start a scan</div>
            <div className="mt-1 text-xs text-slate-600">Public-only. No AI. Generates a consulting-style audit report.</div>
          </div>
          <ClearHistoryClient orgId={orgId} />
        </div>
        <ScanClient orgId={orgId} />
        {legacyFailedCount ? (
          <div className="mt-3 text-[11px] text-slate-500">Hidden legacy failed rows: {legacyFailedCount} (use “Clear old failed rows” if you want them removed).</div>
        ) : null}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Latest Results (Audit)</div>
        {latestJob && latestArtifact?.data ? (
          (() => {
            const a: any = latestArtifact.data;
            const ekk = a.ekklesiaScore ?? a.ekklesia_score ?? 0;
            const grade = a.grade ?? "—";
            const catScores = a.category_scores ? Object.values(a.category_scores) : [];
            const redFlags = (a.red_flags ?? a.redFlags ?? []) as any[];
            const actions = (a.priority_actions ?? a.priorityActions ?? []) as any[];
            const wins = (a.top_wins ?? []) as any[];
            const risks = (a.top_risks ?? []) as any[];
            const sig = (a?.inputs ? null : null);
            return (
              <>
                <div className="mt-2 text-xs text-slate-600">
                  {new Date(latestJob.created_at).toLocaleString()} • status: {latestJob.status} • cache_hit: {String(latestJob.cache_hit)}
                </div>

                {/* Badge + stacked bar */}
                <div className="mt-4 rounded-2xl border border-slate-200 p-4">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-xs font-semibold text-slate-600">EkklesiaScore</div>
                      <div className="mt-1 text-4xl font-semibold tracking-tight text-slate-900">{ekk}</div>
                    </div>
                    <div className={`rounded-2xl px-4 py-2 text-white text-2xl font-semibold ${grade.startsWith('A') ? 'bg-emerald-600' : grade.startsWith('B') ? 'bg-green-600' : grade.startsWith('C') ? 'bg-amber-500' : grade.startsWith('D') ? 'bg-orange-600' : 'bg-red-600'}`}>
                      {grade}
                    </div>
                  </div>
                  {catScores.length ? (
                    <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-slate-100">
                      <div className="flex h-3 w-full">
                        {catScores.map((c: any) => (
                          <div
                            key={c.key}
                            className="bg-slate-900"
                            style={{ width: `${Math.round((c.weight / 100) * 1000) / 10}%` }}
                            title={`${c.label}: ${c.score}/${c.weight}`}
                          />
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {/* Traffic-light chips */}
                  <div className="mt-4 flex flex-wrap gap-2">
                    {a.category_scores?.giving ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.category_scores.giving.score >= 10 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>Giving</span>
                    ) : null}
                    {a.category_scores?.contact ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.category_scores.contact.score >= 10 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>Contact</span>
                    ) : null}
                    {a.category_scores?.events ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.category_scores.events.score >= 10 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>Events</span>
                    ) : null}
                    {a.category_scores?.media ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.category_scores.media.score >= 10 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>Media</span>
                    ) : null}
                    {a.category_scores?.mobile ? (
                      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold ${a.category_scores.mobile.score >= 6 ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 'bg-red-50 text-red-800 border border-red-200'}`}>Mobile</span>
                    ) : null}
                  </div>
                </div>

                {/* Top wins / risks */}
                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-700">Top 3 Wins</div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                      {(wins ?? []).length ? wins.map((x: any, i: number) => <li key={i}>{String(x)}</li>) : <li>—</li>}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-700">Top 3 Risks</div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                      {(risks ?? []).length ? risks.map((x: any, i: number) => <li key={i}>{String(x)}</li>) : <li>—</li>}
                    </ul>
                  </div>
                </div>

                {/* Breakdown */}
                {a.category_scores ? (
                  <div className="mt-4 grid gap-3">
                    {Object.values(a.category_scores).map((c: any) => {
                      const pct = Math.round((c.score / c.weight) * 100);
                      return (
                        <div key={c.key} className="rounded-xl border border-slate-200 p-3">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="text-xs font-semibold text-slate-900">{c.label}</div>
                              <div className="mt-1 text-[11px] text-slate-600">{(c.reasons?.[0] ?? '')}</div>
                            </div>
                            <div className="text-xs font-semibold text-slate-700">{c.score}/{c.weight}</div>
                          </div>
                          <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-slate-100">
                            <div className="h-2 rounded-full bg-slate-900" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ) : null}

                <div className="mt-4 grid gap-4 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-700">Red flags</div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                      {(redFlags ?? []).length ? redFlags.map((x: any, i: number) => <li key={i}>{String(x)}</li>) : <li>None</li>}
                    </ul>
                  </div>
                  <div className="rounded-xl border border-slate-200 p-3">
                    <div className="text-xs font-semibold text-slate-700">Priority actions</div>
                    <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
                      {(actions ?? []).length ? actions.map((x: any, i: number) => <li key={i}>{String(x)}</li>) : <li>None</li>}
                    </ul>
                  </div>
                </div>

                <details className="mt-5">
                  <summary className="cursor-pointer text-sm font-semibold text-slate-900">View Raw JSON</summary>
                  <pre className="mt-3 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify(latestArtifact.data, null, 2)}</pre>
                </details>

                <div className="mt-4">
                  <Link href={`/orgs/${orgId}/scan/${latestJob.id}`} className="text-sm font-semibold text-blue-700 hover:text-blue-900">
                    View Full Report →
                  </Link>
                </div>
              </>
            );
          })()
        ) : (
          <div className="mt-2 text-sm text-slate-600">No results yet.</div>
        )}
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Scan history</div>
        <div className="mt-1 text-xs text-slate-600">Open a scan to view the full audit report.</div>
        <div className="mt-3 space-y-2">
          {(jobs ?? []).map((j: any) => (
            <div key={j.id} className="rounded-xl border border-slate-200 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <div className="font-semibold text-slate-900">{j.status}</div>
                <div className="text-xs text-slate-500">{new Date(j.created_at).toLocaleString()}</div>
              </div>
              <div className="mt-1 text-xs text-slate-600">cache_hit: {String(j.cache_hit)}</div>
              <div className="mt-2">
                <Link href={`/orgs/${orgId}/scan/${j.id}`} className="text-xs font-semibold text-blue-700 hover:text-blue-900">
                  View Results
                </Link>
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
