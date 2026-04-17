// src/app/api/vacations/[id]/early-return/route.js
// Reincorporacion temprana: periodo activo -> completed.
// Regla: el ultimo dia de vacaciones es return_date - 1 (el empleado regresa
// trabajando el return_date).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { todayISOMX } from '@/lib/utils'

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

export async function POST(req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ ok: false, error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ ok: false, error: 'Sin permisos' }, { status: 403 })
  }

  const id = params?.id
  if (!id) return NextResponse.json({ ok: false, error: 'id requerido' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const return_date = /^\d{4}-\d{2}-\d{2}$/.test(body.return_date || '')
    ? body.return_date
    : todayISOMX()

  const { data: period, error: pErr } = await admin
    .from('vacation_periods')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()
  if (pErr || !period) {
    return NextResponse.json({ ok: false, error: 'Periodo no encontrado' }, { status: 404 })
  }
  if (period.status !== 'active') {
    return NextResponse.json({
      ok: false,
      error: `Solo periodos activos admiten reincorporacion temprana (status actual: ${period.status})`,
    }, { status: 400 })
  }

  // end_date = return_date - 1 dia
  const returnD = parseISODateLocal(return_date)
  if (!returnD) return NextResponse.json({ ok: false, error: 'return_date invalido' }, { status: 400 })

  // BUG 11: validar return_date dentro de (start_date, end_date+1].
  const periodStart = parseISODateLocal(period.start_date)
  const periodEnd = parseISODateLocal(period.end_date)
  if (!periodStart || !periodEnd) {
    return NextResponse.json({ ok: false, error: 'Periodo con fechas invalidas' }, { status: 400 })
  }
  const maxReturn = addDaysLocal(periodEnd, 1)
  if (returnD <= periodStart || returnD > maxReturn) {
    return NextResponse.json(
      { ok: false, error: 'return_date fuera del rango del periodo' },
      { status: 400 }
    )
  }

  const newEndISO = toISODate(addDaysLocal(returnD, -1))

  const existingNotes = period.notes ? `${period.notes} | ` : ''
  const newNotes = `${existingNotes}Reincorporación temprana ${formatDMY(return_date)}`

  const { data: updated, error: upErr } = await admin
    .from('vacation_periods')
    .update({
      status: 'completed',
      end_date: newEndISO,
      completed_at: new Date().toISOString(),
      notes: newNotes,
    })
    .eq('id', id)
    .select('*')
    .single()
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

  try {
    const { data: emp } = await admin
      .from('employees').select('name').eq('id', period.employee_id).maybeSingle()
    await admin.from('audit_log').insert({
      tenant_id: profile.tenant_id,
      action: 'vacation_early_return',
      employee_id: period.employee_id,
      employee_name: emp?.name || null,
      detail: `Reincorporacion temprana periodo ${id} el ${return_date} (end_date -> ${newEndISO})`,
      success: true,
    })
  } catch {}

  return NextResponse.json({ ok: true, period: updated })
}
