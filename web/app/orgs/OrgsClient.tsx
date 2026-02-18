"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function OrgsClient({ userId, initialError }: { userId: string; initialError?: string | null }) {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const router = useRouter();

  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [timezone, setTimezone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(initialError ?? null);

  async function create() {
    setErr(null);
    if (!name.trim()) return setErr("Name is required.");
    if (!type) return setErr("Type is required.");

    setBusy(true);
    try {
      const { data: org, error: orgErr } = await supabase
        .from("organizations")
        .insert({ name: name.trim(), type, timezone: timezone.trim() || null })
        .select("id")
        .maybeSingle();

      if (orgErr) throw orgErr;
      if (!org?.id) throw new Error("Org insert returned no id");

      const { error: memErr } = await supabase.from("org_members").insert({
        org_id: org.id,
        user_id: userId,
        role: "owner",
      });
      if (memErr) throw memErr;

      setName("");
      setType("");
      setTimezone("");
      router.refresh();
    } catch (e: any) {
      setErr(e?.message ?? "Failed to create organization");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 grid gap-3 sm:grid-cols-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Name"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <select
        value={type}
        onChange={(e) => setType(e.target.value)}
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      >
        <option value="">Type…</option>
        <option value="church">Church</option>
        <option value="conference">Conference</option>
        <option value="institution">Institution</option>
      </select>
      <input
        value={timezone}
        onChange={(e) => setTimezone(e.target.value)}
        placeholder="Timezone (optional)"
        className="rounded-xl border border-slate-300 px-3 py-2 text-sm"
      />
      <button
        type="button"
        onClick={create}
        disabled={busy}
        className="sm:col-span-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
      >
        {busy ? "Creating…" : "Create"}
      </button>

      {err ? (
        <div className="sm:col-span-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
          {err}
          <div className="mt-1 text-[11px] text-red-700">
            Tip: click the Create button (don’t press Enter).
          </div>
        </div>
      ) : null}

      <div className="sm:col-span-3 text-[11px] text-slate-500">
        If you see issues, open <Link className="underline" href="/login?next=/orgs">/login</Link> and confirm you’re signed in.
      </div>
    </div>
  );
}
