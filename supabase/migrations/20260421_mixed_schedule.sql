-- 20260421_mixed_schedule.sql
-- Feat: Horario mixto + planificador semanal
-- Ejecutar en Supabase SQL Editor después de merge a main.

-- 1. Empleados: campos nuevos
alter table public.employees
  add column if not exists is_mixed boolean default false,
  add column if not exists daily_hours numeric(4,2);

-- 2. Tabla de planes semanales (agendado de mixtos)
create table if not exists public.shift_plans (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid references public.tenants(id) on delete cascade,
  branch_id uuid,
  employee_id uuid references public.employees(id) on delete cascade,
  date_str date not null,
  entry_time_str text not null,      -- "HH:MM"
  duration_hours numeric(4,2) not null,
  exit_time_str text,                -- "HH:MM" precomputado para UI/PDF
  notes text,
  created_by uuid,
  created_at timestamptz default now(),
  unique(tenant_id, employee_id, date_str)
);

create index if not exists idx_shift_plans_tenant_date
  on public.shift_plans (tenant_id, date_str);
create index if not exists idx_shift_plans_emp_date
  on public.shift_plans (employee_id, date_str);

-- 3. RLS
alter table public.shift_plans enable row level security;

drop policy if exists "shift_plans_select" on public.shift_plans;
drop policy if exists "shift_plans_insert" on public.shift_plans;
drop policy if exists "shift_plans_update" on public.shift_plans;
drop policy if exists "shift_plans_delete" on public.shift_plans;

create policy "shift_plans_select" on public.shift_plans
  for select using (tenant_id = public.my_tenant_id());
create policy "shift_plans_insert" on public.shift_plans
  for insert with check (tenant_id = public.my_tenant_id());
create policy "shift_plans_update" on public.shift_plans
  for update using (tenant_id = public.my_tenant_id());
create policy "shift_plans_delete" on public.shift_plans
  for delete using (tenant_id = public.my_tenant_id());

-- 4. Actualizar validate_employee_pin para devolver is_mixed + daily_hours
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
      'employee_code', emp.employee_code
    )
  );
end;
$$;
