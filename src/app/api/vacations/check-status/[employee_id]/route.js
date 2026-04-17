// src/app/api/vacations/check-status/[employee_id]/route.js
// Endpoint PUBLICO (sin auth de gerente) para el checador.
// Devuelve si el empleado esta en un periodo de vacaciones activo hoy.
// Protegido por tenant_id (del QR de la sucursal) + validacion explicita
// de que el employee_id pertenece a ese tenant (anti cross-tenant leak).
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'
import { todayISOMX } from '@/lib/utils'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

export async function GET(req, { params }) {
  try {
    const employeeId = params?.employee_id
    const { searchParams } = new URL(req.url)
    const tenantId = searchParams.get('tenant_id')

    if (!employeeId || !tenantId) {
      return NextResponse.json(
        { ok: false, error: 'employee_id y tenant_id son requeridos' },
        { status: 400 }
      )
    }

    // Rate-limit: 30 requests / 5 min por (tenant, IP, employee).
    // Protege contra enumeracion cross-tenant y scraping.
    const ip = getClientIp(req)
    const rl = rateLimit(`vac_check_status:${tenantId}:${ip}:${employeeId}`, 30, 5 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, error: `Demasiados intentos. Espera ${Math.ceil(rl.retryAfter / 60)} min.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const admin = createServiceClient()

    // 1) Verificar que employee_id pertenezca al tenant_id declarado.
    //    Si no, devolver la misma respuesta que si no hubiera periodo
    //    (no enumerar existencia de empleados cross-tenant).
    const { data: emp, error: empErr } = await admin
      .from('employees')
      .select('id')
      .eq('id', employeeId)
      .eq('tenant_id', tenantId)
      .maybeSingle()

    if (empErr) {
      return NextResponse.json({ ok: false, error: empErr.message }, { status: 500 })
    }
    if (!emp) {
      // Mismo shape que "no hay periodo" para no revelar info.
      return NextResponse.json({ ok: true, onVacation: false, period: null })
    }

    // 2) Ya validado, buscar periodo activo.
    const today = todayISOMX()

    const { data: period, error } = await admin
      .from('vacation_periods')
      .select('id, start_date, end_date, entitled_days, tipo, status')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('status', 'active')
      .lte('start_date', today)
      .gte('end_date', today)
      .maybeSingle()

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 })
    }

    if (!period) {
      return NextResponse.json({ ok: true, onVacation: false, period: null })
    }

    return NextResponse.json({
      ok: true,
      onVacation: true,
      period: {
        id: period.id,
        start_date: period.start_date,
        end_date: period.end_date,
        entitled_days: period.entitled_days,
        tipo: period.tipo,
      },
    })
  } catch (err) {
    console.error('vacations/check-status error:', err?.message)
    return NextResponse.json({ ok: false, error: 'Error interno' }, { status: 500 })
  }
}
