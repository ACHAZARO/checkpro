// src/app/api/cron/detect-absences/route.js
// Cron diario: detecta empleados con turno programado sin registro de entrada
// y crea incidencias kind='falta' en estado 'open'.
// El gerente las gestiona desde /dashboard/incidencias (injustificada / justif. pagada / justif. sin pago).
//
// Autenticación: header `Authorization: Bearer $CRON_SECRET`
// Uso manual (debug): GET ?date=YYYY-MM-DD  (default = ayer CST)
//
// Idempotente: si ya existe incidencia kind='falta' para (employee, date), no duplica.
// Exclusiones: feriados del tenant, vacaciones activas, shift registrado (de cualquier status),
// empleados con has_shift=false, tenants con mixedSchedule habilitado (se planea aparte).
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = process.env.APP_TIMEZONE || 'America/Mexico_City'
const DAY_MAP = { mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab', sun: 'dom' }

export const maxDuration = 60
export const dynamic = 'force-dynamic'

function isoDateInTz(date, tz) {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd')
}
function dayKeyInTz(date, tz) {
  const wd = formatInTimeZone(date, tz, 'EEE').toLowerCase()
  return DAY_MAP[wd] || 'lun'
}

async function insertIncidenciaOnce(admin, payload) {
  const { data: existing } = await admin
    .from('incidencias')
    .select('id')
    .eq('tenant_id', payload.tenant_id)
    .eq('employee_id', payload.employee_id)
    .eq('date_str', payload.date_str)
    .eq('kind', payload.kind)
    .limit(1)
    .maybeSingle()
  if (existing?.id) return false
  const { error } = await admin.from('incidencias').insert(payload)
  if (error) throw error
  return true // FIX: dedupe por incidencia individual para reducir duplicados en reintentos.
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

  // Por defecto: hoy en CST (cron corre a las 11pm México, fin del día laboral)
  const now = new Date()
  const targetDate = dateParam || isoDateInTz(now, TZ)
  const targetDayKey = dayKeyInTz(new Date(`${targetDate}T12:00:00Z`), TZ)

  const admin = createServiceClient()

  const { data: tenants, error: tErr } = await admin
    .from('tenants')
    .select('id, name, config')
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })

  const summary = {
    target_date: targetDate,
    day_key: targetDayKey,
    dry_run: dryRun,
    tenants_scanned: 0,
    absences_created: 0,
    details: [],
  }

  for (const tenant of tenants || []) {
    summary.tenants_scanned++
    const cfg = tenant.config || {}

    // Feriado del tenant
    const holidays = Array.isArray(cfg.holidays) ? cfg.holidays : []
    const isHoliday = holidays.some(h => {
      if (typeof h === 'string') return h === targetDate
      if (h && typeof h === 'object') return h.date === targetDate
      return false
    })
    if (isHoliday) {
      summary.details.push({ tenant_id: tenant.id, skipped: 'holiday' })
      continue
    }

    const { data: emps, error: empErr } = await admin
      .from('employees')
      .select('id, name, branch_id, schedule, has_shift, free_schedule, is_mixed')
      .eq('tenant_id', tenant.id)
      .eq('status', 'active')
    if (empErr) {
      summary.details.push({ tenant_id: tenant.id, error: empErr.message })
      continue
    }

    // Candidatos fijos: horario fijo (is_mixed != true), con turno, que trabajen ese día.
    // free_schedule (gerentes libres) tampoco aplica.
    const fixedCandidates = (emps || []).filter(e => {
      if (e.is_mixed === true) return false
      if (e.has_shift === false) return false
      if (e.free_schedule === true) return false
      return e.schedule?.[targetDayKey]?.work === true
    })

    // Candidatos mixtos: empleados con shift_plan para targetDate.
    const { data: plans } = await admin
      .from('shift_plans')
      .select('employee_id')
      .eq('tenant_id', tenant.id)
      .eq('date_str', targetDate)
    const plannedEmpIds = new Set((plans || []).map(p => p.employee_id))
    const mixedCandidates = (emps || []).filter(e =>
      e.is_mixed === true && e.has_shift !== false && plannedEmpIds.has(e.id)
    )

    const candidates = [...fixedCandidates, ...mixedCandidates]
    if (candidates.length === 0) {
      summary.details.push({ tenant_id: tenant.id, candidates: 0 })
      continue
    }
    const empIds = candidates.map(e => e.id)

    // Shifts existentes para ese día (cualquier status)
    const { data: existingShifts } = await admin
      .from('shifts')
      .select('employee_id')
      .eq('tenant_id', tenant.id)
      .eq('date_str', targetDate)
      .in('employee_id', empIds)
    const shiftsByEmp = new Set((existingShifts || []).map(s => s.employee_id))

    // Vacaciones que cubren ese día (tipo=tomadas, status vivo)
    const { data: vacs } = await admin
      .from('vacation_periods')
      .select('employee_id, start_date, end_date, tipo, status')
      .eq('tenant_id', tenant.id)
      .in('employee_id', empIds)
      .lte('start_date', targetDate)
      .gte('end_date', targetDate)
    const onVacation = new Set(
      (vacs || [])
        .filter(v => v.tipo === 'tomadas' && ['active', 'completed', 'pending', 'postponed'].includes(v.status))
        .map(v => v.employee_id)
    )

    // Incidencias kind='falta' ya registradas para ese día (dedupe)
    const { data: existingIncs } = await admin
      .from('incidencias')
      .select('employee_id')
      .eq('tenant_id', tenant.id)
      .eq('date_str', targetDate)
      .eq('kind', 'falta')
      .in('employee_id', empIds)
    const alreadyFlagged = new Set((existingIncs || []).map(i => i.employee_id))

    const inserts = candidates
      .filter(e => !shiftsByEmp.has(e.id) && !onVacation.has(e.id) && !alreadyFlagged.has(e.id))
      .map(e => ({
        tenant_id: tenant.id,
        branch_id: e.branch_id || null,
        employee_id: e.id,
        employee_name: e.name,
        date_str: targetDate,
        kind: 'falta',
        description: 'Detectada automáticamente: empleado con turno programado y sin registro de entrada.',
        status: 'open',
      }))

    if (inserts.length > 0) {
      let createdCount = inserts.length // FIX: reportar solo inserts reales cuando el dedupe omite duplicados.
      if (!dryRun) {
        let insertedCount = 0
        try {
          for (const payload of inserts) {
            if (await insertIncidenciaOnce(admin, payload)) insertedCount++
          }
        } catch (insErr) {
          summary.details.push({ tenant_id: tenant.id, error: insErr.message, would_insert: inserts.length })
          continue
        }
        createdCount = insertedCount
      }
      summary.absences_created += createdCount
      summary.details.push({
        tenant_id: tenant.id,
        tenant_name: tenant.name,
        candidates: candidates.length,
        created: createdCount,
        employees: inserts.map(i => i.employee_name),
      })
    } else {
      summary.details.push({
        tenant_id: tenant.id,
        candidates: candidates.length,
        created: 0,
      })
    }
  }

  return NextResponse.json(summary)
}
