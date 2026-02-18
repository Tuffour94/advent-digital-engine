"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function ScanClient({ orgId }: { orgId: string }) {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [youtube, setYoutube] = useState("");
  const [facebook, setFacebook] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function start() {
    setErr(null);
    if (!website.trim()) return setErr("Website URL is required.");
    setBusy(true);
    try {
      const resp = await fetch("/api/scan/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          org_id: orgId,
          website_url: website.trim(),
          youtube_url: youtube.trim() || null,
          facebook_url: facebook.trim() || null,
        }),
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json?.error || `Failed (${resp.status})`);

      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to start scan");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3">
      <input
        value={website}
        onChange={(e) => setWebsite(e.target.value)}
        placeholder="Website URL (required)"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        value={youtube}
        onChange={(e) => setYoutube(e.target.value)}
        placeholder="YouTube channel URL (optional)"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <input
        value={facebook}
        onChange={(e) => setFacebook(e.target.value)}
        placeholder="Facebook Page URL (optional)"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />

      <button
        type="button"
        onClick={start}
        disabled={busy}
        className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Starting…" : "Start scan"}
      </button>

      {err ? <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">{err}</div> : null}
    </div>
  );
}
