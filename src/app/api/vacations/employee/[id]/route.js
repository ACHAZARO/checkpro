// src/app/api/vacations/employee/[id]/route.js
// Devuelve resumen de vacaciones de un empleado: anniversary info, balance y periodos.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { anniversaryInfo } from '@/lib/vacations'

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

export async function GET(req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  const id = params?.id
  if (!id) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 })

  // Expirar periodos antes de leer
  try {
    await admin.rpc('expire_old_vacation_periods', { p_tenant_id: profile.tenant_id })
  } catch (e) {
    // No bloqueamos la respuesta si la RPC falla.
    console.warn('[vacations/employee] expire_old_vacation_periods fallo:', e?.message)
  }

  const { data: employee, error: empErr } = await admin
    .from('employees')
    .select('id, name, hire_date, branch_id, department, role_label, monthly_salary, schedule, status, payment_type')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()
  if (empErr || !employee) {
    return NextResponse.json({ ok: false, error: 'Empleado no encontrado' }, { status: 404 })
  }
  // FIX: managers can only access vacation data for employees in their own branch
  if (profile.role === 'manager' && profile.branch_id) {
    if (employee.branch_id && employee.branch_id !== profile.branch_id) {
      return NextResponse.json({ ok: false, error: 'Sin permisos para este empleado' }, { status: 403 })
    }
  }

  const { data: periods, error: perErr } = await admin
    .from('vacation_periods')
    .select('*')
    .eq('tenant_id', profile.tenant_id)
    .eq('employee_id', id)
    .order('anniversary_year', { ascending: false })
    .order('created_at', { ascending: false })
  if (perErr) {
    console.error('[vacations/employee] db error', perErr)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }

  const annivInfo = employee.hire_date ? anniversaryInfo(employee.hire_date, new Date()) : null

  // BUG D: exponer los 4 contadores por separado (pending, postponed,
  // active, expired). La UI los muestra explicitos para evitar ambiguedad.
  let pendingDays = 0
  let pospuestasDays = 0
  let activeDays = 0
  let expiredDays = 0
  for (const p of periods || []) {
    const days = Number(p.entitled_days) || 0
    if (p.status === 'pending') pendingDays += days
    else if (p.status === 'postponed') pospuestasDays += days
    else if (p.status === 'active') activeDays += days
    else if (p.status === 'expired') expiredDays += days
  }

  return NextResponse.json({
    ok: true,
    employee,
    anniversaryInfo: annivInfo,
    balance: { pendingDays, pospuestasDays, activeDays, expiredDays },
    periods: periods || [],
  })
}
