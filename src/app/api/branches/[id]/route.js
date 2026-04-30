// src/app/api/branches/[id]/route.js
// Get, update, delete a single branch.
// Owner: full access. Manager: can only UPDATE operational config of own branch,
// and cannot change name, cannot delete, cannot create.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Fields managers are allowed to mutate inside branch.config
const MANAGER_CONFIG_FIELDS = new Set([
  'toleranceMinutes','absenceMinutes','prepCloseMinutes','coveragePayMode','alertHours','weekClosingDay',
  'location','businessHours','holidays','restDays',
  'printHeader','printLegalText','printFooter'
]) // FIX: permitir que managers guarden preparacion de cierre y tarifa de cobertura por sucursal.

async function getAuthedProfile() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof } = await admin
    .from('profiles')
    .select('id, tenant_id, role, branch_id')
    .eq('id', session.user.id)
    .maybeSingle()
  if (!prof) return { error: 'Perfil no encontrado', status: 403 }
  return { profile: prof, admin }
}

export async function GET(_req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  const { data, error } = await admin.from('branches').select('*').eq('id', params.id).single()
  if (error || !data) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  if (data.tenant_id !== profile.tenant_id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  const isOwner = profile.role === 'owner' || profile.role === 'super_admin'
  if (!isOwner && profile.branch_id !== data.id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  return NextResponse.json({ branch: data })
}

export async function PATCH(req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  const body = await req.json().catch(() => ({}))

  const { data: current, error: curErr } = await admin.from('branches').select('*').eq('id', params.id).single()
  if (curErr || !current) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
  if (current.tenant_id !== profile.tenant_id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  const isOwner = profile.role === 'owner' || profile.role === 'super_admin'
  if (!isOwner && profile.branch_id !== current.id) {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }

  const patch = {}
  if (isOwner) {
    if (typeof body.name === 'string') patch.name = body.name
    if (typeof body.active === 'boolean') patch.active = body.active
    if (body.config && typeof body.config === 'object') {
      patch.config = { ...(current.config || {}), ...body.config }
    }
  } else {
    // Manager: only allowed keys inside config
    if (body.config && typeof body.config === 'object') {
      const filtered = {}
      for (const k of Object.keys(body.config)) {
        if (MANAGER_CONFIG_FIELDS.has(k)) filtered[k] = body.config[k]
      }
      patch.config = { ...(current.config || {}), ...filtered }
    }
  }

  if (Object.keys(patch).length === 0) return NextResponse.json({ branch: current })

  const { data, error } = await admin.from('branches').update(patch).eq('id', params.id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ branch: data })
}

export async function DELETE(_req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (profile.role !== 'owner' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Solo el propietario puede eliminar sucursales' }, { status: 403 })
  }

  const { data: current } = await admin.from('branches').select('id, tenant_id').eq('id', params.id).single()
  if (!current || current.tenant_id !== profile.tenant_id) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  // Safety: prevent deleting the last branch of a tenant.
  const { count } = await admin
    .from('branches')
    .select('id', { count: 'exact', head: true })
    .eq('tenant_id', profile.tenant_id)
  if ((count || 0) <= 1) {
    return NextResponse.json({ error: 'No puedes eliminar la única sucursal. Crea otra primero.' }, { status: 400 })
  }

  const { error } = await admin.from('branches').delete().eq('id', params.id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
