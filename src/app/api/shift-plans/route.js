// src/app/api/shift-plans/route.js
// feat/mixed-schedule — CRUD para el planificador semanal de empleados mixtos.
// - GET  ?start=YYYY-MM-DD&end=YYYY-MM-DD  → lista de planes del tenant en ese rango
// - POST { plans: [{ employee_id, date_str, entry_time_str, duration_hours }] }
//     → upsert batch. Plans sin entry_time_str se borran (desmarcar día).
import { NextResponse } from 'next/server'
import { createServerSupabase } from '@/lib/supabase-server'
import { createClient } from '@supabase/supabase-js'
import { addHoursToTimeStr } from '@/lib/utils'

function serviceClient() {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

async function getProfile() {
  const supabase = createServerSupabase()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null
  const { data: prof } = await supabase.from('profiles').select('*').eq('id', user.id).single()
  return prof
}

export async function GET(req) {
  const prof = await getProfile()
  if (!prof?.tenant_id) return NextResponse.json({ error: 'no_tenant' }, { status: 401 })

  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start')
  const end = searchParams.get('end')
  if (!start || !end) return NextResponse.json({ error: 'missing_range' }, { status: 400 })

  const sb = serviceClient()
  const { data, error } = await sb
    .from('shift_plans')
    .select('*')
    .eq('tenant_id', prof.tenant_id)
    .gte('date_str', start)
    .lte('date_str', end)
    .order('date_str')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ plans: data || [] })
}

export async function POST(req) {
  const prof = await getProfile()
  if (!prof?.tenant_id) return NextResponse.json({ error: 'no_tenant' }, { status: 401 })
  if (!['owner','manager','super_admin'].includes(prof.role)) {
    return NextResponse.json({ error: 'forbidden' }, { status: 403 })
  }

  let body
  try { body = await req.json() } catch { return NextResponse.json({ error: 'bad_json' }, { status: 400 }) }
  const plans = Array.isArray(body?.plans) ? body.plans : []
  if (!plans.length) return NextResponse.json({ ok: true, saved: 0, deleted: 0 })

  const sb = serviceClient()
  const tenant_id = prof.tenant_id
  const created_by = prof.id

  // Validar empleados pertenecen al tenant y son mixtos
  const empIds = [...new Set(plans.map(p => p.employee_id).filter(Boolean))]
  const { data: emps } = await sb
    .from('employees')
    .select('id, is_mixed, daily_hours, tenant_id')
    .in('id', empIds)
  const empMap = new Map((emps || []).map(e => [e.id, e]))
  for (const e of (emps || [])) {
    if (e.tenant_id !== tenant_id) {
      return NextResponse.json({ error: 'cross_tenant' }, { status: 403 })
    }
  }

  // Separar: los que tienen entry_time_str → upsert; los que no → delete
  const toUpsert = []
  const toDelete = []
  for (const p of plans) {
    if (!p.employee_id || !p.date_str) continue
    const emp = empMap.get(p.employee_id)
    if (!emp || !emp.is_mixed) continue
    if (p.entry_time_str) {
      const duration = Number(p.duration_hours || emp.daily_hours || 8)
      toUpsert.push({
        tenant_id,
        employee_id: p.employee_id,
        date_str: p.date_str,
        entry_time_str: p.entry_time_str,
        duration_hours: duration,
        exit_time_str: addHoursToTimeStr(p.entry_time_str, duration),
        notes: p.notes || null,
        created_by,
      })
    } else {
      toDelete.push({ employee_id: p.employee_id, date_str: p.date_str })
    }
  }

  let saved = 0
  let deleted = 0

  if (toUpsert.length) {
    const { error } = await sb
      .from('shift_plans')
      .upsert(toUpsert, { onConflict: 'tenant_id,employee_id,date_str' })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    saved = toUpsert.length
  }

  if (toDelete.length) {
    for (const d of toDelete) {
      const { error } = await sb
        .from('shift_plans')
        .delete()
        .eq('tenant_id', tenant_id)
        .eq('employee_id', d.employee_id)
        .eq('date_str', d.date_str)
      if (!error) deleted++
    }
  }

  return NextResponse.json({ ok: true, saved, deleted })
}
