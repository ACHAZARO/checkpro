// src/app/api/vacations/check-status/[employee_id]/route.js
// Endpoint PUBLICO (sin auth de gerente) para el checador.
// Devuelve si el empleado esta en un periodo de vacaciones activo hoy.
// Protegido solo por tenant_id (el checador ya tiene el tenant_id en localStorage
// porque escaneo el QR de su sucursal).
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function todayISO() {
  // Fecha local del servidor en formato YYYY-MM-DD (TZ MX por default del server)
  const t = new Date()
  const y = t.getFullYear()
  const m = String(t.getMonth() + 1).padStart(2, '0')
  const d = String(t.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
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

    const admin = createServiceClient()
    const today = todayISO()

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
