import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({
    ok: true,
    vercel_git_commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    vercel_env: process.env.VERCEL_ENV ?? null,
  });
}
