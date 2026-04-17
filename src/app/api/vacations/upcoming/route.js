// src/app/api/vacations/upcoming/route.js
// Empleados con aniversario laboral en los proximos N dias (default 30).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { upcomingAnniversaries, daysForYear } from '@/lib/vacations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthedProfile() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('id, tenant_id, role, branch_id, name')
    .eq('id', session.user.id)
    .maybeSingle()
  if (profErr || !prof) return { error: 'Perfil no encontrado', status: 403 }
  return { profile: prof, admin }
}

export async function GET(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  const url = new URL(req.url)
  const daysParam = parseInt(url.searchParams.get('days') || '30', 10)
  const daysAhead = Number.isFinite(daysParam) && daysParam > 0 ? daysParam : 30

  let q = admin
    .from('employees')
    .select('id, name, hire_date, branch_id, department, role_label')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')

  // BUG J: manager sin branch_id NO debe ver todo el tenant.
  if (profile.role === 'manager') {
    if (!profile.branch_id) {
      return NextResponse.json({ ok: true, items: [], count: 0, daysAhead })
    }
    q = q.eq('branch_id', profile.branch_id)
  }

  const { data: employees, error: eErr } = await q
  if (eErr) {
    console.error('[vacations/upcoming] db error', eErr)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }

  const { data: tenant } = await admin
    .from('tenants')
    .select('config')
    .eq('id', profile.tenant_id)
    .maybeSingle()
  const vacTable = tenant?.config?.vacation_table || tenant?.config?.vacationTable || null

  const list = upcomingAnniversaries(employees || [], new Date(), daysAhead)
  const items = list.map(({ employee, info }) => ({
    employee,
    info,
    entitled_days_next: daysForYear(info.nextYear, vacTable),
  }))

  return NextResponse.json({ ok: true, items, count: items.length, daysAhead })
}
