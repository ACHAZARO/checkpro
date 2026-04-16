// src/app/api/admin/stats/route.js
// Aggregate stats for the super-admin dashboard.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireSuperAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof } = await admin.from('profiles').select('role').eq('id', session.user.id).maybeSingle()
  if (!prof || prof.role !== 'super_admin') return { error: 'Sin acceso', status: 403 }
  return { admin }
}

export async function GET() {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const admin = ctx.admin

  const today = new Date().toISOString().slice(0, 10)
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString().slice(0, 10)

  try {
    const [tenants, tenantsActive, profiles, employees, branches, shiftsToday, shifts7d, invites] = await Promise.all([
      admin.from('tenants').select('id', { count: 'exact', head: true }),
      admin.from('tenants').select('id', { count: 'exact', head: true }).eq('active', true),
      admin.from('profiles').select('id', { count: 'exact', head: true }),
      admin.from('employees').select('id', { count: 'exact', head: true }),
      admin.from('branches').select('id', { count: 'exact', head: true }),
      admin.from('shifts').select('id', { count: 'exact', head: true }).eq('date_str', today),
      admin.from('shifts').select('id', { count: 'exact', head: true }).gte('date_str', sevenDaysAgo),
      admin.from('invitations').select('id', { count: 'exact', head: true }).is('accepted_at', null)
    ])

    // Top tenants by shift activity in last 7 days
    const { data: tenantList } = await admin.from('tenants').select('id, name, active').order('created_at', { ascending: false })
    const tenantRows = tenantList || []

    const [empCounts, brCounts, shiftCounts] = await Promise.all([
      Promise.all(tenantRows.map(t =>
        admin.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).then(r => ({ id: t.id, count: r.count || 0 }))
      )),
      Promise.all(tenantRows.map(t =>
        admin.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).then(r => ({ id: t.id, count: r.count || 0 }))
      )),
      Promise.all(tenantRows.map(t =>
        admin.from('shifts').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id).gte('date_str', sevenDaysAgo).then(r => ({ id: t.id, count: r.count || 0 }))
      ))
    ])

    const empMap = Object.fromEntries(empCounts.map(x => [x.id, x.count]))
    const brMap = Object.fromEntries(brCounts.map(x => [x.id, x.count]))
    const shMap = Object.fromEntries(shiftCounts.map(x => [x.id, x.count]))

    const topTenants = tenantRows
      .map(t => ({
        id: t.id,
        name: t.name,
        active: t.active,
        employees: empMap[t.id] || 0,
        branches: brMap[t.id] || 0,
        shifts7d: shMap[t.id] || 0
      }))
      .sort((a, b) => b.shifts7d - a.shifts7d)
      .slice(0, 5)

    return NextResponse.json({
      tenants: tenants.count || 0,
      tenantsActive: tenantsActive.count || 0,
      tenantsInactive: (tenants.count || 0) - (tenantsActive.count || 0),
      profiles: profiles.count || 0,
      employees: employees.count || 0,
      branches: branches.count || 0,
      shiftsToday: shiftsToday.count || 0,
      shifts7d: shifts7d.count || 0,
      invitesPending: invites.count || 0,
      topTenants
    })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'stats failed' }, { status: 500 })
  }
}
