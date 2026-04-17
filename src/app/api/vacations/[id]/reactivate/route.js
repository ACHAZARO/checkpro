// src/app/api/vacations/[id]/reactivate/route.js
// Reactiva un periodo expired. Si tiene start_date -> 'pending' (listo para tomar).
// Si no tiene start_date -> 'postponed' (vuelve al pool de pospuestas).
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { rateLimit } from '@/lib/rate-limit'

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
  if (period.status !== 'expired') {
    return NextResponse.json({
      ok: false,
      error: `Solo se pueden reactivar periodos expired (status actual: ${period.status})`,
    }, { status: 400 })
  }

  const newStatus = period.start_date ? 'pending' : 'postponed'
  const { data: updated, error: upErr } = await admin
    .from('vacation_periods')
    .update({ status: newStatus })
    .eq('id', id)
    .select('*')
    .single()
  if (upErr) return NextResponse.json({ ok: false, error: upErr.message }, { status: 500 })

  try {
    const { data: emp } = await admin
      .from('employees').select('name').eq('id', period.employee_id).maybeSingle()
    await admin.from('audit_log').insert({
      tenant_id: profile.tenant_id,
      action: 'vacation_reactivate',
      employee_id: period.employee_id,
      employee_name: emp?.name || null,
      detail: `Reactiva periodo ${id} expired -> ${newStatus}`,
      success: true,
    })
  } catch {}

  return NextResponse.json({ ok: true, period: updated })
}
