-- ============================================================
-- CheckPro hotfix: missing RLS INSERT policies
-- Run this in Supabase → SQL Editor
-- Safe to run multiple times.
-- ============================================================

-- Tenants: allow a newly authenticated user to create their own tenant
-- (owner_email must match their auth email). Needed if someone ever
-- falls back to the client-side registration path.
drop policy if exists "tenant_insert" on public.tenants;
create policy "tenant_insert" on public.tenants
  for insert
  with check (
    owner_email = (select email from auth.users where id = auth.uid())
    or public.my_role() = 'super_admin'
  );

-- Audit log: allow authenticated reads/inserts for the tenant itself.
-- (No change if already present — this is defensive.)

-- Sanity: make sure the INSERT policy on profiles exists (ships by default
-- in schema.sql, but recreate defensively).
drop policy if exists "profiles_insert" on public.profiles;
create policy "profiles_insert" on public.profiles
  for insert
  with check (id = auth.uid());

-- ─── Cleanup: remove test users created during automated verification ────
-- These were created by Claude's deploy-verification script. Safe to remove.
delete from auth.users where email like 'claude-deploy-check-%@mailinator.com';
delete from public.tenants where owner_email like 'claude-deploy-check-%@mailinator.com';
