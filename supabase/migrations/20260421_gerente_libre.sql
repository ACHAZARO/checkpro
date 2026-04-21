-- 20260421_gerente_libre.sql
-- Feat: Horario libre para gerentes + planificador persistente + candados de corte
-- Ejecutar en Supabase SQL Editor después de merge a main.

-- 1. Empleados: campos de horario libre (solo gerentes)
alter table public.employees
  add column if not exists free_schedule boolean default false,
  add column if not exists free_min_days_week integer,
  add column if not exists free_min_hours_week numeric(4,1);

comment on column public.employees.free_schedule is
  'Solo gerentes: true => se paga nómina íntegra sin horario fijo; checadas solo para tracking.';
comment on column public.employees.free_min_days_week is
  'Umbral de alerta: si el gerente checa menos de N días en la semana, alerta en Dashboard.';
comment on column public.employees.free_min_hours_week is
  'Umbral de alerta: si el gerente trabaja menos de N horas en la semana, alerta en Dashboard.';

-- 2. Persistencia del planificador semanal (ya existe shift_plans de mixto;
--    aquí agregamos metadata de "planificaciones guardadas" para candado de corte).
create table if not exists public.weekly_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid,
  start_date date not null,          -- lunes de la semana planificada
  end_date date not null,            -- domingo de la semana planificada
  title text,                        -- "Planificación semanal DD MMM - DD MMM"
  saved_by uuid,                     -- profile id que guardó
  saved_by_name text,
  saved_at timestamptz default now(),
  notes text,
  unique(tenant_id, branch_id, start_date)
);

create index if not exists idx_weekly_plans_tenant_date
  on public.weekly_plans (tenant_id, start_date);

alter table public.weekly_plans enable row level security;
drop policy if exists "weekly_plans_select" on public.weekly_plans;
drop policy if exists "weekly_plans_insert" on public.weekly_plans;
drop policy if exists "weekly_plans_update" on public.weekly_plans;
drop policy if exists "weekly_plans_delete" on public.weekly_plans;

create policy "weekly_plans_select" on public.weekly_plans
  for select using (tenant_id = public.my_tenant_id());
create policy "weekly_plans_insert" on public.weekly_plans
  for insert with check (tenant_id = public.my_tenant_id());
create policy "weekly_plans_update" on public.weekly_plans
  for update using (tenant_id = public.my_tenant_id());
create policy "weekly_plans_delete" on public.weekly_plans
  for delete using (tenant_id = public.my_tenant_id());

-- 3. Incidencias: nueva tabla (candado para corte)
create table if not exists public.incidencias (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid,
  employee_id uuid references public.employees(id) on delete set null,
  employee_name text,
  shift_id uuid references public.shifts(id) on delete set null,
  date_str date not null,
  kind text not null,                 -- 'falta', 'retardo_justificado', 'permiso', 'otro'
  description text,
  status text not null default 'open', -- 'open' | 'resolved' | 'ignored'
  resolution text,
  resolved_by uuid,
  resolved_by_name text,
  resolved_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_incidencias_tenant_status
  on public.incidencias (tenant_id, status);
create index if not exists idx_incidencias_tenant_date
  on public.incidencias (tenant_id, date_str);

alter table public.incidencias enable row level security;
drop policy if exists "incidencias_select" on public.incidencias;
drop policy if exists "incidencias_insert" on public.incidencias;
drop policy if exists "incidencias_update" on public.incidencias;
drop policy if exists "incidencias_delete" on public.incidencias;

create policy "incidencias_select" on public.incidencias
  for select using (tenant_id = public.my_tenant_id());
create policy "incidencias_insert" on public.incidencias
  for insert with check (tenant_id = public.my_tenant_id());
create policy "incidencias_update" on public.incidencias
  for update using (tenant_id = public.my_tenant_id());
create policy "incidencias_delete" on public.incidencias
  for delete using (tenant_id = public.my_tenant_id());

-- 4. Actualizar validate_employee_pin para incluir free_schedule
create or replace function public.validate_employee_pin(p_tenant_id uuid, p_code text, p_pin text)
returns jsonb language plpgsql security definer as $$
declare
  emp public.employees;
begin
  select * into emp
  from public.employees
  where tenant_id = p_tenant_id
    and employee_code = upper(p_code)
    and pin = p_pin
    and status = 'active';
  if not found then return jsonb_build_object('valid', false); end if;
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
      'is_mixed', emp.is_mixed,
      'daily_hours', emp.daily_hours,
      'free_schedule', emp.free_schedule,
      'free_min_days_week', emp.free_min_days_week,
      'free_min_hours_week', emp.free_min_hours_week,
      'employee_code', emp.employee_code
    )
  );
end;
$$;
