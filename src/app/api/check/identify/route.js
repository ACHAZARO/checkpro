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
import crypto from 'crypto'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

const CODE_RE = /^[A-Z0-9]{1,20}$/
const TTL_MS = 4 * 60 * 60 * 1000

function secret() {
  const s = process.env.KIOSK_SESSION_SECRET
  if (!s) throw new Error('KIOSK_SESSION_SECRET no configurado')
  return s
}

function verifyToken(token) {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { sig, ...payload } = data
    const expected = crypto.createHmac('sha256', secret()).update(JSON.stringify(payload)).digest('hex')
    const a = Buffer.from(String(sig || ''))
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null // FIX: comparar firma en tiempo constante.
    if (Date.now() - payload.ts > TTL_MS) return null
    return payload
  } catch { return null }
}

export async function POST(req) {
  try {
    const { employeeCode, sessionToken, deviceId } = await req.json()
    const sess = verifyToken(sessionToken)
    if (!sess?.tenantId || (sess.deviceId && deviceId && sess.deviceId !== deviceId)) {
      return NextResponse.json({ found: false, error: 'Sesion invalida' }, { status: 401 })
    }
    const tenantId = sess.tenantId // FIX: tenant isolation desde sesion firmada, no desde body.
    if (!employeeCode) {
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
      .select('id,is_mixed')
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

    // Plan del dia para mixtos — solo si emp.is_mixed.
    let mixedPlanToday = null
    if (emp.is_mixed) {
      // Usamos TZ del tenant si esta configurada; por defecto MX.
      const { data: tenantRow } = await supabase
        .from('tenants')
        .select('config')
        .eq('id', tenantId)
        .maybeSingle()
      const tz = tenantRow?.config?.timezone || 'America/Mexico_City'
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
      employee: { is_mixed: !!emp.is_mixed }, // FIX: no filtrar PII antes de validar PIN.
      mixedPlanToday, // null para empleados fijos o mixtos sin plan
      openShift: openShift ? { open: true } : null, // FIX: no exponer hora de entrada antes del PIN.
      allEmployees: [],
    })
  } catch (err) {
    console.error('identify/route error:', err?.message)
    return NextResponse.json({ found: false, error: 'Error interno' }, { status: 500 })
  }
}
