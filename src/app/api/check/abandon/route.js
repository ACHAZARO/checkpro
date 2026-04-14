// src/app/api/check/abandon/route.js
// Called by the check page when the employee leaves both GPS zone AND branch WiFi
// for more than 20 minutes with an open shift.
// Auto-closes the shift at the moment they left and creates an incident for manager review.
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { diffHrs } from '@/lib/utils'

export async function POST(req) {
  try {
    const { tenantId, employeeId, reason, leftAt } = await req.json()
    // reason: 'gps' | 'ip' | 'both'
    // leftAt: ISO string of when employee left the zone (used as exit_time)

    const supabase = createServiceClient()

    // Find open shift
    const { data: openShift } = await supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .eq('employee_id', employeeId)
      .eq('status', 'open')
      .single()

    if (!openShift) {
      return NextResponse.json({ ok: false, msg: 'No open shift found' })
    }

    const exitTime = leftAt || new Date().toISOString()
    const duration = parseFloat(diffHrs(openShift.entry_time, exitTime).toFixed(2))

    const reasonLabel = {
      gps: 'Salió del perímetro GPS',
      ip: 'Salió de la red WiFi de la sucursal',
      both: 'Salió del perímetro GPS y de la red WiFi',
    }[reason] || 'Abandonó la sucursal'

    await supabase.from('shifts').update({
      exit_time: exitTime,
      duration_hours: Math.max(0, duration),
      status: 'incident',
      incidents: [{
        type: 'abandonment',
        reason,
        note: `${reasonLabel} — turno cerrado automáticamente`,
        detectedAt: new Date().toISOString(),
        leftAt: exitTime,
        autoClose: true,
      }],
    }).eq('id', openShift.id)

    await supabase.from('audit_log').insert({
      tenant_id: tenantId,
      action: 'AUTO_CLOSE',
      employee_id: employeeId,
      detail: `${reasonLabel}. Duración: ${duration}h`,
      success: true,
    })

    return NextResponse.json({
      ok: true,
      msg: 'Turno cerrado automáticamente',
      duration,
      reason,
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ ok: false, msg: 'Error al cerrar turno' }, { status: 500 })
  }
}
