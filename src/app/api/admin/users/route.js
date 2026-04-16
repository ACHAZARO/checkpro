// src/app/api/admin/users/route.js
// Super-admin: list all users across all tenants.
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

export async function GET(req) {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const admin = ctx.admin
  const { searchParams } = new URL(req.url)
  const search = (searchParams.get('q') || '').trim().toLowerCase()

  try {
    // All profiles
    const { data: profiles, error: pErr } = await admin
      .from('profiles')
      .select('id, name, role, tenant_id, branch_id, created_at')
      .order('created_at', { ascending: false })
      .limit(500)
    if (pErr) return NextResponse.json({ error: pErr.message }, { status: 500 })

    // All tenants (map)
    const { data: tenants } = await admin.from('tenants').select('id, name, slug, active')
    const tenantMap = Object.fromEntries((tenants || []).map(t => [t.id, t]))

    // All branches (map)
    const { data: branches } = await admin.from('branches').select('id, name')
    const branchMap = Object.fromEntries((branches || []).map(b => [b.id, b]))

    // Auth users for email + last_sign_in
    const { data: authData } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    const authMap = Object.fromEntries((authData?.users || []).map(u => [u.id, u]))

    let rows = (profiles || []).map(p => {
      const au = authMap[p.id] || {}
      const t = tenantMap[p.tenant_id] || {}
      return {
        id: p.id,
        name: p.name,
        role: p.role,
        email: au.email || null,
        emailConfirmed: !!au.email_confirmed_at,
        lastSignInAt: au.last_sign_in_at || null,
        banned: !!au.banned_until && new Date(au.banned_until) > new Date(),
        createdAt: p.created_at,
        tenantId: p.tenant_id,
        tenantName: t.name || '—',
        tenantActive: t.active !== false,
        branchId: p.branch_id,
        branchName: branchMap[p.branch_id]?.name || null
      }
    })

    if (search) {
      rows = rows.filter(r =>
        (r.email || '').toLowerCase().includes(search)
        || (r.name || '').toLowerCase().includes(search)
        || (r.tenantName || '').toLowerCase().includes(search)
      )
    }

    return NextResponse.json({ users: rows })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'users list failed' }, { status: 500 })
  }
}
