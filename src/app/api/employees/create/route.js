// src/app/api/employees/create/route.js
// Crea un empleado y, si la fecha de ingreso es pasada, hace backfill historico
// de vacation_periods (tipo='tomadas', status='completed') por cada aniversario
// ya cumplido. No genera deuda retroactiva: el proximo aniversario generara
// su periodo 'pending' de forma normal.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { anniversaryInfo, daysForYear } from '@/lib/vacations'

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

  // Read current employees to compute next code + tenant config for vacation table
  const [{ data: existing }, { data: tenant }] = await Promise.all([
    admin.from('employees').select('employee_code').eq('tenant_id', profile.tenant_id),
    admin.from('tenants').select('config').eq('id', profile.tenant_id).maybeSingle(),
  ])

  const employee_code = generateEmployeeCode(existing || [])
  const vacTable = tenant?.config?.vacation_table || tenant?.config?.vacationTable || null

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
    schedule: body.schedule || {},
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

  // Backfill historico de vacaciones si la hire_date es pasada.
  // Decision #3: asumimos que los aniversarios pasados ya fueron tomados.
  let backfilledPeriods = 0
  try {
    const info = anniversaryInfo(hire_date, new Date())
    const yearsWorked = info?.yearsWorked || 0
    if (yearsWorked > 0) {
      const rows = []
      for (let year = 1; year <= yearsWorked; year++) {
        rows.push({
          tenant_id: profile.tenant_id,
          branch_id,
          employee_id: inserted.id,
          anniversary_year: year,
          entitled_days: daysForYear(year, vacTable),
          prima_pct: 25.0,
          tipo: 'tomadas',
          status: 'completed',
          notes: 'Histórico (empleado con antigüedad previa al alta)',
        })
      }
      const { error: vpErr } = await admin.from('vacation_periods').insert(rows)
      if (vpErr) {
        // No revertimos el alta del empleado; solo reportamos.
        console.error('[employees/create] backfill vacation_periods fallo:', vpErr.message)
        return NextResponse.json({
          employee: inserted,
          backfilled_periods: 0,
          warning: `Empleado creado pero no se pudo crear el histórico de vacaciones: ${vpErr.message}`,
        })
      }
      backfilledPeriods = rows.length
    }
  } catch (e) {
    console.error('[employees/create] backfill exception:', e)
  }

  return NextResponse.json({ employee: inserted, backfilled_periods: backfilledPeriods })
}
