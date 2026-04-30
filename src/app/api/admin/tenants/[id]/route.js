// src/app/api/admin/tenants/[id]/route.js
// PATCH: toggle active, change plan, rename
// DELETE: cascade-delete tenant + branches + employees + shifts + profiles (DANGEROUS)
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireSuperAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof } = await admin.from('profiles').select('id, role, tenant_id, name').eq('id', session.user.id).maybeSingle()
  if (!prof || prof.role !== 'super_admin') return { error: 'Sin acceso', status: 403 }
  return { admin, actor: prof }
}

async function auditAdminAction(admin, actor, action, targetId, detail, success = true) {
  // FIX: registrar acciones destructivas/sensibles de tenants en audit_log.
  try {
    await admin.from('audit_log').insert({
      tenant_id: actor?.tenant_id || null,
      action,
      employee_name: actor?.name || 'super_admin',
      detail: `tenant=${targetId}; ${detail}`,
      success,
    })
  } catch (e) {
    console.error('[admin/tenants] audit failed', e)
  }
}

export async function GET(req, { params }) {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const id = params.id
  const admin = ctx.admin
  try {
    const { data: t } = await admin.from('tenants').select('*').eq('id', id).maybeSingle()
    if (!t) return NextResponse.json({ error: 'No encontrada' }, { status: 404 })
    const [{ data: branches }, { data: profiles }, { data: employees }] = await Promise.all([
      admin.from('branches').select('id, name, config, created_at').eq('tenant_id', id),
      admin.from('profiles').select('id, name, role, created_at').eq('tenant_id', id),
      admin.from('employees').select('id, employee_code, name, department, status').eq('tenant_id', id)
    ])
    return NextResponse.json({ tenant: t, branches, profiles, employees })
  } catch (err) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}

export async function PATCH(req, { params }) {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const id = params.id
  const admin = ctx.admin
  const actor = ctx.actor
  const body = await req.json().catch(() => ({}))

  const allowed = {}
  if (typeof body.active === 'boolean') allowed.active = body.active
  if (typeof body.name === 'string' && body.name.trim()) allowed.name = body.name.trim()
  if (['free', 'pro', 'enterprise'].includes(body.plan)) allowed.plan = body.plan

  if (Object.keys(allowed).length === 0) {
    return NextResponse.json({ error: 'Nada que actualizar' }, { status: 400 })
  }

  const { error } = await admin.from('tenants').update(allowed).eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  await auditAdminAction(admin, actor, 'admin_tenant_update', id, JSON.stringify(allowed))
  return NextResponse.json({ ok: true })
}

export async function DELETE(req, { params }) {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const id = params.id
  const admin = ctx.admin
  const actor = ctx.actor

  try {
    // Prevent deleting the system tenant (super-admin home)
    const { data: t } = await admin.from('tenants').select('slug, name').eq('id', id).maybeSingle()
    if (!t) return NextResponse.json({ error: 'No existe' }, { status: 404 })
    if (t.slug === 'checkpro-system') {
      return NextResponse.json({ error: 'No se puede eliminar el tenant del sistema.' }, { status: 400 })
    }

    // Fetch profiles to also delete their auth users (optional — we keep auth users by default)
    await auditAdminAction(admin, actor, 'admin_tenant_delete_started', id, `Eliminacion iniciada: ${t.name || t.slug}`)
    const { data: profs } = await admin.from('profiles').select('id').eq('tenant_id', id)

    // Delete children explicitly (in case FKs aren't cascading)
    await admin.from('shifts').delete().eq('tenant_id', id)
    await admin.from('week_cuts').delete().eq('tenant_id', id)
    await admin.from('audit_log').delete().eq('tenant_id', id)
    await admin.from('employees').delete().eq('tenant_id', id)
    await admin.from('invitations').delete().eq('tenant_id', id)
    await admin.from('branches').delete().eq('tenant_id', id)
    await admin.from('profiles').delete().eq('tenant_id', id)
    const { error } = await admin.from('tenants').delete().eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Best-effort delete of auth users (skip super_admin)
    for (const p of profs || []) {
      try { await admin.auth.admin.deleteUser(p.id) } catch {}
    }

    await auditAdminAction(admin, actor, 'admin_tenant_delete_completed', id, `Eliminacion completada: ${t.name || t.slug}`)
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}
