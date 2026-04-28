// src/app/api/cron/detect-shifts/route.js
// Cron diario (23:00 CST / 05:00 UTC): detecta abandono y salida temprana.
//
// abandono      — empleado registró entrada pero NO registró salida después de su hora de fin + 30 min.
// salida_temprana — empleado registró salida más de 15 min antes de su hora de fin programada.
//
// Autenticación: header `Authorization: Bearer $CRON_SECRET`
// Debug manual:  GET ?date=YYYY-MM-DD&dry=1
// Idempotente:   no duplica si ya existe incidencia del mismo kind para (employee, date).
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const TZ = process.env.APP_TIMEZONE || 'America/Mexico_City'
const DAY_MAP = { mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab', sun: 'dom' }
const GRACE_ABANDONO_MIN = 30
const GRACE_EARLY_MIN = 15

export const maxDuration = 60
export const dynamic = 'force-dynamic'

function isoDateInTz(date, tz) {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd')
}
function dayKeyInTz(date, tz) {
  const wd = formatInTimeZone(date, tz, 'EEE').toLowerCase()
  return DAY_MAP[wd] || 'lun'
}

// Devuelve Date UTC de la hora de salida esperada, o null si no se puede determinar.
function expectedExitUtc(shift, employee, plansMap, targetDate, targetDayKey) {
  if (employee.is_mixed) {
    const plan = plansMap.get(employee.id)
    if (!plan || !plan.entry_time_str || !plan.duration_hours) return null
    const [h, m] = plan.entry_time_str.split(':').map(Number)
    const totalMin = h * 60 + m + Math.round(Number(plan.duration_hours) * 60)
    const hh = String(Math.floor(totalMin / 60) % 24).padStart(2, '0')
    const mm = String(totalMin % 60).padStart(2, '0')
    return fromZonedTime(`${targetDate}T${hh}:${mm}:00`, TZ)
  }
  const s = employee.schedule?.[targetDayKey]
  if (!s?.work || !s.end) return null
  return fromZonedTime(`${targetDate}T${s.end}:00`, TZ)
}

export async function GET(req) {
  const auth = req.headers.get('authorization') || ''
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const url = new URL(req.url)
  const dateParam = url.searchParams.get('date')
  const dryRun = url.searchParams.get('dry') === '1'
  const now = new Date()

  // Por defecto: hoy en CST (este cron corre al final del día)
  const targetDate = dateParam || isoDateInTz(now, TZ)
  const targetDayKey = dayKeyInTz(new Date(`${targetDate}T12:00:00Z`), TZ)

  const admin = createServiceClient()

  const { data: tenants, error: tErr } = await admin.from('tenants').select('id, name, config')
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const summary = {
    target_date: targetDate,
    day_key: targetDayKey,
    dry_run: dryRun,
    now_utc: now.toISOString(),
    tenants_scanned: 0,
    incidencias_created: 0,
    details: [],
  }

  for (const tenant of tenants || []) {
    summary.tenants_scanned++

    // Shifts del día con entrada registrada (status open o completed)
    const { data: shifts, error: shErr } = await admin
      .from('shifts')
      .select('id, employee_id, branch_id, entry_time, exit_time, status')
      .eq('tenant_id', tenant.id)
      .eq('date_str', targetDate)
      .not('entry_time', 'is', null)
      .in('status', ['open', 'closed'])
    if (shErr) {
      summary.details.push({ tenant_id: tenant.id, error: shErr.message })
      continue
    }
    if (!shifts || shifts.length === 0) {
      summary.details.push({ tenant_id: tenant.id, shifts: 0 })
      continue
    }

    const empIds = [...new Set(shifts.map(s => s.employee_id))]

    // Empleados involucrados
    const { data: emps } = await admin
      .from('employees')
      .select('id, name, branch_id, schedule, is_mixed, free_schedule, has_shift, daily_hours')
      .eq('tenant_id', tenant.id)
      .in('id', empIds)
    const empMap = new Map((emps || []).map(e => [e.id, e]))

    // Planes de mixtos para hoy
    const mixedEmpIds = (emps || []).filter(e => e.is_mixed).map(e => e.id)
    let plansMap = new Map()
    if (mixedEmpIds.length > 0) {
      const { data: plans } = await admin
        .from('shift_plans')
        .select('employee_id, entry_time_str, exit_time_str, duration_hours')
        .eq('tenant_id', tenant.id)
        .eq('date_str', targetDate)
        .in('employee_id', mixedEmpIds)
      plansMap = new Map((plans || []).map(p => [p.employee_id, p]))
    }

    // Vacaciones activas
    const { data: vacs } = await admin
      .from('vacation_periods')
      .select('employee_id, tipo, status')
      .eq('tenant_id', tenant.id)
      .in('employee_id', empIds)
      .lte('start_date', targetDate)
      .gte('end_date', targetDate)
    const onVacation = new Set(
      (vacs || [])
        .filter(v => v.tipo === 'tomadas' && ['active', 'completed', 'pending', 'postponed'].includes(v.status))
        .map(v => v.employee_id)
    )

    // Incidencias ya existentes para deduplicar
    const { data: existingIncs } = await admin
      .from('incidencias')
      .select('employee_id, kind')
      .eq('tenant_id', tenant.id)
      .eq('date_str', targetDate)
      .in('kind', ['abandono', 'salida_temprana'])
      .in('employee_id', empIds)
    const alreadyFlagged = new Set((existingIncs || []).map(i => `${i.employee_id}:${i.kind}`))

    const inserts = []

    for (const shift of shifts) {
      const employee = empMap.get(shift.employee_id)
      if (!employee) continue
      if (employee.free_schedule) continue
      if (onVacation.has(employee.id)) continue

      const exitExpected = expectedExitUtc(shift, employee, plansMap, targetDate, targetDayKey)
      if (!exitExpected) continue

      // abandono: sin salida y ya pasó la hora de fin + gracia
      if (!shift.exit_time && shift.status === 'open') {
        const cutoff = new Date(exitExpected.getTime() + GRACE_ABANDONO_MIN * 60000)
        if (now > cutoff && !alreadyFlagged.has(`${employee.id}:abandono`)) {
          inserts.push({
            tenant_id: tenant.id,
            branch_id: shift.branch_id || employee.branch_id || null,
            employee_id: employee.id,
            employee_name: employee.name,
            shift_id: shift.id,
            date_str: targetDate,
            kind: 'abandono',
            description: 'Detectada automáticamente: empleado registró entrada pero no registró salida al terminar su turno.',
            status: 'open',
          })
        }
      }

      // salida_temprana: salió más de 15 min antes de la hora de fin
      if (shift.exit_time && shift.status === 'closed') {
        const exitActual = new Date(shift.exit_time)
        const earlyMs = exitExpected.getTime() - exitActual.getTime()
        const earlyMin = Math.round(earlyMs / 60000)
        const expectedStr = formatInTimeZone(exitExpected, TZ, 'HH:mm')
        if (earlyMin > GRACE_EARLY_MIN && !alreadyFlagged.has(`${employee.id}:salida_temprana`)) {
          inserts.push({
            tenant_id: tenant.id,
            branch_id: shift.branch_id || employee.branch_id || null,
            employee_id: employee.id,
            employee_name: employee.name,
            shift_id: shift.id,
            date_str: targetDate,
            kind: 'salida_temprana',
            description: `Detectada automáticamente: empleado salió ${earlyMin} minutos antes de su hora de salida programada (${expectedStr}).`,
            status: 'open',
          })
        }
      }
    }

    if (inserts.length > 0) {
      if (!dryRun) {
        const { error: insErr } = await admin.from('incidencias').insert(inserts)
        if (insErr) {
          summary.details.push({ tenant_id: tenant.id, error: insErr.message, would_insert: inserts.length })
          continue
        }
      }
      summary.incidencias_created += inserts.length
      summary.details.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        created: inserts.length,
        employees: inserts.map(i => ({ name: i.employee_name, kind: i.kind })),
      })
    } else {
      summary.details.push({ tenant_id: tenant.id, created: 0 })
    }
  }

  return NextResponse.json(summary)
}
