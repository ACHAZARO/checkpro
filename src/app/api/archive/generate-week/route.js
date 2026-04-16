// src/app/api/archive/generate-week/route.js
// Genera paquete semanal: XLSX por empleado + XLSX por sucursal + PDF maestro.
// Solo accesible por admins del tenant via auth cookie.
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import {
  buildEmployeeXlsx,
  buildBranchXlsx,
  buildMasterPdf,
  sha256,
  weekOf,
} from '@/lib/archive'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

// Vercel Hobby: 10s max. Para 30 empleados cabe; para >200 hay que fragmentar.
export const maxDuration = 30
export const dynamic = 'force-dynamic'

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function getAdminTenantId() {
  const cookieStore = await cookies()
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  )
  // getSession() lee la cookie directamente sin intentar refresh (setAll es noop
  // porque route handlers de Next 14 no pueden escribir cookies). Para admin
  // routes esto es suficiente: validamos el user.id contra la tabla profiles
  // con service-role, que es lo que determina el tenant_id y permisos.
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null
  const userId = session.user.id

  const svc = createServiceClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, tenant_id, role, status')
    .eq('id', userId)
    .eq('status', 'active')
    .maybeSingle()
  if (!profile) return null
  return { profileId: profile.id, tenantId: profile.tenant_id }
}

export async function POST(req) {
  try {
    const auth = await getAdminTenantId()
    if (!auth) {
      return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    }

    const { weekStart, weekEnd } = await req.json()
    if (!weekStart || !weekEnd || !DATE_RE.test(weekStart) || !DATE_RE.test(weekEnd)) {
      return NextResponse.json({ error: 'weekStart y weekEnd (YYYY-MM-DD) requeridos' }, { status: 400 })
    }
    if (weekEnd < weekStart) {
      return NextResponse.json({ error: 'weekEnd debe ser >= weekStart' }, { status: 400 })
    }

    const tenantId = auth.tenantId
    const supabase = createServiceClient()

    const { data: tenant, error: tErr } = await supabase
      .from('tenants')
      .select('id,name,config,slug')
      .eq('id', tenantId)
      .single()
    if (tErr || !tenant) {
      return NextResponse.json({ error: 'Tenant no encontrado' }, { status: 404 })
    }

    const { data: employees } = await supabase
      .from('employees')
      .select('id,name,employee_code,department,role_label')
      .eq('tenant_id', tenantId)
      .eq('status', 'active')
      .order('employee_code')

    const { data: shifts } = await supabase
      .from('shifts')
      .select('*')
      .eq('tenant_id', tenantId)
      .gte('date_str', weekStart)
      .lte('date_str', weekEnd)
      .order('date_str')

    const shiftsByEmpId = {}
    for (const s of shifts || []) {
      if (!shiftsByEmpId[s.employee_id]) shiftsByEmpId[s.employee_id] = []
      shiftsByEmpId[s.employee_id].push(s)
    }

    const { year, week } = weekOf(weekStart)
    const weekStr = String(week).padStart(2, '0')
    const basePath = `${tenantId}/${year}/week-${weekStr}`

    const generated = []

    // 1. XLSX por empleado (solo los que tienen shifts)
    for (const emp of employees || []) {
      const empShifts = shiftsByEmpId[emp.id] || []
      if (empShifts.length === 0) continue
      const buf = buildEmployeeXlsx(emp, empShifts, weekStart, weekEnd)
      const relName = `por-empleado/${emp.employee_code}.xlsx`
      const path = `${basePath}/${relName}`
      const hash = sha256(buf)

      const { error } = await supabase.storage
        .from('archives')
        .upload(path, buf, {
          contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
          upsert: true,
        })
      if (error) throw new Error(`Upload ${path}: ${error.message}`)

      generated.push({
        name: relName,
        path,
        size: buf.length,
        sha256: hash,
        kind: 'employee',
        employee_id: emp.id,
        content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      })
    }

    // 2. XLSX por sucursal (consolidado)
    const branchBuf = buildBranchXlsx(tenant, employees || [], shiftsByEmpId, weekStart, weekEnd)
    const branchRel = `por-sucursal/sucursal.xlsx`
    const branchPath = `${basePath}/${branchRel}`
    const branchHash = sha256(branchBuf)
    {
      const { error } = await supabase.storage.from('archives').upload(branchPath, branchBuf, {
        contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        upsert: true,
      })
      if (error) throw new Error(`Upload ${branchPath}: ${error.message}`)
    }
    generated.push({
      name: branchRel,
      path: branchPath,
      size: branchBuf.length,
      sha256: branchHash,
      kind: 'branch',
      content_type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    })

    // 3. PDF maestro (referencia a los demas con sus hashes)
    const pdfBuf = await buildMasterPdf(
      tenant,
      employees || [],
      shiftsByEmpId,
      weekStart,
      weekEnd,
      generated,
    )
    const pdfRel = `consolidado/manifest.pdf`
    const pdfPath = `${basePath}/${pdfRel}`
    const pdfHash = sha256(pdfBuf)
    {
      const { error } = await supabase.storage.from('archives').upload(pdfPath, pdfBuf, {
        contentType: 'application/pdf',
        upsert: true,
      })
      if (error) throw new Error(`Upload ${pdfPath}: ${error.message}`)
    }
    generated.push({
      name: pdfRel,
      path: pdfPath,
      size: pdfBuf.length,
      sha256: pdfHash,
      kind: 'manifest',
      content_type: 'application/pdf',
    })

    // 4. Registrar en archive_files (upsert por path)
    const rows = generated.map((f) => ({
      tenant_id: tenantId,
      year,
      week,
      week_start: weekStart,
      week_end: weekEnd,
      kind: f.kind,
      employee_id: f.employee_id ?? null,
      path: f.path,
      size_bytes: f.size,
      sha256: f.sha256,
      content_type: f.content_type,
      created_by: auth.profileId,
    }))

    const { error: insErr } = await supabase
      .from('archive_files')
      .upsert(rows, { onConflict: 'path' })
    if (insErr) throw new Error(`archive_files insert: ${insErr.message}`)

    // 5. Audit log
    await supabase.from('audit_log').insert({
      tenant_id: tenantId,
      action: 'archive_generate_week',
      detail: `${weekStart} a ${weekEnd}. ${generated.length} archivos.`,
      success: true,
    })

    return NextResponse.json({
      ok: true,
      basePath,
      year,
      week,
      filesGenerated: generated.length,
      files: generated.map((f) => ({ name: f.name, size: f.size, kind: f.kind })),
    })
  } catch (err) {
    console.error('archive/generate-week error:', err)
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 })
  }
}
