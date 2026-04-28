// src/app/api/employees/[id]/attendance-summary/route.js
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

export async function GET(req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx

  const employeeId = params?.id
  if (!employeeId) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 })

  const url = new URL(req.url)
  const daysParam = parseInt(url.searchParams.get('days') || '30', 10)
  const days = Number.isFinite(daysParam) && daysParam > 0 ? Math.min(daysParam, 365) : 30

  const { data: employee, error: empErr } = await admin
    .from('employees')
    .select('id, tenant_id, status, monthly_salary, schedule')
    .eq('id', employeeId)
    .eq('tenant_id', profile.tenant_id)
    .neq('status', 'deleted')
    .maybeSingle()

  if (empErr) {
    console.error('[employees/attendance-summary] employee db error', empErr)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }
  if (!employee) return NextResponse.json({ ok: false, error: 'Empleado no encontrado' }, { status: 404 })

  const today = new Date()
  const cutoffDate = new Date(today)
  cutoffDate.setDate(cutoffDate.getDate() - days)
  const cutoff = toDateStr(cutoffDate)

  const weekStartDate = new Date(today)
  const day = weekStartDate.getDay()
  const diffToMonday = day === 0 ? -6 : 1 - day
  weekStartDate.setDate(weekStartDate.getDate() + diffToMonday)
  const weekEndDate = new Date(weekStartDate)
  weekEndDate.setDate(weekStartDate.getDate() + 6)
  const weekStart = toDateStr(weekStartDate)
  const weekEnd = toDateStr(weekEndDate)

  const { data: shifts, error: shiftsErr } = await admin
    .from('shifts')
    .select('id, employee_id, date_str, status, classification, duration_hours, entry_time, exit_time, corrections')
    .eq('employee_id', employeeId)
    .eq('tenant_id', profile.tenant_id)
    .gte('date_str', cutoff)
    .order('date_str', { ascending: false })

  if (shiftsErr) {
    console.error('[employees/attendance-summary] shifts db error', shiftsErr)
    return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
  }

  const rows = shifts || []
  const countType = (type) => rows.filter(s => s.classification?.type === type).length
  const isWorked = (shift) => shift.status === 'closed' || shift.status === 'incident'

  const counts = {
    puntual: countType('puntual'),
    tolerancia: countType('tolerancia'),
    retardo: countType('retardo'),
    falta_injustificada: countType('falta_injustificada'),
    falta_justificada_pagada: countType('falta_justificada_pagada'),
    falta_justificada_no_pagada: countType('falta_justificada_no_pagada'),
    total_dias: rows.length,
    dias_trabajados: rows.filter(isWorked).length,
  }

  const currentWeekRows = rows.filter(s => s.date_str >= weekStart && s.date_str <= weekEnd && isWorked(s))
  const totalH = currentWeekRows.reduce((sum, s) => sum + (Number(s.duration_hours) || 0), 0)
  const retardos = currentWeekRows.filter(s => s.classification?.type === 'retardo').length
  const diasTrabajados = currentWeekRows.length
  const grossPay = employee.monthly_salary ? diasTrabajados * (Number(employee.monthly_salary) / 30) : 0

  const recentShifts = rows.slice(0, 10).map(s => ({
    date_str: s.date_str,
    status: s.status,
    classification: s.classification,
    entry_time: s.entry_time,
    exit_time: s.exit_time,
    duration_hours: s.duration_hours,
  }))

  return NextResponse.json({
    ok: true,
    counts,
    currentWeek: { totalH, retardos, grossPay, diasTrabajados },
    recentShifts,
  })
}
