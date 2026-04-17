// src/app/api/vacations/active/route.js
// Empleados actualmente en vacaciones (status='active' y hoy dentro del rango).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { todayISOMX } from '@/lib/utils'

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

export async function GET() {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  // BUG 2: usar todayISOMX (America/Mexico_City) — Vercel corre UTC
  // y new Date().toISOString() tiraba a día siguiente/anterior cerca de
  // medianoche, mostrando periodos equivocados como activos.
  const today = todayISOMX()

  // Traer periodos activos que cubran hoy.
  let q = admin
    .from('vacation_periods')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .lte('start_date', today)
    .gte('end_date', today)

  // BUG J: manager sin branch_id NO debe ver todo el tenant.
  if (profile.role === 'manager') {
    if (!profile.branch_id) {
      return NextResponse.json({ ok: true, items: [], count: 0 })
    }
    q = q.eq('branch_id', profile.branch_id)
  }

  const { data: periods, error: pErr } = await q
  if (pErr) {
    console.error('[vacations/active] db error', pErr)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }

  const empIds = [...new Set((periods || []).map(p => p.employee_id).filter(Boolean))]
  let employeesById = {}
  if (empIds.length > 0) {
    const { data: emps } = await admin
      .from('employees')
      .select('id, name, branch_id, department, role_label')
      .in('id', empIds)
    for (const e of emps || []) employeesById[e.id] = e
  }

  // TODO: resolver coverage desde shifts.covering_employee_id en el rango.
  // Por ahora devolvemos array vacio; la UI puede cargar shifts por separado si lo necesita.
  const items = (periods || []).map(p => ({
    period: p,
    employee: employeesById[p.employee_id] || null,
    coverage: [],
  }))

  return NextResponse.json({ ok: true, items, count: items.length })
}
