"use client";

import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

export default function LoginClient() {
  const supabase = useMemo(() => createSupabaseBrowserClient(), []);
  const sp = useSearchParams();
  const next = sp.get("next") || "/";

  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(sp.get("error"));

  async function send() {
    setBusy(true);
    setMsg(null);
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
    });
    setBusy(false);
    setMsg(error ? error.message : "Check your email for the sign-in link.");
  }

  return (
    <main className="mx-auto max-w-md px-6 py-12">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="mt-2 text-sm text-slate-600">ADE admin-only (Phase 1).</p>
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-6">
        <div className="text-xs font-semibold text-slate-700">Email</div>
        <input
          className="mt-2 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
        />
        <button
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50"
          disabled={busy || email.trim().length < 5}
          onClick={send}
        >
          {busy ? "Sending…" : "Send magic link"}
        </button>
        {msg ? <div className="mt-3 text-sm text-slate-700">{msg}</div> : null}
      </div>
    </main>
  );
}
