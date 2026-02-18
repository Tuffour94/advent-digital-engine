export const dynamic = "force-dynamic";

import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export default async function OrgsPage() {
  const user = await requireUser("/orgs");
  const supabase = await createSupabaseServerClient();

  const { data: memberships, error: membershipsError } = await supabase
    .from("org_members")
    .select("org_id, role, created_at")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  // List orgs via membership join (more robust under RLS)
  const { data: orgs, error: orgsError } = await supabase
    .from("org_members")
    .select("organizations:org_id (id,name,type,timezone,created_at), role")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false })
    .limit(50);

  async function createOrg(formData: FormData) {
    "use server";
    const user = await requireUser("/orgs");
    const supabase = await createSupabaseServerClient();

    const name = String(formData.get("name") || "").trim();
    const type = String(formData.get("type") || "").trim();
    const timezone = String(formData.get("timezone") || "").trim() || null;

    if (!name || !type) return;

    const { data: org, error } = await supabase
      .from("organizations")
      .insert({ name, type, timezone })
      .select("id")
      .maybeSingle();

    if (!error && org?.id) {
      await supabase.from("org_members").insert({ org_id: org.id, user_id: user.id, role: "owner" });
    }
  }

  return (
    <main className="mx-auto max-w-3xl px-6 py-10">
      <header className="flex items-center justify-between">
        <Link href="/" className="text-sm font-semibold text-slate-900">
          ← Home
        </Link>
        <Link href="/login?next=/orgs" className="text-sm font-semibold text-slate-700">
          Login
        </Link>
      </header>

      <h1 className="mt-8 text-3xl font-semibold tracking-tight text-slate-900">Organizations</h1>
      <p className="mt-2 text-sm text-slate-600">Phase 1: ade_scan_job only.</p>

      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="text-sm font-semibold text-slate-900">Create organization</div>
        <div className="mt-2 text-xs text-slate-500">
          Signed in as: <span className="font-mono">{user.email ?? user.id}</span>
          {process.env.NEXT_PUBLIC_SUPABASE_URL ? (
            <>
              {" "}• Supabase: <span className="font-mono">{process.env.NEXT_PUBLIC_SUPABASE_URL}</span>
            </>
          ) : null}
        </div>
        {(membershipsError || orgsError) ? (
          <div className="mt-3 rounded-xl border border-red-200 bg-red-50 p-3 text-xs text-red-800">
            {membershipsError ? <div>org_members error: {membershipsError.message}</div> : null}
            {orgsError ? <div>orgs query error: {orgsError.message}</div> : null}
          </div>
        ) : null}
        <form action={createOrg} className="mt-4 grid gap-3 sm:grid-cols-3">
          <input name="name" placeholder="Name" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <select name="type" className="rounded-xl border border-slate-300 px-3 py-2 text-sm">
            <option value="">Type…</option>
            <option value="church">Church</option>
            <option value="conference">Conference</option>
            <option value="institution">Institution</option>
          </select>
          <input name="timezone" placeholder="Timezone (optional)" className="rounded-xl border border-slate-300 px-3 py-2 text-sm" />
          <button type="submit" className="sm:col-span-3 rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white">
            Create
          </button>
        </form>
      </div>

      <div className="mt-6 space-y-3">
        {(orgs ?? []).map((row: any) => {
          const o = row.organizations;
          if (!o) return null;
          return (
            <div key={o.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-900">{o.name}</div>
                  <div className="mt-1 text-xs text-slate-600">
                    {o.type}{o.timezone ? ` • ${o.timezone}` : ""}{row.role ? ` • role: ${row.role}` : ""}
                  </div>
                </div>
                <Link href={`/orgs/${o.id}/scan`} className="text-sm font-semibold text-blue-700 hover:text-blue-900">
                  Open
                </Link>
              </div>
            </div>
          );
        })}
        {(orgs ?? []).length === 0 ? (
          <div className="text-sm text-slate-600">No organizations yet.</div>
        ) : null}
      </div>
    </main>
  );
}
