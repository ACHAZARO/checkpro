// src/app/api/incidencias/detect-now/route.js
// Versión on-demand del cron nocturno — llamada desde el botón "Detectar ahora"
// en el dashboard. Auth: sesión de Supabase (perfil de manager/admin).
// Scoped a un solo tenant (el del usuario autenticado).
// Combina la lógica de detect-absences + detect-shifts para el día actual.
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

const TZ = process.env.APP_TIMEZONE || 'America/Mexico_City'
const DAY_MAP = { mon: 'lun', tue: 'mar', wed: 'mie', thu: 'jue', fri: 'vie', sat: 'sab', sun: 'dom' }
const GRACE_ABANDONO_MIN = 30
const GRACE_EARLY_MIN = 15

export const dynamic = 'force-dynamic'

function isoDateInTz(date, tz) {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd')
}
function dayKeyInTz(date, tz) {
  const wd = formatInTimeZone(date, tz, 'EEE').toLowerCase()
  return DAY_MAP[wd] || 'lun'
}
function expectedExitUtc(shift, employee, plansMap, targetDate, targetDayKey) {
  if (employee.is_mixed) {
    const plan = plansMap.get(employee.id)
    const duration = Number(plan?.duration_hours || 0)
    if (!plan || !plan.entry_time_str || duration <= 0) return null
    const entryUtc = fromZonedTime(`${targetDate}T${plan.entry_time_str}:00`, TZ)
    return new Date(entryUtc.getTime() + Math.round(duration * 60) * 60000) // FIX: soportar planes mixtos que cruzan medianoche.
  }
  const s = employee.schedule?.[targetDayKey]
  if (!s?.work || !s.end) return null
  let exitDate = targetDate
  if (s.start && s.end <= s.start) {
    const d = new Date(`${targetDate}T00:00:00`)
    d.setDate(d.getDate() + 1)
    exitDate = formatInTimeZone(d, TZ, 'yyyy-MM-dd') // FIX: salida de turno fijo nocturno cae al dia siguiente.
  }
  return fromZonedTime(`${exitDate}T${s.end}:00`, TZ)
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
  if (error) return false
  return true // FIX: reutilizar dedupe por incidencia individual en deteccion manual.
}

export async function POST(req) {
  // Auth: verificar JWT del usuario vía Bearer token (browser client no funciona server-side)
  const admin = createServiceClient()
  const authHeader = req.headers.get('authorization') || ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '').trim() // FIX: aceptar Bearer case-insensitive y no truncar tokens con texto similar.
  if (!jwt) return NextResponse.json({ error: 'No autenticado' }, { status: 401 })

  const { data: { user }, error: authErr } = await admin.auth.getUser(jwt)
  if (authErr || !user) return NextResponse.json({ error: 'Token inválido' }, { status: 401 })

  const { data: profile } = await admin
    .from('profiles')
    .select('tenant_id, role')
    .eq('id', user.id)
    .single()
  if (!profile?.tenant_id) return NextResponse.json({ error: 'Sin tenant' }, { status: 403 })
  if (!['owner', 'admin', 'manager', 'super_admin'].includes(profile.role)) { // FIX: alinear roles reales y evitar bloquear owners.
    return NextResponse.json({ error: 'Sin permisos' }, { status: 403 })
  }

  // Rate limit: max 5 detecciones/min por usuario. Cliente ya throttle a 60s,
  // este es respaldo contra tabs duplicados o loops accidentales.
  const rl = rateLimit(`detect-now:${user.id}`, 5, 60_000)
  if (!rl.ok) {
    return NextResponse.json({ error: 'Demasiadas solicitudes', retryAfter: rl.retryAfter }, { status: 429 })
  }

  const tenantId = profile.tenant_id
  const now = new Date()
  const targetDate = isoDateInTz(now, TZ)
  const targetDayKey = dayKeyInTz(new Date(`${targetDate}T12:00:00Z`), TZ)

  const summary = { target_date: targetDate, absences: 0, shift_incidents: 0, total: 0 }

  // ── 1. detect-absences: falta por no presentarse ──
  const { data: tenant } = await admin.from('tenants').select('config').eq('id', tenantId).single()
  const cfg = tenant?.config || {}
  const holidays = Array.isArray(cfg.holidays) ? cfg.holidays : []
  const isHoliday = holidays.some(h =>
    typeof h === 'string' ? h === targetDate : h?.date === targetDate
  )

  if (!isHoliday) {
    const { data: emps } = await admin
      .from('employees')
      .select('id, name, branch_id, schedule, has_shift, free_schedule, is_mixed')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')

    const fixedCandidates = (emps || []).filter(e =>
      !e.is_mixed && e.has_shift !== false && !e.free_schedule && e.schedule?.[targetDayKey]?.work === true
    )

    const { data: plans } = await admin
      .from('shift_plans')
      .select('employee_id')
      .eq('tenant_id', tenantId)
      .eq('date_str', targetDate)
    const plannedEmpIds = new Set((plans || []).map(p => p.employee_id))
    const mixedCandidates = (emps || []).filter(e =>
      e.is_mixed && e.has_shift !== false && plannedEmpIds.has(e.id)
    )

    const candidates = [...fixedCandidates, ...mixedCandidates]
    if (candidates.length > 0) {
      const empIds = candidates.map(e => e.id)

      const { data: existingShifts } = await admin
        .from('shifts')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('date_str', targetDate)
        .in('employee_id', empIds)
      const shiftsByEmp = new Set((existingShifts || []).map(s => s.employee_id))

      const { data: vacs } = await admin
        .from('vacation_periods')
        .select('employee_id, tipo, status')
        .eq('tenant_id', tenantId)
        .in('employee_id', empIds)
        .lte('start_date', targetDate)
        .gte('end_date', targetDate)
      const onVacation = new Set(
        (vacs || [])
          .filter(v => v.tipo === 'tomadas' && ['active', 'completed', 'pending', 'postponed'].includes(v.status))
          .map(v => v.employee_id)
      )

      const { data: existingIncs } = await admin
        .from('incidencias')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .eq('date_str', targetDate)
        .eq('kind', 'falta')
        .in('employee_id', empIds)
      const alreadyFlagged = new Set((existingIncs || []).map(i => i.employee_id))

      const absenceInserts = candidates
        .filter(e => !shiftsByEmp.has(e.id) && !onVacation.has(e.id) && !alreadyFlagged.has(e.id))
        .map(e => ({
          tenant_id: tenantId,
          branch_id: e.branch_id || null,
          employee_id: e.id,
          employee_name: e.name,
          date_str: targetDate,
          kind: 'falta',
          description: 'Detectada manualmente: empleado con turno programado y sin registro de entrada.',
          status: 'open',
        }))

      if (absenceInserts.length > 0) {
        for (const payload of absenceInserts) {
          if (await insertIncidenciaOnce(admin, payload)) summary.absences++
        }
      }
    }
  }

  // ── 2. detect-shifts: abandono y salida temprana ──
  const { data: shifts } = await admin
    .from('shifts')
    .select('id, employee_id, branch_id, entry_time, exit_time, status')
    .eq('tenant_id', tenantId)
    .eq('date_str', targetDate)
    .not('entry_time', 'is', null)
    .in('status', ['open', 'closed'])

  if (shifts && shifts.length > 0) {
    const empIds = [...new Set(shifts.map(s => s.employee_id))]
    const { data: emps } = await admin
      .from('employees')
      .select('id, name, branch_id, schedule, is_mixed, free_schedule, has_shift')
      .eq('tenant_id', tenantId)
      .in('id', empIds)
    const empMap = new Map((emps || []).map(e => [e.id, e]))

    const mixedEmpIds = (emps || []).filter(e => e.is_mixed).map(e => e.id)
    let plansMap = new Map()
    if (mixedEmpIds.length > 0) {
      const { data: plans } = await admin
        .from('shift_plans')
        .select('employee_id, entry_time_str, exit_time_str, duration_hours')
        .eq('tenant_id', tenantId)
        .eq('date_str', targetDate)
        .in('employee_id', mixedEmpIds)
      plansMap = new Map((plans || []).map(p => [p.employee_id, p]))
    }

    const { data: vacs } = await admin
      .from('vacation_periods')
      .select('employee_id, tipo, status')
      .eq('tenant_id', tenantId)
      .in('employee_id', empIds)
      .lte('start_date', targetDate)
      .gte('end_date', targetDate)
    const onVacation = new Set(
      (vacs || [])
        .filter(v => v.tipo === 'tomadas' && ['active', 'completed', 'pending', 'postponed'].includes(v.status))
        .map(v => v.employee_id)
    )

    const { data: existingIncs } = await admin
      .from('incidencias')
      .select('employee_id, kind')
      .eq('tenant_id', tenantId)
      .eq('date_str', targetDate)
      .in('kind', ['abandono', 'salida_temprana'])
      .in('employee_id', empIds)
    const alreadyFlagged = new Set((existingIncs || []).map(i => `${i.employee_id}:${i.kind}`))

    const shiftInserts = []
    for (const shift of shifts) {
      const employee = empMap.get(shift.employee_id)
      if (!employee || employee.free_schedule || onVacation.has(employee.id)) continue

      const exitExpected = expectedExitUtc(shift, employee, plansMap, targetDate, targetDayKey)
      if (!exitExpected) continue

      if (!shift.exit_time && shift.status === 'open') {
        const cutoff = new Date(exitExpected.getTime() + GRACE_ABANDONO_MIN * 60000)
        if (now > cutoff && !alreadyFlagged.has(`${employee.id}:abandono`)) {
          shiftInserts.push({
            tenant_id: tenantId,
            branch_id: shift.branch_id || employee.branch_id || null,
            employee_id: employee.id,
            employee_name: employee.name,
            shift_id: shift.id,
            date_str: targetDate,
            kind: 'abandono',
            description: 'Detectada manualmente: empleado registró entrada pero no registró salida al terminar su turno.',
            status: 'open',
          })
        }
      }

      if (shift.exit_time && shift.status === 'closed') {
        const exitActual = new Date(shift.exit_time)
        const earlyMs = exitExpected.getTime() - exitActual.getTime()
        const earlyMin = Math.round(earlyMs / 60000)
        const expectedStr = formatInTimeZone(exitExpected, TZ, 'HH:mm')
        if (earlyMin > GRACE_EARLY_MIN && !alreadyFlagged.has(`${employee.id}:salida_temprana`)) {
          shiftInserts.push({
            tenant_id: tenantId,
            branch_id: shift.branch_id || employee.branch_id || null,
            employee_id: employee.id,
            employee_name: employee.name,
            shift_id: shift.id,
            date_str: targetDate,
            kind: 'salida_temprana',
            description: `Detectada manualmente: empleado salió ${earlyMin} minutos antes de su hora de salida programada (${expectedStr}).`,
            status: 'open',
          })
        }
      }
    }

    if (shiftInserts.length > 0) {
      for (const payload of shiftInserts) {
        if (await insertIncidenciaOnce(admin, payload)) summary.shift_incidents++
      }
    }
  }

  // ── 3. retardos threshold: empleado con N retardos en 30 dias ──
  // Config por sucursal: branches.config.retardosParaFalta. Fallback al tenant.
  // Si el valor es null/undefined/0 → no se generan alertas.
  // Idempotencia: solo una incidencia 4_retardos_falta por empleado en ventana de 30d.
  summary.retardo_threshold = 0
  {
    const cutoff30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const cutoffStr = isoDateInTz(cutoff30, TZ)
    const tenantThreshold = Number(cfg.retardosParaFalta) || null

    const { data: branches } = await admin
      .from('branches')
      .select('id, config')
      .eq('tenant_id', tenantId)
    const branchThresholds = new Map(
      (branches || []).map(b => [b.id, Number(b?.config?.retardosParaFalta) || null])
    )

    // Solo seguimos si al menos UNA branch (o tenant) tiene threshold configurado.
    const anyThreshold = tenantThreshold || [...branchThresholds.values()].some(Boolean)
    if (anyThreshold) {
      const { data: retardoShifts } = await admin
        .from('shifts')
        .select('employee_id, date_str, classification')
        .eq('tenant_id', tenantId)
        .gte('date_str', cutoffStr)
        .lte('date_str', targetDate)

      // Cuenta retardos por empleado (solo classification.type === 'retardo')
      const retardoCount = new Map()
      for (const s of (retardoShifts || [])) {
        if (s.classification?.type !== 'retardo') continue
        retardoCount.set(s.employee_id, (retardoCount.get(s.employee_id) || 0) + 1)
      }
      if (retardoCount.size > 0) {
        const empIds = [...retardoCount.keys()]
        const { data: emps } = await admin
          .from('employees')
          .select('id, name, branch_id, free_schedule, status')
          .in('id', empIds)
          .eq('tenant_id', tenantId)

        // Idempotencia: ya existe 4_retardos_falta para este empleado en los ultimos 30 dias?
        const { data: existingThresholdIncs } = await admin
          .from('incidencias')
          .select('employee_id, date_str')
          .eq('tenant_id', tenantId)
          .eq('kind', '4_retardos_falta')
          .gte('date_str', cutoffStr)
          .in('employee_id', empIds)
        const alreadyAlerted = new Set((existingThresholdIncs || []).map(i => i.employee_id))

        for (const emp of (emps || [])) {
          if (emp.status !== 'active' || emp.free_schedule) continue
          if (alreadyAlerted.has(emp.id)) continue

          const threshold = (emp.branch_id && branchThresholds.get(emp.branch_id)) || tenantThreshold
          if (!threshold) continue

          const count = retardoCount.get(emp.id) || 0
          if (count < threshold) continue

          const inserted = await insertIncidenciaOnce(admin, {
            tenant_id: tenantId,
            branch_id: emp.branch_id || null,
            employee_id: emp.id,
            employee_name: emp.name,
            date_str: targetDate,
            kind: '4_retardos_falta',
            description: `${count} retardos en los últimos 30 días (límite ${threshold}). Revisar manualmente: convertir a falta injustificada o dejar pasar.`,
            status: 'open',
          })
          if (inserted) summary.retardo_threshold++
        }
      }
    }
  }

  summary.total = summary.absences + summary.shift_incidents + (summary.retardo_threshold || 0)
  return NextResponse.json(summary)
}
