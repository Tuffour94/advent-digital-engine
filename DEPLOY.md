# ADE Cloud-first Deploy Notes

## GitHub
Repo: https://github.com/Tuffour94/advent-digital-engine
Default branch: main

## Vercel
- Root Directory: web
- Node version: 20
- Env vars (Preview + Production):
  - NEXT_PUBLIC_SUPABASE_URL
  - NEXT_PUBLIC_SUPABASE_ANON_KEY

## Supabase migrations (run in order)
1) supabase/migrations/001_helpers.sql
2) supabase/migrations/002_core_tables.sql
3) supabase/migrations/003_scan_jobs.sql

## Phase 1 guarantee
- AI OFF by default
- Rule-first + cache-first
- Token logging tables exist; token burn should be zero in Phase 1.
