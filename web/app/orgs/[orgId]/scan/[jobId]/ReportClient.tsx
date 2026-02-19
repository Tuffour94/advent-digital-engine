"use client";

import { useMemo, useState } from "react";
import { dedupeEvidence, groupEvidence, type EvidenceRow } from "./evidenceUtils";

export default function ReportClient({
  reportUrl,
  evidence,
}: {
  reportUrl: string;
  evidence: EvidenceRow[];
}) {
  const deduped = useMemo(() => dedupeEvidence(evidence), [evidence]);
  const groups = useMemo(() => groupEvidence(deduped), [deduped]);
  const categories = useMemo(() => groups.map(([k]) => k), [groups]);

  const [filter, setFilter] = useState<string>("all");

  const [copied, setCopied] = useState(false);

  async function copyLink() {
    await navigator.clipboard.writeText(reportUrl);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const filtered = filter === "all" ? deduped : deduped.filter((e) => e.check_id.startsWith(filter + "."));

  return (
    <>
      <div className="no-print mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={copyLink}
          className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900"
        >
          {copied ? "✓ Copied" : "Copy link to report"}
        </button>
        <button
          type="button"
          onClick={() => window.print()}
          className="rounded-xl bg-slate-900 px-3 py-2 text-xs font-semibold text-white"
        >
          Print
        </button>
      </div>

      <div id="evidence" className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
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

        <div className="mt-4 space-y-6">
          {(filter === "all" ? groups : groupEvidence(filtered)).map(([cat, rows]) => (
            <div key={cat} className="rounded-2xl border border-slate-200 p-4">
              <div className="text-xs font-semibold tracking-wide text-slate-700">{cat.toUpperCase()}</div>
              <div className="mt-3 space-y-2">
                {rows.slice(0, 60).map((e, idx) => (
                  <div key={idx} className="rounded-xl border border-slate-200 p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
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
              </div>
            </div>
          ))}
          {filtered.length === 0 ? <div className="text-sm text-slate-600">No evidence rows.</div> : null}
        </div>
      </div>
    </>
  );
}
