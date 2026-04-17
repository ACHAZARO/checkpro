-- hotfix_rls_recursion.sql
-- Fix: the RLS policy "profiles_select" calls public.my_tenant_id(), which itself
-- does SELECT tenant_id FROM public.profiles WHERE id = auth.uid(). That SELECT
-- re-triggers the same policy, which re-calls my_tenant_id(), which re-SELECTs...
-- stack depth exceeded → PostgREST returns 500 on every SELECT against profiles.
--
-- Repro before fix:
--   Login succeeds (auth/v1/token → 200), cookie issued, middleware accepts,
--   but GET /rest/v1/profiles?... returns 500 → dashboard layout can't load
--   profile → client redirects to /login → user perceives "login loop".
--
-- Fix: mark the helpers as SECURITY DEFINER so they execute with the function
-- owner's privileges (postgres), bypassing RLS for the internal SELECT. Same
-- pattern Supabase itself recommends for helpers referenced inside RLS USING
-- clauses on the very table they query.
-- Also pin search_path to avoid hijacking in SECURITY DEFINER context.

create or replace function public.my_tenant_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select tenant_id from public.profiles where id = auth.uid()
$$;

create or replace function public.my_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.my_branch_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select branch_id from public.profiles where id = auth.uid()
$$;

create or replace function public.is_tenant_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select role from public.profiles where id = auth.uid()) in ('owner','super_admin'),
    false
  )
$$;

-- Keep execute privileges aligned with the PostgREST roles
grant execute on function public.my_tenant_id()   to anon, authenticated, service_role;
grant execute on function public.my_role()        to anon, authenticated, service_role;
grant execute on function public.my_branch_id()   to anon, authenticated, service_role;
grant execute on function public.is_tenant_admin() to anon, authenticated, service_role;
