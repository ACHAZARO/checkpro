// src/app/api/vacations/[id]/resume/route.js
// Reactiva un periodo postponed -> active/pending con start_date (y end_date).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { extendForHolidays } from '@/lib/vacations'
import { todayISOMX } from '@/lib/utils'
import { rateLimit } from '@/lib/rate-limit'

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

function computeEndDateFromSchedule(startISO, workingDays, schedule) {
  const start = parseISODateLocal(startISO)
  if (!start || !Number.isFinite(workingDays) || workingDays <= 0) return startISO
  const hasSchedule = schedule && typeof schedule === 'object' &&
    Object.values(schedule).some(v => v && v.work)
  if (!hasSchedule) {
    return toISODate(addDaysLocal(start, workingDays - 1))
  }
  let cursor = new Date(start)
  let counted = 0
  for (let i = 0; i < 365; i++) {
    const key = DAY_KEYS[cursor.getDay()]
    const day = schedule[key]
    if (day && day.work) counted += 1
    if (counted >= workingDays) return toISODate(cursor)
    cursor = addDaysLocal(cursor, 1)
  }
  return toISODate(cursor)
}

export async function POST(req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  // BUG K: rate-limit para endpoints mutables autenticados.
  const rl = rateLimit(`vac_mut:${profile.id}`, 30, 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: 'Demasiadas peticiones, intenta en un minuto.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
    )
  }

  const id = params?.id
  if (!id) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const start_date = String(body.start_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start_date)) {
    return NextResponse.json({ ok: false, error: 'start_date requerido' }, { status: 400 })
  }

  // BUG C: rechazar start_date en el pasado. Si el gerente quiere registrar
  // vacaciones historicas (p.ej. para reconstruir el libro), debe usar
  // POST /api/vacations/create con fechas del pasado, que crea el periodo
  // directo en status 'completed'. Resume solo reanuda para hoy o futuro.
  if (start_date < todayISOMX()) {
    return NextResponse.json(
      {
        ok: false,
        error: 'Fecha de inicio en el pasado. Usa POST /create para registrar vacaciones historicas o usa fechas futuras.',
      },
      { status: 400 }
    )
  }

  const { data: period, error: pErr } = await admin
    .from('vacation_periods')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()
  if (pErr || !period) {
    return NextResponse.json({ ok: false, error: 'Periodo no encontrado' }, { status: 404 })
  }
  if (period.status !== 'postponed') {
    return NextResponse.json({
      ok: false,
      error: `Solo se pueden reanudar periodos postponed (status actual: ${period.status})`,
    }, { status: 400 })
  }

  // Necesitamos schedule del empleado y holidays del tenant para calcular end_date
  let end_date = String(body.end_date || '').slice(0, 10)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end_date)) {
    const [{ data: employee }, { data: tenant }] = await Promise.all([
      admin.from('employees').select('schedule').eq('id', period.employee_id).maybeSingle(),
      admin.from('tenants').select('config').eq('id', profile.tenant_id).maybeSingle(),
    ])
    const holidays = Array.isArray(tenant?.config?.holidays) ? tenant.config.holidays : []
    const prelim = computeEndDateFromSchedule(start_date, period.entitled_days, employee?.schedule)
    end_date = extendForHolidays(start_date, prelim, holidays)
  }

  const today = todayISOMX()
  const isActive = start_date <= today && today <= end_date
  const newStatus = isActive ? 'active' : (start_date > today ? 'pending' : 'completed')
  const patch = { status: newStatus, start_date, end_date }
  if (newStatus === 'completed') patch.completed_at = new Date().toISOString()

  const { data: updated, error: upErr } = await admin
    .from('vacation_periods')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single()
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

  try {
    const { data: emp } = await admin
      .from('employees').select('name').eq('id', period.employee_id).maybeSingle()
    await admin.from('audit_log').insert({
      tenant_id: profile.tenant_id,
      action: 'vacation_resume',
      employee_id: period.employee_id,
      employee_name: emp?.name || null,
      detail: `Reanuda periodo ${id}: ${start_date} -> ${end_date} (status=${newStatus})`,
      success: true,
    })
  } catch {}

  return NextResponse.json({ ok: true, period: updated })
}
