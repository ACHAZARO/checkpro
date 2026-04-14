// src/app/api/check/punch/route.js
import { createServiceClient } from 'A/lib/supabase'
import { NextResponse } from 'next/server'
import { classifyEntry, isoDate, diffHrs } from 'A/lib/utils'

export async function POST(req) {
  try {
    const { tenantId, employeeCode, pin, action, coveringEmployeeId, geo } = await req.json()
    const supabase = createServiceClient()

    // 1. Validate PIN via DB function
    const { data: authResult } = await supabase.rpc('validate_employee_pin', {
      p_tenant_id: tenantId,
      p_code: employeeCode.toUpperCase(),
      p_pin: pin
    })

    if (!authResult?.valid) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'PIN_REJECTED',
        employee_name: employeeCode, detail: 'PIN incorrecto', success: false
      })
      return NextResponse.json({ ok: false, msg: 'PIN incorrecto. Intento registrado.' })
    }

    const emp = authResult.employee

    // 2. Validate GPS
    if (!geo?.valid) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: action === 'in' ? 'CHK_IN_REJ' : 'CHK_OUT_REJ',
        employee_id: emp.id, employee_name: emp.name,
        detail: `Fuera de área: ${geo?.dist}m`, success: false
      })
      return NextResponse.json({ ok: false, msg: `Fuera del área autorizada (${geo?.dist}m). Acércate a la sucursal.` })
    }

    // 3. Get tenant config
    const { data: tenant } = await supabase.from('tenants').select('config').eq('id', tenantId).single()
    const cfg = tenant?.config || {}

    const now = new Date().toISOString()
    const dateStr = isoDate(now)

    if (action === 'in') {
      // Check no open shift exists
      const { data: existing } = await supabase.from('shifts')
        .select('id').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()

      if (existing) {
        return NextResponse.json({ ok: false, msg: 'Ya tienes una jornada abierta. Registra tu salida primero.' })
      }

      // Classify entry
      const classification = classifyEntry(emp.schedule || {}, now, cfg.toleranceMinutes || 10)

      // Check holiday
      const holidays = cfg.holidays || []
      const holiday = holidays.find(h => h.date === dateStr)

      const coverName = coveringEmployeeId
        ? (await supabase.from('employees').select('name').eq('id', coveringEmployeeId).single())?.data?.name
        : null

      const { error } = await supabase.from('shifts').insert({
        tenant_id: tenantId,
        employee_id: emp.id,
        date_str: dateStr,
        entry_time: now,
        status: 'open',
        classification,
        is_holiday: !!holiday,
        holiday_name: holiday?.name || null,
        covering_employee_id: coveringEmployeeId || null,
        geo_entry: geo,
      })

      if (error) throw error

      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'CHK_IN',
        employee_id: emp.id, employee_name: emp.name,
        detail: `${classification.label}${coverName ? ' · Cubriendo: ' + coverName : ''}${holiday ? ' 🎉 FERIADO' : ''}`,
        success: true
      })

      return NextResponse.json({
        ok: true,
        msg: `Entrada registrada. ${classification.label}${coverName ? ' · Cubriendo a ' + coverName : ''}${holiday ? ' — Pago ×3 aplicado 🎉' : ''}.`
      })

    } else {
      // OUT
      const { data: openShift } = await supabase.from('shifts')
        .select('*').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()

      if (!openShift) {
        return NextResponse.json({ ok: false, msg: 'No tienes entrada registrada. Contacta a tu supervisor.' })
      }

      const duration = parseFloat(diffHrs(openShift.entry_time, now).toFixed(2))

      await supabase.from('shifts').update({
        exit_time: now,
        duration_hours: duration,
        status: 'closed',
        geo_exit: geo,
      }).eq('id', openShift.id)

      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'CHK_OUT',
        employee_id: emp.id, employee_name: emp.name,
        detail: `Duración: ${duration}h`,
        success: true
      })

      return NextResponse.json({ ok: true, msg: `Salida registrada. Jornada: ${duration} horas.` })
    }

  } catch (err) {
    console.error(err)
    return NextResponse.json({ ok: false, msg: 'Error interno del servidor.' }, { status: 500 })
  }
}
