// src/app/api/check/identify/route.js
import { createServiceClient } from 'A/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req) {
  try {
    const { tenantId, employeeCode } = await req.json()
    if (!tenantId || !employeeCode) return NextResponse.json({ found: false, error: 'Datos incompletos' }, { status: 400 })

    const supabase = createServiceClient()

    // Find employee
    const { data: emp, error: empErr } = await supabase
      .from('employees')
      .select('id,name,department,role_label,can_manage,has_shift,monthly_salary,schedule,employee_code')
      .eq('tenant_id', tenantId)
      .eq('employee_code', employeeCode.toUpperCase())
      .eq('status', 'active')
      .single()

    if (empErr || !emp) return NextResponse.json({ found: false })

    // Check open shift
    const today = new Date().toISOString().slice(0, 10)
    const { data: openShift } = await supabase
      .from('shifts')
      .select('id,entry_time,status')
      .eq('tenant_id', tenantId)
      .eq('employee_id', emp.id)
      .eq('status', 'open')
      .single()

    // Get all active employees for coverage selection
    const { data: allEmployees } = await supabase
      .from('employees')
      .select('id,name,department')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .eq('has_shift', true)

    return NextResponse.json({ found: true, employee: emp, openShift: openShift || null, allEmployees: allEmployees || [] })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ found: false, error: 'Error interno' }, { status: 500 })
  }
}
