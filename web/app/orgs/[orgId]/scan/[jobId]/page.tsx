export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ReportClient from "./ReportClient";

function gradeColor(grade: string) {
  if (grade.startsWith("A")) return "bg-emerald-600";
  if (grade.startsWith("B")) return "bg-green-600";
  if (grade.startsWith("C")) return "bg-amber-500";
  if (grade.startsWith("D")) return "bg-orange-600";
  return "bg-red-600";
}

import { scanInputHash, normalizeInputs } from "@/lib/scanKey";

export default async function ScanJobPage({
  params,
}: {
  params: Promise<{ orgId: string; jobId: string }>;
}) {
  const user = await requireUser("/orgs");
  const { orgId, jobId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: org } = await supabase.from("organizations").select("id,name").eq("id", orgId).maybeSingle();

  const { data: job } = await supabase
    .from("scan_jobs")
    .select("id,org_id,status,inputs,cache_hit,used_ai,filter_stage,reason_ai_used,actual_token_cost,created_at,error")
    .eq("org_id", orgId)
    .eq("id", jobId)
    .maybeSingle();

  const inputHash = job?.inputs
    ? scanInputHash(
        normalizeInputs({
          website_url: (job.inputs as any).website_url,
          youtube_url: (job.inputs as any).youtube_url,
          facebook_url: (job.inputs as any).facebook_url,
        })
      )
    : null;

  const { data: auditor } = inputHash
    ? await supabase
        .from("scan_artifacts")
        .select("id,data,created_at,version")
        .eq("org_id", orgId)
        .eq("artifact_type", "auditor.score")
        .eq("input_hash", inputHash)
        .order("version", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : ({ data: null } as any);

  const { data: scout } = inputHash
    ? await supabase
        .from("scan_artifacts")
        .select("id,data,created_at,version")
        .eq("org_id", orgId)
        .eq("artifact_type", "scout.report")
        .eq("input_hash", inputHash)
        .order("version", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle()
    : ({ data: null } as any);

  const a: any = auditor?.data ?? null;
  const s: any = scout?.data ?? null;

  const ekk = a?.ekklesiaScore ?? 0;
  const grade = a?.grade ?? "—";
  const cats = a?.category_scores ? (Object.values(a.category_scores) as any[]) : [];
  const wins = (a?.top_wins ?? a?.strengths ?? []).slice(0, 3);

  // Hard risks + soft risks (largest gaps) so Top Risks is never empty.
  const hardRisks = (a?.top_risks ?? a?.red_flags ?? []).slice(0, 3);
  const softRisks = cats
    .map((c: any) => ({
      key: c.key,
      label: c.label,
      score: c.score,
      weight: c.weight,
      gap: Math.max(0, (c.weight ?? 0) - (c.score ?? 0)),
      reason: c.reasons?.[0] ?? "",
    }))
    .sort((x: any, y: any) => y.gap - x.gap)
    .filter((x: any) => x.gap > 0)
    .slice(0, 3)
    .map((x: any) => `${x.label} is good (${x.score}/${x.weight}) but can be improved (${x.gap} pts gap).`);

  const risks = (hardRisks.length ? hardRisks : softRisks).slice(0, 3);

  const nextSteps = (a?.recommended_next_steps ?? []).slice(0, 8);

  // Executive summary + lightweight benchmark context (deterministic)
  const execSummary = (() => {
    const topCats = cats
      .slice()
      .sort((x: any, y: any) => (y.score / y.weight) - (x.score / x.weight))
      .slice(0, 2)
      .map((c: any) => c.label.toLowerCase());
    const lowCats = cats
      .slice()
      .sort((x: any, y: any) => (x.score / x.weight) - (y.score / y.weight))
      .slice(0, 2)
      .map((c: any) => c.label.toLowerCase());

    return `This church shows strong ${topCats.join(" and ")}. Improving ${lowCats.join(" and ")} will increase engagement and clarity for visitors.`;
  })();

  const benchmarkLine = ekk >= 90 ? "Top-tier digital presence." : ekk >= 75 ? "Above average digital health." : ekk >= 60 ? "Mid-range digital health." : "Digital health needs improvement.";

  const evidence = (a?.evidence ?? s?.evidence ?? []) as any[];
  const pagesChecked = (s?.pages_checked ?? a?.pages_checked ?? []) as any[];

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="no-print flex items-center justify-between">
        <Link href={`/orgs/${orgId}/scan`} className="text-sm font-semibold text-slate-900">
          ← Back to Dashboard
        </Link>
        <div className="flex items-center gap-3">
          <Link href={`/orgs/${orgId}/cost`} className="text-sm font-semibold text-slate-700 hover:text-slate-900">
            Cost & Cache
          </Link>
        </div>
      </header>

      <div className="mt-8">
        <div className="text-xs font-semibold tracking-wide text-slate-500">DIGITAL AUDIT REPORT</div>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-slate-900">{org?.name ?? "Organization"}</h1>
        <div className="mt-2 text-sm text-slate-600">
          Job: <span className="font-mono text-xs">{jobId}</span> • status: {job?.status ?? "—"} • cache_hit: {String(job?.cache_hit ?? false)} • used_ai: {String(job?.used_ai ?? false)}
        </div>
        <div className="mt-1 text-xs text-slate-500">{job?.created_at ? new Date(job.created_at).toLocaleString() : ""}</div>
        {job?.error ? <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{job.error}</div> : null}
      </div>

      {/* Summary */}
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="text-xs font-semibold tracking-wide text-slate-600">EKKLESIASCORE</div>
            <div className="mt-1 text-6xl font-semibold tracking-tight text-slate-900">{ekk}</div>
            <div className="mt-3 text-sm text-slate-700">{execSummary}</div>
            <div className="mt-1 text-xs font-semibold text-slate-500">{benchmarkLine}</div>
          </div>
          <div className={`rounded-2xl px-6 py-3 text-white text-3xl font-semibold shadow-sm ${gradeColor(grade)}`}>{grade}</div>
        </div>

        {/* Weighted contribution bar (opacity shows performance) */}
        {cats.length ? (
          <div className="mt-5 h-5 w-full overflow-hidden rounded-full bg-slate-100">
            <div className="flex h-5 w-full">
              {cats.map((c: any) => {
                const pct = Math.max(1, Math.round((c.weight / 100) * 1000) / 10);
                const fill = c.weight ? c.score / c.weight : 0;
                return (
                  <div
                    key={c.key}
                    className="bg-blue-700"                    style={{ width: `${pct}%`, opacity: 0.25 + 0.75 * Math.max(0, Math.min(1, fill)) }}
                    title={`${c.label}: ${c.score}/${c.weight}`}
                  />
                );
              })}
            </div>
          </div>
        ) : null}

        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700">Top 3 Wins</div>
            <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
              {wins.length ? wins.map((x: any, i: number) => <li key={i}>{String(x)}</li>) : <li>—</li>}
            </ul>
          </div>
          <div className="rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700">Top 3 Risks</div>
            <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
              {risks.length ? risks.map((x: any, i: number) => <li key={i}>{String(x)}</li>) : <li>—</li>}
            </ul>
          </div>
        </div>

        {nextSteps.length ? (
          <div className="mt-4 rounded-xl border border-slate-200 p-3">
            <div className="text-xs font-semibold text-slate-700">Recommended actions (next 7 days)</div>
            <div className="mt-2 space-y-2">
              {nextSteps.map((ns: any, i: number) => {
                const action = ns.action ?? ns.title;
                const where = ns.where ?? (ns.title ? "Not available — re-run scan" : "");
                const how = ns.how ?? (ns.title ? "Not available — re-run scan" : "");
                const time = ns.time_estimate ?? null;

                return (
                  <div key={i} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
                    <div className="font-semibold text-slate-900">✅ {action}</div>
                    {where ? <div className="mt-2 text-slate-700"><span className="font-semibold">Where:</span> {where}</div> : null}
                    {how ? <div className="mt-1 text-slate-700"><span className="font-semibold">How:</span> {how}</div> : null}
                    {time ? <div className="mt-1 text-slate-600"><span className="font-semibold">Time:</span> {time}</div> : null}
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {/* Audit trail preview (above the fold) */}
      <div className="mt-6 grid gap-4 sm:grid-cols-2">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Pages checked</div>
          <div className="mt-1 text-xs text-slate-600">{pagesChecked.length} pages</div>
          <div className="mt-4 space-y-2">
            {pagesChecked.slice(0, 4).map((p: any, i: number) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-900 truncate">{p.title ?? "(no title)"}</div>
                  <span
                    className={
                      "text-[11px] font-semibold rounded-full px-2 py-0.5 border " +
                      (p.status && p.status < 400
                        ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                        : "bg-red-50 text-red-800 border-red-200")
                    }
                  >
                    {p.status ?? "?"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-600 break-all">{p.url ?? p.final_url}</div>
              </div>
            ))}
            {!pagesChecked.length ? <div className="text-sm text-slate-600">No pages_checked found.</div> : null}
          </div>
          <div className="no-print mt-4">
            <a href="#pages-checked" className="text-sm font-semibold text-blue-700 hover:text-blue-900">View full pages checked →</a>
          </div>
        </div>

        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="text-sm font-semibold text-slate-900">Evidence highlights</div>
          <div className="mt-1 text-xs text-slate-600">Key detections and gaps</div>
          <div className="mt-4 space-y-2">
            {(evidence
              .slice()
              .sort((a: any, b: any) => Number(a.found) - Number(b.found))
              .slice(0, 6) as any[]
            ).map((e: any, i: number) => (
              <div key={i} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-xs font-semibold text-slate-900">{e.check_id}</div>
                  <span
                    className={
                      "rounded-full px-2 py-0.5 text-[11px] font-semibold border " +
                      (e.found ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-800 border-red-200")
                    }
                  >
                    {e.found ? "Detected" : "Missing"}
                  </span>
                </div>
                <div className="mt-1 text-[11px] text-slate-600 break-all">{e.url}</div>
                {e.snippet ? <div className="mt-2 text-xs text-slate-800">“{e.snippet}”</div> : null}
              </div>
            ))}
            {!evidence.length ? <div className="text-sm text-slate-600">No evidence rows.</div> : null}
          </div>
          <div className="no-print mt-4">
            <a href="#evidence" className="text-sm font-semibold text-blue-700 hover:text-blue-900">Open full evidence appendix →</a>
          </div>
        </div>
      </div>

      {/* Breakdown */}
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Category breakdown</div>
        {!cats.length ? (
          <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
            Report incomplete (missing category_scores). Re-run the scan to regenerate artifacts with the latest report schema.
          </div>
        ) : null}
        <div className="mt-4 space-y-3">
          {cats.map((c: any) => {
            const pct = Math.round((c.score / c.weight) * 100);
            return (
              <div key={c.key} className="rounded-xl border border-slate-200 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-900">{c.label}</div>
                    <div className="mt-1 text-[11px] text-slate-600">weight: {c.weight} • {c.reasons?.[0] ?? ""}</div>
                  </div>
                  <div className="text-xs font-semibold text-slate-700">{c.score}/{c.weight}</div>
                </div>
                <div className="mt-3 h-3.5 w-full overflow-hidden rounded-full bg-slate-100">
                  <div
                    className="h-3.5 rounded-full bg-gradient-to-r from-blue-700 to-blue-500"
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
          {!cats.length ? <div className="text-sm text-slate-600">No category scores found.</div> : null}
        </div>
      </div>

      {/* Full pages checked */}
      <div id="pages-checked" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Pages checked (full)</div>
        <div className="mt-4 space-y-2">
          {pagesChecked.slice(0, 24).map((p: any, i: number) => (
            <div key={i} className="rounded-xl border border-slate-200 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="text-xs font-semibold text-slate-900 truncate">{p.title ?? "(no title)"}</div>
                <span
                  className={
                    "text-[11px] font-semibold rounded-full px-2 py-0.5 border " +
                    (p.status && p.status < 400
                      ? "bg-emerald-50 text-emerald-800 border-emerald-200"
                      : "bg-red-50 text-red-800 border-red-200")
                  }
                >
                  {p.status ?? "?"}
                </span>
              </div>
              <div className="mt-1 text-[11px] text-slate-600 break-all">{p.url ?? p.final_url}</div>
            </div>
          ))}
          {!pagesChecked.length ? <div className="text-sm text-slate-600">No pages_checked found.</div> : null}
        </div>
      </div>

      {/* Evidence viewer + export */}
      <ReportClient
        reportUrl={`https://advent-digital-engine.vercel.app/orgs/${orgId}/scan/${jobId}`}
        evidence={evidence.map((e: any) => ({
          check_id: e.check_id,
          url: e.url,
          found: Boolean(e.found),
          snippet: e.snippet ?? null,
        }))}
      />

      <details className="no-print mt-6">
        <summary className="cursor-pointer text-sm font-semibold text-slate-900">Advanced (Developer mode)</summary>
        <div className="mt-2 text-xs text-slate-600">Raw JSON is hidden from normal users.</div>
        <pre className="mt-3 overflow-auto rounded-xl bg-slate-950 p-4 text-xs text-slate-100">{JSON.stringify({ auditor: a, scout: s }, null, 2)}</pre>
        <div className="mt-2 text-[11px] text-slate-500">Signed-in user: {user.email ?? user.id}</div>
      </details>
    </main>
  );
}
