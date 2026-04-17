-- CHECKPRO Schema -- Execute in Supabase SQL Editor
create extension if not exists "uuid-ossp";

create table public.tenants (id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, owner_email text not null, plan text default 'free', active boolean default true, config jsonb default '{}'::jsonb, created_at timestamptz default now());

create table public.profiles (id uuid primary key references auth.users(id) on delete cascade, tenant_id uuid references public.tenants(id) on delete cascade, name text not null, role text default 'owner', status text default 'active', created_at timestamptz default now());

create table public.employees (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, employee_code text not null, name text not null, department text, pin text not null, role_label text default 'employee', can_manage boolean default false, has_shift boolean default true, monthly_salary numeric(10,2) default 0, schedule jsonb default '{}', status text default 'active', created_at timestamptz default now(), unique(tenant_id, employee_code));

create table public.shifts (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, employee_id uuid references public.employees(id) on delete cascade, date_str date not null, entry_time timestamptz, exit_time timestamptz, duration_hours numeric(5,2), status text default 'open', classification jsonb, is_holiday boolean default false, holiday_name text, covering_employee_id uuid, week_cut_id uuid, geo_entry jsonb, geo_exit jsonb, incidents jsonb default '[]', corrections jsonb default '[]', created_at timestamptz default now());

create table public.week_cuts (id uuid primary key default gen_random_uuid(), tenant_id uuid references public.tenants(id) on delete cascade, start_date date, end_date date, closed_by_name text, notes text, paid boolean default true, shift_ids uuid[] default '{}', created_at timestamptz default now());

create table public.audit_log (id uuid primary key default gen_random_uuid(), tenant_id uuid, action text, employee_id uuid, employee_name text, detail text, success boolean default true, created_at timestamptz default now());

alter table public.tenants enable row level security;
alter table public.profiles enable row level security;
alter table public.employees enable row level security;
alter table public.shifts enable row level security;
alter table public.week_cuts enable row level security;
alter table public.audit_log enable row level security;

-- NOTE: helpers must be SECURITY DEFINER so the internal SELECT on public.profiles
-- does not re-trigger the profiles RLS policy that itself calls these helpers
-- (infinite recursion → PostgREST returns 500, manifests as "login loops back to /login").
create or replace function public.my_tenant_id() returns uuid language sql stable security definer set search_path = public as $$ select tenant_id from public.profiles where id = auth.uid() $$;
create or replace function public.my_role() returns text language sql stable security definer set search_path = public as $$ select role from public.profiles where id = auth.uid() $$;

create policy "tenant_select" on public.tenants for select using (owner_email = (select email from auth.users where id = auth.uid()));
create policy "tenant_update" on public.tenants for update using (owner_email = (select email from auth.users where id = auth.uid()));
create policy "tenant_insert" on public.tenants for insert with check (true);
create policy "profiles_select" on public.profiles for select using (id = auth.uid() or tenant_id = public.my_tenant_id());
create policy "profiles_insert" on public.profiles for insert with check (id = auth.uid());
create policy "profiles_update" on public.profiles for update using (id = auth.uid() or tenant_id = public.my_tenant_id());
create policy "employees_select" on public.employees for select using (tenant_id = public.my_tenant_id());
create policy "employees_insert" on public.employees for insert with check (tenant_id = public.my_tenant_id());
create policy "employees_update" on public.employees for update using (tenant_id = public.my_tenant_id());
create policy "shifts_select" on public.shifts for select using (tenant_id = public.my_tenant_id());
create policy "shifts_insert" on public.shifts for insert with check (tenant_id = public.my_tenant_id());
create policy "shifts_update" on public.shifts for update using (tenant_id = public.my_tenant_id());
create policy "week_cuts_select" on public.week_cuts for select using (tenant_id = public.my_tenant_id());
create policy "week_cuts_insert" on public.week_cuts for insert with check (tenant_id = public.my_tenant_id());
create policy "audit_select" on public.audit_log for select using (tenant_id = public.my_tenant_id());
create policy "audit_insert" on public.audit_log for insert with check (tenant_id = public.my_tenant_id());

create or or or or or replace function public.validate_employee_pin(p_tenant_id uuid, p_code text, p_pin text) returns jsonb language plpgsql security definer as $$ declare emp public.employees; begin select * into emp from public.employees where tenant_id = p_tenant_id and employee_code = upper(p_code) and pin = p_pin and status = 'active'; if not found then return jsonb_build_object('valid', false); end if; return jsonb_build_object('valid', true, 'employee', jsonb_build_object('id', emp.id, 'name', emp.name, 'department', emp.department, 'role_label', emp.role_label, 'can_manage', emp.can_manage, 'has_shift', emp.has_shift, 'monthly_salary', emp.monthly_salary, 'schedule', emp.schedule, 'employee_code', emp.employee_code)); end; $$;
