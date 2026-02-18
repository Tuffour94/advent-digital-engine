-- ADE: core multi-tenant tables + RLS

-- Organizations
create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  type text not null check (type in ('church','conference','institution')),
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists set_organizations_updated_at on public.organizations;
create trigger set_organizations_updated_at
before update on public.organizations
for each row execute function public.set_updated_at();

create table if not exists public.org_members (
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','viewer')),
  created_at timestamptz not null default now(),
  primary key (org_id, user_id)
);

create index if not exists org_members_user_idx on public.org_members(user_id);

-- Helper: org access
create or replace function public.has_org_role(p_org_id uuid, p_role text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and (
        m.role = p_role
        or (p_role = 'viewer' and m.role in ('viewer','admin','owner'))
        or (p_role = 'admin' and m.role in ('admin','owner'))
        or (p_role = 'owner' and m.role = 'owner')
      )
  );
$$;

-- RLS
alter table public.organizations enable row level security;
alter table public.org_members enable row level security;

-- organizations: select/update/insert only for members (owner/admin)
drop policy if exists org_select on public.organizations;
create policy org_select on public.organizations
for select to authenticated
using (public.has_org_role(id, 'viewer'));

drop policy if exists org_insert on public.organizations;
create policy org_insert on public.organizations
for insert to authenticated
with check (true);

-- org_members: members can see their org membership; owners/admins can manage

drop policy if exists org_members_select on public.org_members;
create policy org_members_select on public.org_members
for select to authenticated
using (user_id = auth.uid() or public.has_org_role(org_id,'admin'));

drop policy if exists org_members_insert on public.org_members;
create policy org_members_insert on public.org_members
for insert to authenticated
with check (public.has_org_role(org_id,'admin') or user_id = auth.uid());

drop policy if exists org_members_update on public.org_members;
create policy org_members_update on public.org_members
for update to authenticated
using (public.has_org_role(org_id,'admin'))
with check (public.has_org_role(org_id,'admin'));

drop policy if exists org_members_delete on public.org_members;
create policy org_members_delete on public.org_members
for delete to authenticated
using (public.has_org_role(org_id,'admin'));
