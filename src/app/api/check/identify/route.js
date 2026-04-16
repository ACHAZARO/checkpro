// src/app/api/check/identify/route.js
// NO filtra PII (salario, schedule) antes de validar PIN.
// Retorna lo mínimo para que el kiosk muestre el saludo y la lista de cobertura.
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

const CODE_RE = /^[A-Z0-9]{1,20}$/

export async function POST(req) {
  try {
    const { tenantId, employeeCode } = await req.json()
    if (!tenantId || !employeeCode) {
      return NextResponse.json({ found: false, error: 'Datos incompletos' }, { status: 400 })
    }

    const code = String(employeeCode).toUpperCase()
    if (!CODE_RE.test(code)) {
      return NextResponse.json({ found: false })
    }

    const ip = getClientIp(req)
    const rl = rateLimit(`identify:${tenantId}:${ip}`, 20, 10 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { found: false, error: `Demasiados intentos. Espera ${Math.ceil(rl.retryAfter / 60)} min.` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    const supabase = createServiceClient()

    const { data: emp } = await supabase
      .from('employees')
      .select('id,name')
      .eq('tenant_id', tenantId)
      .eq('employee_code', code)
      .eq('status', 'active')
      .single()

    if (!emp) {
      return NextResponse.json({ found: false })
    }

    const { data: openShift } = await supabase
      .from('shifts')
      .select('id,entry_time')
      .eq('tenant_id', tenantId)
      .eq('employee_id', emp.id)
      .eq('status', 'open')
      .maybeSingle()

    const { data: coverageList } = await supabase
      .from('employees')
      .select('id,name,department')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .eq('has_shift', true)
      .neq('id', emp.id)

    return NextResponse.json({
      found: true,
      employee: { id: emp.id, name: emp.name },
      openShift: openShift ? { id: openShift.id, entry_time: openShift.entry_time } : null,
      allEmployees: coverageList || [],
    })
  } catch (err) {
    console.error('identify/route error:', err?.message)
    return NextResponse.json({ found: false, error: 'Error interno' }, { status: 500 })
  }
}
