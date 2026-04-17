// src/app/api/vacations/active/route.js
// Empleados actualmente en vacaciones (status='active' y hoy dentro del rango).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

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

function todayISO() {
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export async function GET() {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  const today = todayISO()

  // Traer periodos activos que cubran hoy.
  let q = admin
    .from('vacation_periods')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq('status', 'active')
    .lte('start_date', today)
    .gte('end_date', today)

  // Manager solo ve su sucursal
  if (profile.role === 'manager' && profile.branch_id) {
    q = q.eq('branch_id', profile.branch_id)
  }

  const { data: periods, error: pErr } = await q
  if (pErr) return NextResponse.json({ ok: false, error: pErr.message }, { status: 500 })

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
