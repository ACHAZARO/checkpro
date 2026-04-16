// src/app/api/admin/tenants/route.js
// Super-admin: list all tenants with aggregate info.
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

  try {
    const { data: tenants } = await admin
      .from('tenants')
      .select('id, name, slug, owner_email, plan, active, created_at')
      .order('created_at', { ascending: false })

    const rows = await Promise.all((tenants || []).map(async (t) => {
      const [emp, br, prof] = await Promise.all([
        admin.from('employees').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id),
        admin.from('branches').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id),
        admin.from('profiles').select('id', { count: 'exact', head: true }).eq('tenant_id', t.id)
      ])
      return {
        ...t,
        employees: emp.count || 0,
        branches: br.count || 0,
        profiles: prof.count || 0
      }
    }))

    return NextResponse.json({ tenants: rows })
  } catch (err) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}
