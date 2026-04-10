// src/app/api/check/identify/route.js
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function POST(req) {
  try {
    const { tenantId, employeeCode } = await req.json()
    if (!tenantId || !employeeCode) return NextResponse.json({ found: false }, { status: 400 })
    const supabase = createServiceClient()
    const { data: emp, error } = await supabase.from('employees').select('id,name,department,role_label,can_manage,has_shift,monthly_salary,schedule,employee_code').eq('tenant_id', tenantId).eq('employee_code', employeeCode.toUpperCase()).eq('status', 'active').single()
    if (error || !emp) return NextResponse.json({ found: false })
    const { data: openShift } = await supabase.from('shifts').select('id,entry_time,status').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()
    const { data: allEmployees } = await supabase.from('employees').select('id,name,department').eq('tenant_id', tenantId).eq('status', 'active').eq('has_shift', true)
    return NextResponse.json({ found: true, employee: emp, openShift: openShift || null, allEmployees: allEmployees || [] })
  } catch (err) {
    return NextResponse.json({ found: false }, { status: 500 })
  }
}
