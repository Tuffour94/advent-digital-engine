-- ADE: ade_scan_job tables (rule-first, cache-first, AI-last)

create table if not exists public.integrations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('website','youtube','facebook')),
  handle_or_url text not null,
  status text not null default 'active',
  connected_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_integrations_updated_at on public.integrations;
create trigger set_integrations_updated_at
before update on public.integrations
for each row execute function public.set_updated_at();

create index if not exists integrations_org_idx on public.integrations(org_id);

create table if not exists public.scan_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow text not null default 'ade_scan_job',
  status text not null default 'queued' check (status in ('queued','running','succeeded','failed','aborted')),
  requested_by uuid references auth.users(id),
  inputs jsonb not null default '{}'::jsonb,

  -- cost + cache flags
  used_ai boolean not null default false,
  cache_hit boolean not null default false,
  filter_stage text,
  reason_ai_used text,

  estimated_token_cost int,
  actual_token_cost int,

  started_at timestamptz,
  finished_at timestamptz,
  error text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_scan_jobs_updated_at on public.scan_jobs;
create trigger set_scan_jobs_updated_at
before update on public.scan_jobs
for each row execute function public.set_updated_at();

create index if not exists scan_jobs_org_idx on public.scan_jobs(org_id);
create index if not exists scan_jobs_status_idx on public.scan_jobs(status);

create table if not exists public.scan_artifacts (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.scan_jobs(id) on delete set null,
  artifact_type text not null,
  input_hash text not null,
  version int not null default 1,
  data jsonb not null,
  created_at timestamptz not null default now(),
  unique(org_id, artifact_type, input_hash, version)
);

create index if not exists scan_artifacts_lookup_idx on public.scan_artifacts(org_id, artifact_type, input_hash);

-- Token budgets + logs
create table if not exists public.token_budgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow text not null,
  window text not null default 'daily' check (window in ('daily','weekly','monthly')),
  limit_tokens int not null,
  created_at timestamptz not null default now(),
  unique(org_id, workflow, window)
);

create table if not exists public.token_usage_logs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  job_id uuid references public.scan_jobs(id) on delete set null,
  workflow text not null,
  model text,
  input_tokens int,
  output_tokens int,
  total_tokens int,
  cost_usd numeric,
  created_at timestamptz not null default now()
);

create index if not exists token_usage_org_idx on public.token_usage_logs(org_id, created_at desc);

-- RLS
alter table public.integrations enable row level security;
alter table public.scan_jobs enable row level security;
alter table public.scan_artifacts enable row level security;
alter table public.token_budgets enable row level security;
alter table public.token_usage_logs enable row level security;

-- integrations
create policy integrations_select on public.integrations
for select to authenticated
using (public.has_org_role(org_id,'viewer'));
create policy integrations_write on public.integrations
for all to authenticated
using (public.has_org_role(org_id,'admin'))
with check (public.has_org_role(org_id,'admin'));

-- scan_jobs
create policy scan_jobs_select on public.scan_jobs
for select to authenticated
using (public.has_org_role(org_id,'viewer'));
create policy scan_jobs_write on public.scan_jobs
for all to authenticated
using (public.has_org_role(org_id,'admin'))
with check (public.has_org_role(org_id,'admin'));

-- artifacts
create policy scan_artifacts_select on public.scan_artifacts
for select to authenticated
using (public.has_org_role(org_id,'viewer'));
create policy scan_artifacts_write on public.scan_artifacts
for all to authenticated
using (public.has_org_role(org_id,'admin'))
with check (public.has_org_role(org_id,'admin'));

-- budgets
create policy token_budgets_select on public.token_budgets
for select to authenticated
using (public.has_org_role(org_id,'admin'));
create policy token_budgets_write on public.token_budgets
for all to authenticated
using (public.has_org_role(org_id,'owner'))
with check (public.has_org_role(org_id,'owner'));

-- usage logs
create policy token_usage_select on public.token_usage_logs
for select to authenticated
using (public.has_org_role(org_id,'admin'));
create policy token_usage_write on public.token_usage_logs
for all to authenticated
using (public.has_org_role(org_id,'admin'))
with check (public.has_org_role(org_id,'admin'));
