import Link from "next/link";

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="text-xs font-semibold tracking-wide text-slate-500">ADVENT DIGITAL ENGINE</div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-900">ADE (Phase 1)</h1>
        <p className="mt-3 text-sm leading-6 text-slate-600">
          Phase 1 is strictly <span className="font-semibold">ade_scan_job</span> end-to-end (Scout → Auditor → Executive).
          <br />
          Rule-first, cache-first, AI-last. AI is OFF by default.
        </p>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row">
          <Link
            href="/login?next=/orgs"
            className="inline-flex items-center justify-center rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white"
          >
            Sign in
          </Link>
          <Link
            href="/orgs"
            className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-900"
          >
            Organizations
          </Link>
        </div>

        <div className="mt-8 rounded-2xl border border-slate-200 bg-slate-50 p-4">
          <div className="text-xs font-semibold text-slate-700">Cost & Cache (Phase 1)</div>
          <ul className="mt-2 list-disc pl-5 text-xs text-slate-600">
            <li>cache_hit, used_ai, token_cost logged per scan</li>
            <li>no retries that increase token spend unless inputs change</li>
            <li>token budgets enforced per org (when worker is enabled)</li>
          </ul>
        </div>
      </div>
    </main>
  );
}
