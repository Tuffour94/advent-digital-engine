"use client";

import { useMemo, useState } from "react";

export default function ReportClient({
  reportUrl,
  evidence,
}: {
  reportUrl: string;
  evidence: Array<{ check_id: string; url: string; found: boolean; snippet?: string | null }>;
}) {
  const categories = useMemo(() => {
    const bucket: Record<string, number> = {};
    for (const e of evidence) {
      const k = e.check_id.split(".")[0] || "other";
      bucket[k] = (bucket[k] ?? 0) + 1;
    }
    return Object.keys(bucket).sort((a, b) => a.localeCompare(b));
  }, [evidence]);

  const [filter, setFilter] = useState<string>("all");

  async function copyLink() {
    await navigator.clipboard.writeText(reportUrl);
  }

  const filtered = filter === "all" ? evidence : evidence.filter((e) => e.check_id.startsWith(filter + "."));

  return (
    <>
      <div className="no-print mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
        >
          Copy link to report
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
        >
          Print
        </button>
      </div>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm font-semibold text-slate-900">Evidence</div>
          <div className="no-print flex flex-wrap gap-2">
            <button
              className={
                "rounded-full px-3 py-1 text-xs font-semibold border " +
                (filter === "all" ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300")
              }
              onClick={() => setFilter("all")}
              type="button"
            >
              All
            </button>
            {categories.map((c) => (
              <button
                key={c}
                className={
                  "rounded-full px-3 py-1 text-xs font-semibold border " +
                  (filter === c ? "bg-slate-900 text-white border-slate-900" : "bg-white text-slate-700 border-slate-300")
                }
                onClick={() => setFilter(c)}
                type="button"
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        <div className="mt-4 space-y-2">
          {filtered.slice(0, 200).map((e, idx) => (
            <div key={idx} className="rounded-xl border border-slate-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs font-semibold text-slate-900">{e.check_id}</div>
                <div className={"text-[11px] font-semibold " + (e.found ? "text-emerald-700" : "text-red-700")}>
                  {e.found ? "FOUND" : "MISSING"}
                </div>
              </div>
              <div className="mt-1 text-[11px] text-slate-600 break-all">{e.url}</div>
              {e.snippet ? <div className="mt-2 text-xs text-slate-700">“{e.snippet}”</div> : null}
            </div>
          ))}
          {filtered.length === 0 ? <div className="text-sm text-slate-600">No evidence rows.</div> : null}
        </div>
      </div>
    </>
  );
}
