-- ============================================================
-- CheckPro migration: Multi-branch + Manager invitations
-- Idempotent — safe to re-run.
-- Run in Supabase → SQL Editor.
-- ============================================================

-- ─── 1. NEW TABLES ───────────────────────────────────────────

create table if not exists public.branches (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  name            text not null,
  slug            text,
  active          boolean default true,
  config          jsonb default '{}'::jsonb,
  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);
create index if not exists idx_branches_tenant on public.branches(tenant_id);

create table if not exists public.invitations (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references public.tenants(id) on delete cascade,
  branch_id       uuid references public.branches(id) on delete cascade,
  email           text not null,
  role            text not null default 'manager' check (role in ('manager')),
  token           text unique not null,
  expires_at      timestamptz not null default (now() + interval '7 days'),
  accepted_at     timestamptz,
  invited_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz default now()
);
create index if not exists idx_invitations_token on public.invitations(token);
create index if not exists idx_invitations_tenant on public.invitations(tenant_id);
create index if not exists idx_invitations_email on public.invitations(email);

-- ─── 2. ALTER EXISTING TABLES ─────────────────────────────────

-- profiles: branch_id (null = owner/super_admin with all-branch access)
alter table public.profiles add column if not exists branch_id uuid references public.branches(id) on delete set null;

-- employees / shifts / week_cuts: branch_id
alter table public.employees add column if not exists branch_id uuid references public.branches(id) on delete cascade;
alter table public.shifts    add column if not exists branch_id uuid references public.branches(id) on delete cascade;
alter table public.week_cuts add column if not exists branch_id uuid references public.branches(id) on delete cascade;

create index if not exists idx_employees_branch on public.employees(branch_id);
create index if not exists idx_shifts_branch    on public.shifts(branch_id);
create index if not exists idx_week_cuts_branch on public.week_cuts(branch_id);

-- ─── 3. BACKFILL: migrate from tenants.config.branches JSONB array ──────
-- Historical shape: branches were stored as array inside tenants.config.branches
--   [{id, name, ip, ipDetectedAt, coveragePayMode}, ...]
-- Per-branch config fields (toleranceMinutes, location, businessHours, holidays,
-- restDays, printHeader/Legal/Footer) lived at the TENANT level in cfg.
-- Employees referenced their branch via employee.schedule->'branch'->>'id'.
-- This backfill:
--   a) For each tenant with branches in JSONB → create a public.branches row
--      per element, PRESERVING the existing id (so employee.schedule.branch.id
--      references remain valid during transition). Copies the tenant-level
--      config into each branch initially — owner can diverge per branch later.
--   b) For tenants with NO branches in JSONB and none in public.branches → create
--      a default "Sucursal principal" row.
--   c) Attach employees/shifts/week_cuts to their branch (using schedule.branch.id
--      when available, falling back to the tenant's first branch).
do $$
declare
  t        record;
  br       jsonb;
  br_uuid  uuid;
  b_default uuid;
  cfg      jsonb;
  base_cfg jsonb;
begin
  for t in select * from public.tenants loop
    cfg := coalesce(t.config, '{}'::jsonb);

    -- Tenant-level per-branch defaults (copied into each branch row)
    base_cfg := jsonb_build_object(
      'toleranceMinutes', coalesce((cfg->>'toleranceMinutes')::int, 10),
      'alertHours',       coalesce((cfg->>'alertHours')::int, 8),
      'weekClosingDay',   coalesce(cfg->>'weekClosingDay', 'dom'),
      'location',         coalesce(cfg->'location', '{"lat":19.4326,"lng":-99.1332,"radius":300,"name":"Oficina Principal"}'::jsonb),
      'businessHours',    coalesce(cfg->'businessHours', '{}'::jsonb),
      'holidays',         coalesce(cfg->'holidays', '[]'::jsonb),
      'restDays',         coalesce(cfg->'restDays', '[]'::jsonb),
      'printHeader',      coalesce(cfg->>'printHeader', ''),
      'printLegalText',   coalesce(cfg->>'printLegalText', ''),
      'printFooter',      coalesce(cfg->>'printFooter', '')
    );

    -- Path A: import legacy config.branches array (preserve IDs)
    if jsonb_typeof(cfg->'branches') = 'array' and jsonb_array_length(cfg->'branches') > 0 then
      for br in select * from jsonb_array_elements(cfg->'branches') loop
        begin
          br_uuid := (br->>'id')::uuid;
        exception when others then
          br_uuid := gen_random_uuid();
        end;

        insert into public.branches (id, tenant_id, name, config)
        values (
          br_uuid,
          t.id,
          coalesce(br->>'name', 'Sucursal'),
          base_cfg
            || jsonb_build_object('ip', coalesce(br->'ip', 'null'::jsonb))
            || jsonb_build_object('ipDetectedAt', coalesce(br->'ipDetectedAt', 'null'::jsonb))
            || jsonb_build_object('coveragePayMode', coalesce(br->'coveragePayMode', '"covered"'::jsonb))
        )
        on conflict (id) do nothing;
      end loop;
    end if;

    -- Path B: tenant still has no branches → create a default one
    if not exists (select 1 from public.branches where tenant_id = t.id) then
      insert into public.branches (tenant_id, name, config)
      values (
        t.id,
        coalesce(cfg->>'branchName', 'Sucursal principal'),
        base_cfg
      );
    end if;

    -- Pick a fallback branch for rows we can't map precisely
    select id into b_default
    from public.branches
    where tenant_id = t.id
    order by created_at asc
    limit 1;

    -- Attach employees: first by schedule.branch.id if it matches a branch
    update public.employees e
    set branch_id = (
      case
        when (e.schedule->'branch'->>'id') is not null
          and exists (
            select 1 from public.branches b
            where b.tenant_id = t.id
              and b.id::text = (e.schedule->'branch'->>'id')
          )
        then (e.schedule->'branch'->>'id')::uuid
        else b_default
      end
    )
    where e.tenant_id = t.id and e.branch_id is null;

    -- Attach shifts: inherit from their employee when possible, else default
    update public.shifts s
    set branch_id = coalesce(
      (select e.branch_id from public.employees e where e.id = s.employee_id),
      b_default
    )
    where s.tenant_id = t.id and s.branch_id is null;

    update public.week_cuts
    set branch_id = b_default
    where tenant_id = t.id and branch_id is null;
  end loop;
end$$;

-- ─── 4. HELPERS ───────────────────────────────────────────────
-- Must be SECURITY DEFINER: these are called from RLS policies on profiles,
-- and their internal SELECT on profiles would otherwise re-trigger the same
-- policy (infinite recursion → 500 on every profile fetch → login bounces).

create or replace function public.my_tenant_id()
returns uuid language sql stable security definer set search_path = public as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_branch_id()
returns uuid language sql stable security definer set search_path = public as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_tenant_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('owner','super_admin'),
    false
  )
$$;

grant execute on function public.my_tenant_id()    to anon, authenticated, service_role;
grant execute on function public.my_role()         to anon, authenticated, service_role;
grant execute on function public.my_branch_id()    to anon, authenticated, service_role;
grant execute on function public.is_tenant_admin() to anon, authenticated, service_role;

-- ─── 5. RLS POLICIES — rebuild with branch awareness ─────────

-- BRANCHES
alter table public.branches enable row level security;

drop policy if exists "branches_select" on public.branches;
create policy "branches_select" on public.branches
  for select using (
    tenant_id = public.my_tenant_id()
  );

drop policy if exists "branches_insert" on public.branches;
create policy "branches_insert" on public.branches
  for insert with check (
    tenant_id = public.my_tenant_id() and public.is_tenant_admin()
  );

drop policy if exists "branches_update" on public.branches;
create policy "branches_update" on public.branches
  for update using (
    tenant_id = public.my_tenant_id()
    and (
      public.is_tenant_admin()
      or id = public.my_branch_id()  -- manager can update own branch (operational config only; app-layer filters which fields)
    )
  );

drop policy if exists "branches_delete" on public.branches;
create policy "branches_delete" on public.branches
  for delete using (
    tenant_id = public.my_tenant_id() and public.is_tenant_admin()
  );

-- INVITATIONS (owner-only; accept endpoint uses service role)
alter table public.invitations enable row level security;

drop policy if exists "invitations_select" on public.invitations;
create policy "invitations_select" on public.invitations
  for select using (
    tenant_id = public.my_tenant_id() and public.is_tenant_admin()
  );

drop policy if exists "invitations_insert" on public.invitations;
create policy "invitations_insert" on public.invitations
  for insert with check (
    tenant_id = public.my_tenant_id() and public.is_tenant_admin()
  );

drop policy if exists "invitations_delete" on public.invitations;
create policy "invitations_delete" on public.invitations
  for delete using (
    tenant_id = public.my_tenant_id() and public.is_tenant_admin()
  );

-- EMPLOYEES — owner sees all tenant; manager sees only own branch
drop policy if exists "employees_select" on public.employees;
create policy "employees_select" on public.employees
  for select using (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

drop policy if exists "employees_insert" on public.employees;
create policy "employees_insert" on public.employees
  for insert with check (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

drop policy if exists "employees_update" on public.employees;
create policy "employees_update" on public.employees
  for update using (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

drop policy if exists "employees_delete" on public.employees;
create policy "employees_delete" on public.employees
  for delete using (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

-- SHIFTS
drop policy if exists "shifts_select" on public.shifts;
create policy "shifts_select" on public.shifts
  for select using (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

drop policy if exists "shifts_insert" on public.shifts;
create policy "shifts_insert" on public.shifts
  for insert with check (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

drop policy if exists "shifts_update" on public.shifts;
create policy "shifts_update" on public.shifts
  for update using (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

-- WEEK_CUTS
drop policy if exists "week_cuts_select" on public.week_cuts;
create policy "week_cuts_select" on public.week_cuts
  for select using (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

drop policy if exists "week_cuts_insert" on public.week_cuts;
create policy "week_cuts_insert" on public.week_cuts
  for insert with check (
    tenant_id = public.my_tenant_id()
    and (public.is_tenant_admin() or branch_id = public.my_branch_id())
  );

-- ─── 6. UPDATE validate_employee_pin to accept branch_id ──────
-- Backwards-compatible: accepts optional branch_id; if null, uses tenant-wide match (legacy).
create or replace function public.validate_employee_pin(
  p_tenant_id uuid,
  p_code text,
  p_pin text,
  p_branch_id uuid default null
)
returns jsonb language plpgsql security definer as $$
declare
  emp public.employees;
begin
  if p_branch_id is null then
    select * into emp from public.employees
    where tenant_id = p_tenant_id
      and employee_code = upper(p_code)
      and pin = p_pin
      and status = 'active'
    limit 1;
  else
    select * into emp from public.employees
    where tenant_id = p_tenant_id
      and branch_id = p_branch_id
      and employee_code = upper(p_code)
      and pin = p_pin
      and status = 'active'
    limit 1;
  end if;

  if not found then
    return jsonb_build_object('valid', false, 'error', 'Credenciales incorrectas');
  end if;

  return jsonb_build_object(
    'valid', true,
    'employee', jsonb_build_object(
      'id', emp.id,
      'name', emp.name,
      'department', emp.department,
      'role_label', emp.role_label,
      'can_manage', emp.can_manage,
      'has_shift', emp.has_shift,
      'monthly_salary', emp.monthly_salary,
      'schedule', emp.schedule,
      'employee_code', emp.employee_code,
      'branch_id', emp.branch_id
    )
  );
end;
$$;

-- ─── 7. DONE ──────────────────────────────────────────────────
select
  (select count(*) from public.branches)    as branches,
  (select count(*) from public.tenants)     as tenants,
  (select count(*) from public.employees where branch_id is not null) as employees_with_branch,
  (select count(*) from public.employees where branch_id is null)     as employees_missing_branch;
