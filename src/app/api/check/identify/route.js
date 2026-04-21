// src/app/api/check/identify/route.js
// NO filtra PII (salario, schedule, birth_date) antes de validar PIN.
// Retorna lo mínimo para que el kiosk muestre el saludo y la lista de cobertura.
//
// feat/mixed-schedule — ademas devuelve:
//   - is_mixed: boolean
//   - mixedPlanToday: { entry_time_str, duration_hours, exit_time_str } | null
// para que la pantalla de checador muestre al empleado mixto su horario
// planificado del dia antes de pedir el PIN ("Hoy entras a las 8:00"),
// o avise "no tienes planificacion hoy" si el gerente olvidó agendarlo.
// Estos campos NO son PII: son informacion operativa del centro de trabajo
// equivalente al schedule semanal que ya se muestra a los empleados.
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { rateLimit } from '@/lib/rate-limit'
import { isoDate } from '@/lib/utils'

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

    // FIX R6: NO leer birth_date aqui — el endpoint identify es PUBLICO
    // (antes de validar PIN). Antes exponiamos PII (fecha de nacimiento)
    // a cualquier atacante que conociera employee_code.
    const { data: emp } = await supabase
      .from('employees')
      .select('id,name,can_manage,department,role_label,is_mixed')
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

    // Plan del dia para mixtos — solo si emp.is_mixed.
    let mixedPlanToday = null
    if (emp.is_mixed) {
      // Usamos TZ del tenant si esta configurada; por defecto MX.
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('config')
        .eq('id', tenantId)
        .maybeSingle()
      const tz = tenantRow?.config?.timezone || process.env.APP_TIMEZONE || 'America/Mexico_City'
      const dateStr = isoDate(new Date().toISOString(), tz)
      const { data: plan } = await supabase
        .from('shift_plans')
        .select('entry_time_str, duration_hours, exit_time_str')
        .eq('tenant_id', tenantId)
        .eq('employee_id', emp.id)
        .eq('date_str', dateStr)
        .maybeSingle()
      if (plan?.entry_time_str) {
        mixedPlanToday = {
          entry_time_str: plan.entry_time_str,
          duration_hours: Number(plan.duration_hours),
          exit_time_str: plan.exit_time_str,
        }
      }
    }

    return NextResponse.json({
      found: true,
      employee: {
        id: emp.id,
        name: emp.name,
        // FIX R6: birth_date removido — no filtrar PII antes de validar PIN
        can_manage: emp.can_manage,
        department: emp.department,
        role_label: emp.role_label,
        is_mixed: !!emp.is_mixed,
      },
      mixedPlanToday, // null para empleados fijos o mixtos sin plan
      openShift: openShift ? { id: openShift.id, entry_time: openShift.entry_time } : null,
      allEmployees: coverageList || [],
    })
  } catch (err) {
    console.error('identify/route error:', err?.message)
    return NextResponse.json({ found: false, error: 'Error interno' }, { status: 500 })
  }
}
