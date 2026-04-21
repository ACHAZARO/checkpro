// src/app/api/employees/bulk-create/route.js
// Importación real. Re-valida server-side (no confiamos en el cliente), omite
// duplicados y errores, y hace UN solo INSERT por lote. Si falla, devuelve el
// error pero los válidos que alcanzaron a pasar antes del fallo no se deshacen
// parcialmente porque usamos un único insert (atomico per-batch).

import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { validateRows, buildSchedulePayload } from '@/lib/bulk-employees'

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

// Genera el siguiente código EMP### tras el máximo existente. Se reutiliza para
// cada fila sin código del archivo, incrementando secuencialmente.
function nextCode(counter) {
  counter.n += 1
  return `EMP${String(counter.n).padStart(3, '0')}`
}

export async function POST(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx

  if (!['owner', 'manager', 'super_admin'].includes(profile.role)) {
    return NextResponse.json({ error: 'Sin permisos para crear empleados' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const rows = Array.isArray(body.rows) ? body.rows : []
  const branch_id = body.branch_id || null

  if (!branch_id) return NextResponse.json({ error: 'Sucursal requerida' }, { status: 400 })
  if (rows.length === 0) return NextResponse.json({ error: 'Archivo sin filas' }, { status: 400 })
  if (rows.length > 500) return NextResponse.json({ error: 'Máximo 500 filas por archivo' }, { status: 400 })

  const { data: branch } = await admin
    .from('branches')
    .select('id, name, tenant_id')
    .eq('id', branch_id)
    .maybeSingle()
  if (!branch || branch.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 })
  }

  // Snapshot de códigos/PINs existentes para detectar duplicados + calcular próximo EMP###
  const { data: existing } = await admin
    .from('employees')
    .select('employee_code, pin, is_mixed, status')
    .eq('tenant_id', profile.tenant_id)
    .neq('status', 'deleted')

  const codesInDb = new Set((existing || []).map(e => String(e.employee_code || '').toUpperCase()).filter(Boolean))
  const pinsInDb = new Set((existing || []).map(e => String(e.pin || '')).filter(Boolean))
  const mixedCount = (existing || []).filter(e => e.is_mixed && e.status === 'active').length

  // feat/mixed-schedule: enforcement server-side del límite de mixtos.
  const { data: tenantRow } = await admin
    .from('tenants')
    .select('config')
    .eq('id', profile.tenant_id)
    .maybeSingle()
  const mixedCfg = tenantRow?.config?.mixedSchedule || { enabled: false }

  // Contador para nextCode — empieza en el máximo numérico existente
  const maxNum = (existing || []).reduce((m, e) => {
    const n = parseInt(String(e.employee_code || '').replace(/\D/g, ''), 10)
    return Number.isFinite(n) && n > m ? n : m
  }, 0)
  const counter = { n: maxNum }

  // Validar de nuevo en el server (no confiamos en lo que mandó el cliente)
  const validated = validateRows(rows, { codesInDb, pinsInDb, mixedCfg, mixedCount })

  // Construir payloads solo para filas sin errores
  const toInsert = []
  const skipped = []
  for (const v of validated) {
    if (v.errors.length > 0) {
      skipped.push({ rowIndex: v.rowIndex, errors: v.errors })
      continue
    }
    const n = v.normalized
    const code = n.codigo || nextCode(counter)
    // Evitar colisión si el auto-generado chocara con otro auto-generado del mismo lote
    // (teóricamente imposible porque counter es monotónico, pero defensa extra)
    if (codesInDb.has(code)) {
      skipped.push({ rowIndex: v.rowIndex, errors: [`Código ${code} ya existe`] })
      continue
    }
    codesInDb.add(code)

    toInsert.push({
      tenant_id: profile.tenant_id,
      branch_id,
      employee_code: code,
      name: n.nombre,
      pin: n.pin,
      department: n.departamento || '',
      role_label: n.puesto || 'Empleado',
      can_manage: n.puede_administrar || false,
      has_shift: true,
      monthly_salary: n.salario_mensual || 0,
      payment_type: n.tipo_pago || 'efectivo',
      birth_date: n.fecha_nacimiento || null,
      hire_date: n.fecha_ingreso,
      // feat/mixed-schedule: si es mixto, schedule queda "descanso todos los
      // días" (ya asi lo deja validateRow), daily_hours trae la duracion, y
      // is_mixed marca el flag. El planificador se encarga del horario diario.
      is_mixed: !!n.is_mixed,
      daily_hours: n.is_mixed ? n.daily_hours : null,
      schedule: buildSchedulePayload(n.schedule, branch, n.fecha_ingreso),
      status: 'active',
    })
  }

  if (toInsert.length === 0) {
    return NextResponse.json({
      created: 0,
      skipped,
      error: 'Ninguna fila válida para importar',
    }, { status: 400 })
  }

  const { data: inserted, error: insErr } = await admin
    .from('employees')
    .insert(toInsert)
    .select('id, employee_code, name')

  if (insErr) {
    console.error('[employees/bulk-create] db error', insErr)
    return NextResponse.json({
      error: insErr.message || 'Error de base de datos al importar',
      detail: insErr.details || null,
    }, { status: 500 })
  }

  // Log de auditoría (best-effort, no bloquea la respuesta si falla)
  try {
    await admin.from('audit_log').insert({
      tenant_id: profile.tenant_id,
      action: 'bulk_employee_import',
      detail: {
        created: inserted?.length || 0,
        skipped: skipped.length,
        branch_id,
        branch_name: branch.name,
      },
      success: true,
    })
  } catch (e) {
    console.error('[employees/bulk-create] audit log failed', e)
  }

  return NextResponse.json({
    created: inserted?.length || 0,
    employees: inserted || [],
    skipped,
  })
}
