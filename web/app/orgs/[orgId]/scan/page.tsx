export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import ScanClient from "./ScanClient";

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
        <ScanClient orgId={orgId} />
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
