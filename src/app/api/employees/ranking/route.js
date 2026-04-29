// src/app/api/employees/ranking/route.js
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

function toDateStr(date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export async function GET(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx

  // FIX: require owner/manager role to access ranking data
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  const url = new URL(req.url)
  const monthParam = url.searchParams.get('month')
  const now = new Date()
  const fallbackMonth = toDateStr(now).slice(0, 7)
  const month = /^\d{4}-\d{2}$/.test(monthParam || '') ? monthParam : fallbackMonth
  const [year, monthNum] = month.split('-').map(Number)
  const monthStart = `${month}-01`
  const monthEnd = toDateStr(new Date(year, monthNum, 0))

  const [{ data: shifts, error: shiftsErr }, { data: employees, error: empErr }, { data: incidencias, error: incErr }] = await Promise.all([
    admin
      .from('shifts')
      .select('employee_id, date_str, status, classification')
      .eq('tenant_id', profile.tenant_id)
      .gte('date_str', monthStart)
      .lte('date_str', monthEnd),
    admin
      .from('employees')
      .select('id, name')
      .eq('tenant_id', profile.tenant_id)
      .eq('status', 'active')
      .eq('has_shift', true),
    admin
      .from('incidencias')
      .select('employee_id, kind, date_str')
      .eq('tenant_id', profile.tenant_id)
      .gte('date_str', monthStart)
      .lte('date_str', monthEnd)
      .in('kind', ['abandono', 'falta_injustificada']),
  ])

  if (shiftsErr || empErr || incErr) {
    console.error('[employees/ranking] db error', shiftsErr || empErr || incErr)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }

  const rows = shifts || []
  const severeEmployeeIds = new Set()
  rows.forEach(s => {
    const type = s.classification?.type || s.classification
    if (type === 'falta_injustificada' || type === 'abandono' || s.kind === 'falta_injustificada') {
      severeEmployeeIds.add(s.employee_id)
    }
  })
  ;(incidencias || []).forEach(i => {
    if (i.kind === 'abandono' || i.kind === 'falta_injustificada') severeEmployeeIds.add(i.employee_id)
  })
  const excluded = (employees || []).filter(employee => severeEmployeeIds.has(employee.id)).length
  const ranking = (employees || [])
    .filter(employee => !severeEmployeeIds.has(employee.id)) // FIX: ranking siempre visible top 3
    .map(employee => {
      const empShifts = rows.filter(s => s.employee_id === employee.id)
      const puntual = empShifts.filter(s => s.classification?.type === 'puntual').length
      const tolerancia = empShifts.filter(s => s.classification?.type === 'tolerancia').length
      const retardo = empShifts.filter(s => s.classification?.type === 'retardo').length
      const falta_injustificada = empShifts.filter(s => s.classification?.type === 'falta_injustificada').length
      const dias_trabajados = empShifts.filter(s => s.status === 'closed' || s.status === 'incident').length
      const score = puntual * 3 + tolerancia * 1 - retardo * 2 - falta_injustificada * 5
      return {
        employee_id: employee.id,
        name: employee.name,
        score,
        puntual,
        tolerancia,
        retardo,
        falta_injustificada,
        dias_trabajados,
      }
    })
    .filter(item => item.dias_trabajados > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)

  return NextResponse.json({ ok: true, month, items: ranking, excluded }) // FIX: ranking siempre visible top 3
}
