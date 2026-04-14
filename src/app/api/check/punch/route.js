// src/app/api/check/punch/route.js
import { createServiceClient } from '@/lib/supabase-server'
import { NextResponse } from 'next/server'
import { classifyEntry, isoDate, diffHrs } from '@/lib/utils'

export async function POST(req) {
  try {
    const { tenantId, employeeCode, pin, action, coveringEmployeeId, geo } = await req.json()
    const supabase = createServiceClient()
    const { data: authResult } = await supabase.rpc('validate_employee_pin', { p_tenant_id: tenantId, p_code: employeeCode.toUpperCase(), p_pin: pin })
    if (!authResult?.valid) return NextResponse.json({ ok: false, msg: 'PIN incorrecto' })
    const emp = authResult.employee
    if (!geo?.valid) return NextResponse.json({ ok: false, msg: `Fuera del Ã¡rea (${geo?.dist}m)` })
    const { data: tenant } = await supabase.from('tenants').select('config').eq('id', tenantId).single()
    const cfg = tenant?.config || {}
    const now = new Date().toISOString()
    if (action === 'in') {
      const { data: existing } = await supabase.from('shifts').select('id').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()
      if (existing) return NextResponse.json({ ok: false, msg: 'Ya tienes jornada abierta' })
      const classification = classifyEntry(emp.schedule||{}, now, cfg.toleranceMinutes||10)
      const holidays = cfg.holidays||[]
      const holiday = holidays.find(h => h.date === isoDate(now))
      await supabase.from('shifts').insert({ tenant_id: tenantId, employee_id: emp.id, date_str: isoDate(now), entry_time: now, status: 'open', classification, is_holiday: !!holiday, holiday_name: holiday?.name||null, covering_employee_id: coveringEmployeeId||null, geo_entry: geo })
      await supabase.from('audit_log').insert({ tenant_id: tenantId, action: 'CHK_IN', employee_id: emp.id, employee_name: emp.name, detail: classification.label, success: true })
      return NextResponse.json({ ok: true, msg: `Entrada registrada. ${classification.label}${holiday ? ' â FERIADO Ã3!' : ''}` })
    } else {
      const { data: openShift } = await supabase.from('shifts').select('*').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()
      if (!openShift) return NextResponse.json({ ok: false, msg: 'Sin entrada registrada' })
      const duration = parseFloat(diffHrs(openShift.entry_time, now).toFixed(2))
      await supabase.from('shifts').update({ exit_time: now, duration_hours: duration, status: 'closed', geo_exit: geo }).eq('id', openShift.id)
      await supabase.from('audit_log').insert({ tenant_id: tenantId, action: 'CHK_OUT', employee_id: emp.id, employee_name: emp.name, detail: `${duration}h`, success: true })
      return NextResponse.json({ ok: true, msg: `Salida registrada. Jornada: ${duration} hs.` })
    }
  } catch (err) {
    return NextResponse.json({ ok: false, msg: 'Error interno' }, { status: 500 })
  }
}
