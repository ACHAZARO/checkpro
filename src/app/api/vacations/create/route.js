// src/app/api/vacations/create/route.js
// Crea un periodo de vacaciones (tomadas | pospuestas | compensadas).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import {
  anniversaryInfo,
  daysForYear,
  extendForHolidays,
  computeCompensationAmount,
  checkLFTWarnings,
  LFT_2023_DEFAULT,
} from '@/lib/vacations'
import { todayISOMX } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const DAY_KEYS = ['dom', 'lun', 'mar', 'mie', 'jue', 'vie', 'sab']

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

function parseISODateLocal(value) {
  if (!value) return null
  const s = String(value).slice(0, 10)
  const parts = s.split('-')
  if (parts.length !== 3) return null
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function toISODate(date) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function addDaysLocal(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + n)
  return d
}

// Calcula end_date sumando N dias laborales (segun schedule) a partir de start_date.
// Incluye start_date como dia 1 si es laboral; si no, busca el primer dia laboral.
// Si schedule no tiene ningun dia marcado como work, asume dias calendario.
// BUG E: cap aumentado a 730 (2 anos) para cubrir part-time extremo + festivos.
// Si se excede, devolvemos null -> el caller reporta 400.
function computeEndDateFromSchedule(startISO, workingDays, schedule) {
  const start = parseISODateLocal(startISO)
  if (!start || !Number.isFinite(workingDays) || workingDays <= 0) return startISO
  const hasSchedule = schedule && typeof schedule === 'object' &&
    Object.values(schedule).some(v => v && v.work)
  if (!hasSchedule) {
    // Dias calendario
    return toISODate(addDaysLocal(start, workingDays - 1))
  }
  let cursor = new Date(start)
  let counted = 0
  // BUG E: cap 730 (2 anos). Suficiente para 28 dias LFT con jornada 2d/semana
  // (~98 dias calendario) + buffer generoso de festivos/extensiones.
  const CAP = 730
  for (let i = 0; i < CAP; i++) {
    const key = DAY_KEYS[cursor.getDay()]
    const day = schedule[key]
    if (day && day.work) counted += 1
    if (counted >= workingDays) return toISODate(cursor)
    cursor = addDaysLocal(cursor, 1)
  }
  // No se alcanzaron los dias solicitados dentro del cap -> schedule invalido.
  return null
}

export async function POST(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx

  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const employee_id = body.employee_id
  const tipo = body.tipo
  if (!employee_id) return NextResponse.json({ ok: false, error: 'employee_id requerido' }, { status: 400 })
  if (!['tomadas', 'pospuestas', 'compensadas'].includes(tipo)) {
    return NextResponse.json({ ok: false, error: 'tipo invalido' }, { status: 400 })
  }

  // Cargar empleado + tenant
  const [{ data: employee, error: empErr }, { data: tenant, error: tenErr }] = await Promise.all([
    admin.from('employees').select('*').eq('id', employee_id).eq('tenant_id', profile.tenant_id).maybeSingle(),
    admin.from('tenants').select('config').eq('id', profile.tenant_id).maybeSingle(),
  ])
  if (empErr || !employee) {
    return NextResponse.json({ ok: false, error: 'Empleado no encontrado' }, { status: 404 })
  }
  if (tenErr) {
    return NextResponse.json({ ok: false, error: tenErr.message }, { status: 500 })
  }

  const vacTable = tenant?.config?.vacation_table || tenant?.config?.vacationTable || null
  const holidays = Array.isArray(tenant?.config?.holidays) ? tenant.config.holidays : []

  // anniversary_year: tolerar number o string numerico
  const annivRaw = Number(body.anniversary_year)
  let anniversary_year = Number.isFinite(annivRaw) && annivRaw > 0 ? Math.floor(annivRaw) : null
  if (!anniversary_year) {
    const info = anniversaryInfo(employee.hire_date, new Date())
    anniversary_year = (info?.yearsWorked || 0) + 1
  }

  // BUG 7: evitar duplicados por (employee_id, anniversary_year) cuando no estan cancelled/expired.
  {
    const { data: existing } = await admin
      .from('vacation_periods')
      .select('id, status, tipo')
      .eq('tenant_id', profile.tenant_id)
      .eq('employee_id', employee.id)
      .eq('anniversary_year', anniversary_year)
      .not('status', 'in', '(cancelled,expired)')
      .limit(1)
      .maybeSingle()
    if (existing) {
      return NextResponse.json(
        {
          ok: false,
          error: 'duplicate_anniversary',
          msg: `Ya existe un periodo activo para el aniversario ${anniversary_year}.`,
          existing_period_id: existing.id,
        },
        { status: 409 }
      )
    }
  }

  // BUG 8: aceptar entitled_days del cliente si viene (override de la tabla).
  // Si no viene, derivar de la tabla.
  const entitledRaw = Number(body.entitled_days)
  const entitled_days = Number.isFinite(entitledRaw) && entitledRaw > 0
    ? Math.floor(entitledRaw)
    : daysForYear(anniversary_year, vacTable)
  const ltfBaseline = daysForYear(anniversary_year, LFT_2023_DEFAULT)

  // BUG 12: prima_pct debe quedar [0, 100]; NaN -> 25 (default LFT).
  let prima_pct = 25
  if (body.prima_pct !== undefined && body.prima_pct !== null && body.prima_pct !== '') {
    const raw = Number(body.prima_pct)
    if (!Number.isFinite(raw)) {
      prima_pct = 25
    } else {
      prima_pct = Math.max(0, Math.min(100, raw))
    }
  }

  const warnings = checkLFTWarnings({
    entitledDays: entitled_days,
    ltfBaseline,
    primaPct: prima_pct,
  })

  const row = {
    tenant_id: profile.tenant_id,
    branch_id: employee.branch_id || null,
    employee_id: employee.id,
    anniversary_year,
    entitled_days,
    prima_pct,
    tipo,
    notes: body.notes ? String(body.notes) : null,
    approved_by: profile.id,
    approved_at: new Date().toISOString(),
  }

  if (tipo === 'tomadas') {
    const start_date = String(body.start_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
      return NextResponse.json({ ok: false, error: 'start_date requerido (YYYY-MM-DD)' }, { status: 400 })
    }
    let end_date = String(body.end_date || '').slice(0, 10)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
      // Calcular a partir de schedule + festivos
      const prelim = computeEndDateFromSchedule(start_date, entitled_days, employee.schedule)
      // BUG E: si excede el cap, reportar error claro.
      if (!prelim) {
        return NextResponse.json(
          {
            ok: false,
            error: 'No se pudo calcular end_date — revisa el schedule (muy pocos dias laborales o entitled_days excesivo).',
          },
          { status: 400 }
        )
      }
      // BUG 1: pasar holidays sin transformar — extendForHolidays ahora
      // acepta objetos { date } o strings y normaliza internamente.
      end_date = extendForHolidays(start_date, prelim, holidays)
    }
    // BUG 6: si el gerente tecleó end_date manualmente, validar que no quede
    // antes del start_date — antes pasaba y guardaba un periodo incoherente.
    if (end_date < start_date) {
      return NextResponse.json(
        { ok: false, error: 'end_date_before_start', msg: 'La fecha fin no puede ser anterior al inicio.' },
        { status: 400 }
      )
    }
    const today = todayISOMX()
    const isActive = start_date <= today && today <= end_date
    row.start_date = start_date
    row.end_date = end_date
    row.status = isActive ? 'active' : (start_date > today ? 'pending' : 'completed')
    if (row.status === 'completed') row.completed_at = new Date().toISOString()
  } else if (tipo === 'pospuestas') {
    row.status = 'postponed'
  } else if (tipo === 'compensadas') {
    const compensated_days = Number(body.compensated_days)
    if (!Number.isFinite(compensated_days) || compensated_days <= 0 || !Number.isInteger(compensated_days)) {
      return NextResponse.json(
        { ok: false, error: 'compensated_days debe ser entero positivo' },
        { status: 400 }
      )
    }
    // BUG 12: compensated_days <= entitled_days.
    if (compensated_days > entitled_days) {
      return NextResponse.json(
        {
          ok: false,
          error: `compensated_days (${compensated_days}) no puede exceder entitled_days (${entitled_days})`,
        },
        { status: 400 }
      )
    }
    // payment_type: body > employee.payment_type > schedule.payment_type > 'efectivo'
    const payment_type = body.payment_type
      || employee.payment_type
      || (employee.schedule && employee.schedule.payment_type)
      || 'efectivo'
    // BUG H: validar contra el CHECK constraint de la tabla antes del INSERT
    // para evitar el 500 generico de Postgres cuando llega un valor invalido.
    if (!['efectivo', 'transferencia'].includes(payment_type)) {
      return NextResponse.json(
        {
          ok: false,
          error: `payment_type invalido: "${payment_type}". Debe ser "efectivo" o "transferencia".`,
        },
        { status: 400 }
      )
    }
    const comp = computeCompensationAmount(employee, compensated_days)
    row.compensated_days = compensated_days
    row.compensated_amount = comp.amount
    row.payment_type = payment_type
    row.status = 'completed'
    row.completed_at = new Date().toISOString()
  }

  const { data: inserted, error: insErr } = await admin
    .from('vacation_periods')
    .insert(row)
    .select('*')
    .single()
  if (insErr) {
    return NextResponse.json({ ok: false, error: insErr.message }, { status: 500 })
  }

  // Audit
  try {
    await admin.from('audit_log').insert({
      tenant_id: profile.tenant_id,
      action: 'vacation_create',
      employee_id: employee.id,
      employee_name: employee.name,
      detail: `Periodo ${tipo} (anio ${anniversary_year}, ${entitled_days} dias, status=${row.status})`,
      success: true,
    })
  } catch {}

  return NextResponse.json({ ok: true, period: inserted, warnings })
}
