// src/app/api/vacations/[id]/cancel/route.js
// Cancela un periodo de vacaciones (pending | active | postponed -> cancelled).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { rateLimit } from '@/lib/rate-limit'
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

  const { data: period, error: pErr } = await admin
    .from('vacation_periods')
    .select('*')
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
    .maybeSingle()
  if (pErr || !period) {
    return NextResponse.json({ ok: false, error: 'Periodo no encontrado' }, { status: 404 })
  }
  if (!['pending', 'active', 'postponed'].includes(period.status)) {
    return NextResponse.json({
      ok: false,
      error: `No se puede cancelar un periodo ${period.status}`,
    }, { status: 400 })
  }

  // BUG I: si el periodo ya esta en curso (active y hoy >= start_date), el
  // gerente debe usar early-return en lugar de cancelar. Cancelar borraria
  // el rastro de los dias ya consumidos y corrompe el balance.
  if (period.status === 'active' && period.start_date) {
    const today = todayISOMX()
    const startStr = String(period.start_date).slice(0, 10)
    if (today >= startStr) {
      return NextResponse.json(
        {
          ok: false,
          error: 'Usa POST /early-return para cerrar periodos en curso.',
        },
        { status: 400 }
      )
    }
  }

  const { data: updated, error: upErr } = await admin
    .from('vacation_periods')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .select('*')
    .single()
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

  // Audit
  try {
    const { data: emp } = await admin
      .from('employees')
      .select('name')
      .eq('id', period.employee_id)
      .maybeSingle()
    await admin.from('audit_log').insert({
      tenant_id: profile.tenant_id,
      action: 'vacation_cancel',
      employee_id: period.employee_id,
      employee_name: emp?.name || null,
      detail: `Cancela periodo ${id} (estaba ${period.status})`,
      success: true,
    })
  } catch {}

  return NextResponse.json({ ok: true, period: updated })
}
