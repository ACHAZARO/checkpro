// src/app/api/vacations/[id]/employee-return/route.js
// Variante PUBLICA de early-return para el checador.
// Autentica al empleado con su PIN (RPC validate_employee_pin), no con sesion de gerente.
// Solo permite reincorporar si el empleado dueno del periodo coincide con el PIN validado.
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { rateLimit } from '@/lib/rate-limit'
import { todayISOMX } from '@/lib/utils'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
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

function formatDMY(iso) {
  const d = parseISODateLocal(iso)
  if (!d) return iso
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`
}

const CODE_RE = /^[A-Z0-9]{1,20}$/
const PIN_RE = /^\d{4,8}$/

export async function POST(req, { params }) {
  try {
    const id = params?.id
    if (!id) {
      return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 })
    }

    const body = await req.json().catch(() => ({}))
    const { tenantId, employeeCode, pin } = body

    if (!tenantId || !employeeCode || !pin) {
      return NextResponse.json(
        { ok: false, error: 'tenantId, employeeCode y pin son requeridos' },
        { status: 400 }
      )
    }

    const code = String(employeeCode).toUpperCase()
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ ok: false, error: 'Codigo invalido' }, { status: 400 })
    }
    if (!PIN_RE.test(String(pin))) {
      return NextResponse.json({ ok: false, error: 'PIN invalido' }, { status: 400 })
    }

    const ip = getClientIp(req)
    const rl = rateLimit(`vac_return:${tenantId}:${ip}:${code}`, 5, 15 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: `Demasiados intentos. Espera ${Math.ceil(rl.retryAfter / 60)} min.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const admin = createServiceClient()

    // Validar PIN con la misma RPC que usa /api/check/punch
    const { data: authResult } = await admin.rpc('validate_employee_pin', {
      p_tenant_id: tenantId,
      p_code: code,
      p_pin: String(pin),
    })

    if (!authResult?.valid) {
      await admin.from('audit_log').insert({
        tenant_id: tenantId,
        action: 'PIN_REJECTED',
        employee_name: code,
        detail: `PIN incorrecto (employee-return) - IP ${ip}`,
        success: false,
      })
      return NextResponse.json({ ok: false, error: 'Credenciales incorrectas' }, { status: 401 })
    }
    const emp = authResult.employee

    const { data: period, error: pErr } = await admin
      .from('vacation_periods')
      .select('*')
      .eq('id', id)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (pErr || !period) {
      return NextResponse.json({ ok: false, error: 'Periodo no encontrado' }, { status: 404 })
    }

    if (period.employee_id !== emp.id) {
      await admin.from('audit_log').insert({
        tenant_id: tenantId,
        action: 'VAC_RETURN_REJ',
        employee_id: emp.id,
        employee_name: emp.name,
        detail: `Empleado intento reincorporar periodo que no le pertenece (${id})`,
        success: false,
      })
      return NextResponse.json(
        { ok: false, error: 'Este periodo no pertenece al empleado autenticado' },
        { status: 403 }
      )
    }

    if (period.status !== 'active') {
      return NextResponse.json(
        {
          ok: false,
          error: `Solo periodos activos admiten reincorporacion temprana (status actual: ${period.status})`,
        },
        { status: 400 }
      )
    }

    const return_date = todayISOMX()
    const returnD = parseISODateLocal(return_date)

    // BUG 11/8: validar return_date dentro de [start_date, end_date+1].
    // - returnD == periodStart ⇒ el empleado decidió no tomar vacaciones
    //   hoy mismo; antes lo rechazábamos como "fuera de rango" aunque
    //   check-status dijera onVacation=true. Ahora lo tratamos como
    //   cancelación (nunca descansó) y conservamos el balance intacto.
    // - returnD > periodStart ⇒ cierre temprano normal (completed,
    //   end_date = returnD - 1).
    // - returnD == periodEnd+1 ⇒ caso degenerado (regresa el día que
    //   termina), end_date queda igual y status completed.
    const periodStart = parseISODateLocal(period.start_date)
    const periodEnd = parseISODateLocal(period.end_date)
    if (!periodStart || !periodEnd) {
      return NextResponse.json({ ok: false, error: 'Periodo con fechas invalidas' }, { status: 400 })
    }
    const maxReturn = addDaysLocal(periodEnd, 1)
    if (returnD < periodStart || returnD > maxReturn) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Fecha de reincorporacion fuera del rango del periodo',
        },
        { status: 400 }
      )
    }

    // BUG T: cap en longitud de notes para evitar crecimiento sin bound.
    const existingNotes = period.notes ? `${period.notes} | ` : ''
    const sameDay = returnD.getTime() === periodStart.getTime()
    const baseNote = sameDay
      ? `Reincorporacion el mismo dia de inicio ${formatDMY(return_date)} — periodo cancelado (sin dias consumidos)`
      : `Reincorporacion temprana ${formatDMY(return_date)} (desde checador)`
    let newNotes = `${existingNotes}${baseNote}`
    if (newNotes.length > 1000) {
      newNotes = '…' + newNotes.slice(-999)
    }

    // BUG 8: si returnD === periodStart, status=cancelled (no consumió
    // ningún día). Si returnD > periodStart, end_date = returnD - 1.
    const patch = sameDay
      ? { status: 'cancelled', notes: newNotes }
      : {
          status: 'completed',
          end_date: toISODate(addDaysLocal(returnD, -1)),
          completed_at: new Date().toISOString(),
          notes: newNotes,
        }

    const { data: updated, error: upErr } = await admin
      .from('vacation_periods')
      .update(patch)
      .eq('id', id)
      .select('*')
      .single()

    if (upErr) {
      // BUG 5: no filtrar error.message crudo en endpoint público.
      console.error('employee-return update error:', upErr?.message)
      return NextResponse.json({ ok: false, error: 'internal' }, { status: 500 })
    }

    await admin.from('audit_log').insert({
      tenant_id: tenantId,
      action: sameDay ? 'vacation_cancelled_self_sameday' : 'vacation_early_return_self',
      employee_id: emp.id,
      employee_name: emp.name,
      detail: sameDay
        ? `Cancelacion (mismo dia de inicio) periodo ${id} el ${return_date}`
        : `Reincorporacion temprana (auto-servicio) periodo ${id} el ${return_date} (end_date -> ${patch.end_date})`,
      success: true,
    })

    return NextResponse.json({ ok: true, period: updated })
  } catch (err) {
    console.error('employee-return error:', err?.message)
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
