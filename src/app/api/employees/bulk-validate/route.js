// src/app/api/employees/bulk-validate/route.js
// Dry-run de carga masiva: valida formato y cruza contra BD para marcar
// duplicados, SIN escribir nada. El frontend muestra el preview con estos
// resultados y el usuario confirma antes de que llamemos a /bulk-create.
//
// Devuelve:
//   { results: [{ rowIndex, status:'valid'|'duplicate'|'error', errors:[], normalized:{...} }],
//     summary: { total, valid, duplicates, errors } }

import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { validateRows } from '@/lib/bulk-employees'

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

  // Verificar que la sucursal pertenece al tenant (defensa vs. manipulación cliente)
  const { data: branch } = await admin
    .from('branches')
    .select('id, tenant_id')
    .eq('id', branch_id)
    .maybeSingle()
  if (!branch || branch.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 })
  }

  // Cargar códigos y PINs existentes del tenant para marcar duplicados
  const { data: existing } = await admin
    .from('employees')
    .select('employee_code, pin')
    .eq('tenant_id', profile.tenant_id)
    .neq('status', 'deleted')

  const codesInDb = new Set((existing || []).map(e => String(e.employee_code || '').toUpperCase()).filter(Boolean))
  const pinsInDb = new Set((existing || []).map(e => String(e.pin || '')).filter(Boolean))

  const validated = validateRows(rows, { codesInDb, pinsInDb })

  // Clasificar cada fila en valid / duplicate / error. "duplicate" es un subtipo
  // de error que queremos diferenciar visualmente: la fila es válida en forma,
  // pero colisiona con un registro de BD → se omite (política "skip existing").
  const results = validated.map(v => {
    const isDuplicate = v.errors.some(e => e.includes('ya existe'))
    const onlyDuplicate = isDuplicate && v.errors.every(e => e.includes('ya existe'))
    let status
    if (v.errors.length === 0) status = 'valid'
    else if (onlyDuplicate) status = 'duplicate'
    else status = 'error'
    return {
      rowIndex: v.rowIndex,
      status,
      errors: v.errors,
      warnings: v.warnings,
      normalized: {
        nombre: v.normalized?.nombre,
        pin: v.normalized?.pin,
        codigo: v.normalized?.codigo,
      },
    }
  })

  const summary = {
    total: results.length,
    valid: results.filter(r => r.status === 'valid').length,
    duplicates: results.filter(r => r.status === 'duplicate').length,
    errors: results.filter(r => r.status === 'error').length,
  }

  return NextResponse.json({ results, summary })
}
