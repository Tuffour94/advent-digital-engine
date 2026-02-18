export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function CostPage({ params }: { params: Promise<{ orgId: string }> }) {
  await requireUser("/orgs");
  const { orgId } = await params;
  const supabase = await createSupabaseServerClient();

  const { data: jobs } = await supabase
    .from("scan_jobs")
    .select("id,status,used_ai,cache_hit,filter_stage,reason_ai_used,estimated_token_cost,actual_token_cost,created_at")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false })
    .limit(100);

  return (
    <main className="mx-auto max-w-4xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href={`/orgs/${orgId}/scan`} className="text-sm font-semibold text-slate-900">
          ← Scan
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-900">Cost & Cache</h1>
      <p className="mt-2 text-sm text-slate-600">Phase 1: AI is OFF by default.</p>

      <div className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white">
        <div className="grid grid-cols-12 gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold text-slate-600">
          <div className="col-span-3">When</div>
          <div className="col-span-2">Status</div>
          <div className="col-span-2">cache_hit</div>
          <div className="col-span-1">AI</div>
          <div className="col-span-2">token_cost</div>
          <div className="col-span-2">stage</div>
        </div>
        {(jobs ?? []).map((j: any) => (
          <div key={j.id} className="grid grid-cols-12 gap-3 px-4 py-3 text-xs">
            <div className="col-span-3 text-slate-700">{new Date(j.created_at).toLocaleString()}</div>
            <div className="col-span-2 text-slate-700">{j.status}</div>
            <div className="col-span-2 text-slate-700">{String(j.cache_hit)}</div>
            <div className="col-span-1 text-slate-700">{String(j.used_ai)}</div>
            <div className="col-span-2 text-slate-700">{j.actual_token_cost ?? 0}</div>
            <div className="col-span-2 text-slate-700">{j.filter_stage ?? "—"}</div>
          </div>
        ))}
        {(jobs ?? []).length === 0 ? (
          <div className="px-4 py-6 text-sm text-slate-600">No jobs yet.</div>
        ) : null}
      </div>
    </main>
  );
}
