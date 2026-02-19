"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ClearHistoryClient({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function clearLegacyFailures() {
    if (!confirm("Clear old FAILED scan rows for this org?")) return;
    setBusy(true);
    setMsg(null);
    try {
      const resp = await fetch("/api/admin/scan-jobs/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ org_id: orgId, mode: "legacy-failures" }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || `Failed (${resp.status})`);
      setMsg(`Cleared ${json.deleted_jobs ?? 0} failed rows.`);
      router.refresh();
    } catch (e: any) {
      setMsg(e?.message ?? "Failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="no-print">
      <button
        type="button"
        onClick={clearLegacyFailures}
        disabled={busy}
        className="rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-semibold text-slate-900 disabled:opacity-50"
      >
        {busy ? "Clearing…" : "Clear old failed rows"}
      </button>
      {msg ? <div className="mt-2 text-[11px] text-slate-600">{msg}</div> : null}
    </div>
  );
}
