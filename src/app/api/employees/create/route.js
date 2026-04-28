// src/app/api/employees/create/route.js
// Crea un empleado y, si la fecha de ingreso es pasada, hace backfill historico
// de vacation_periods (tipo='tomadas', status='completed') por cada aniversario
// ya cumplido. No genera deuda retroactiva: el proximo aniversario generara
// su periodo 'pending' de forma normal.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { anniversaryInfo } from '@/lib/vacations'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthedProfile() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('id, tenant_id, role, branch_id')
    .eq('id', session.user.id)
    .maybeSingle()
  if (profErr || !prof) return { error: 'Perfil no encontrado', status: 403 }
  return { profile: prof, admin }
}

function generateEmployeeCode(existing) {
  const nums = (existing || [])
    .map(e => parseInt(String(e.employee_code || '').replace(/\D/g, ''), 10))
    .filter(n => Number.isFinite(n))
  const next = (nums.length ? Math.max(...nums) : 0) + 1
  return `EMP${String(next).padStart(3, '0')}`
}

export async function POST(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx

  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos para crear empleados' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  const pin = String(body.pin || '').trim()
  const hire_date = String(body.hire_date || '').slice(0, 10)
  const branch_id = body.branch_id || null

  if (!name) return NextResponse.json({ error: 'Nombre requerido' }, { status: 400 })
  if (!/^\d{4}$/.test(pin)) return NextResponse.json({ error: 'PIN debe ser 4 digitos' }, { status: 400 })
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hire_date)) return NextResponse.json({ error: 'Fecha de ingreso invalida' }, { status: 400 })
  if (!branch_id) return NextResponse.json({ error: 'Sucursal requerida' }, { status: 400 })

  // Read current employees to compute next code
  const { data: existing } = await admin
    .from('employees').select('employee_code').eq('tenant_id', profile.tenant_id)

  const employee_code = generateEmployeeCode(existing || [])

  // FIX: validate branch_id belongs to tenant before employee creation
  if (body.branch_id) {
    const { data: branchCheck } = await admin
      .from('branches')
      .select('id')
      .eq('id', body.branch_id)
      .eq('tenant_id', profile.tenant_id)
      .maybeSingle()
    if (!branchCheck) {
      return NextResponse.json({ ok: false, error: 'Sucursal no valida' }, { status: 400 })
    }
  }

  // feat/gerente-libre: normalizar flags mutuamente excluyentes
  const is_mixed = !!body.is_mixed
  const free_schedule = !!body.free_schedule && !!body.can_manage && !is_mixed
  const daily_hours = is_mixed ? (Number(body.daily_hours) || 8) : null
  const free_min_days_week = free_schedule
    ? Math.max(0, Math.min(7, parseInt(body.free_min_days_week ?? 5, 10) || 0))
    : null
  const free_min_hours_week = free_schedule
    ? Math.max(0, Math.min(168, parseFloat(body.free_min_hours_week ?? 40) || 0))
    : null

  const schedule = free_schedule ? {} : (body.schedule || {})

  if (!is_mixed && !free_schedule && body.has_shift !== false) {
    const hasWorkDay = Object.values(schedule).some(day => day && day.work === true)
    if (!hasWorkDay) {
      return NextResponse.json({ error: 'Horario requerido: selecciona al menos un día laboral.' }, { status: 400 })
    }
  }

  const payload = {
    tenant_id: profile.tenant_id,
    branch_id,
    employee_code,
    name,
    pin,
    department: String(body.department || ''),
    role_label: body.role_label || 'Empleado',
    can_manage: !!body.can_manage,
    has_shift: body.has_shift !== false,
    monthly_salary: Number(body.monthly_salary) || 0,
    payment_type: body.payment_type || 'efectivo',
    birth_date: body.birth_date || null,
    hire_date,
    schedule,
    is_mixed,
    daily_hours,
    free_schedule,
    free_min_days_week,
    free_min_hours_week,
    status: 'active',
  }

  const { data: inserted, error: insErr } = await admin
    .from('employees')
    .insert(payload)
    .select('*')
    .single()
  if (insErr) {
    console.error('[employees/create] db error', insErr)
    return NextResponse.json({ error: 'internal' }, { status: 500 })
  }

  // FIX R6: NO hacemos backfill automatico de vacation_periods historicos.
  // Antes insertabamos filas sin start_date/end_date (invalidas) y con un
  // warning silencioso. La decision correcta es conservadora:
  //   - Solo se crea el empleado.
  //   - Si la hire_date tiene antigüedad previa (yearsWorked > 0), devolvemos
  //     un backfill_warning para que la UI lo muestre al gerente y decida si
  //     capturar los años previos manualmente desde la ficha del empleado.
  //   - Dejar periodos con start_date/end_date null rompe otras consultas
  //     (widgets de dashboard, nomina, etc.), por eso preferimos no crearlos.
  let backfillWarning = null
  try {
    const info = anniversaryInfo(hire_date, new Date())
    const yearsWorked = info?.yearsWorked || 0
    if (yearsWorked > 0) {
      backfillWarning =
        `Se detectaron ${yearsWorked} año(s) previos al alta. No se crearon periodos automaticos. ` +
        `Agrega manualmente los años ya tomados desde la ficha del empleado si aplica.`
    }
  } catch (e) {
    console.error('[employees/create] anniversaryInfo exception:', e)
  }

  return NextResponse.json({
    employee: inserted,
    backfilled_periods: 0,
    backfill_warning: backfillWarning,
  })
}
