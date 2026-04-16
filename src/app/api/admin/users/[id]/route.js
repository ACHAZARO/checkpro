// src/app/api/admin/users/[id]/route.js
// Super-admin actions on a single user:
// - PATCH action=disable / enable (ban / unban)
// - PATCH action=reset_password (send recovery email)
// - PATCH action=confirm_email
// - PATCH action=set_role (owner, manager, super_admin)
// - DELETE: remove auth user + profile (only if not super_admin themselves)
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function requireSuperAdmin() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof } = await admin.from('profiles').select('role, id').eq('id', session.user.id).maybeSingle()
  if (!prof || prof.role !== 'super_admin') return { error: 'Sin acceso', status: 403 }
  return { admin, selfId: prof.id }
}

export async function PATCH(req, { params }) {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin } = ctx
  const id = params.id
  const body = await req.json().catch(() => ({}))
  const action = body.action

  try {
    switch (action) {
      case 'disable': {
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: '876000h' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, action })
      }
      case 'enable': {
        const { error } = await admin.auth.admin.updateUserById(id, { ban_duration: 'none' })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, action })
      }
      case 'confirm_email': {
        const { error } = await admin.auth.admin.updateUserById(id, { email_confirm: true })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, action })
      }
      case 'reset_password': {
        // Look up email
        const { data: u } = await admin.auth.admin.getUserById(id)
        const email = u?.user?.email
        if (!email) return NextResponse.json({ error: 'Usuario sin email' }, { status: 400 })
        const origin = process.env.NEXT_PUBLIC_APP_URL
          || req.headers.get('origin')
          || `https://${req.headers.get('host')}`
        const { error } = await admin.auth.admin.generateLink({
          type: 'recovery',
          email,
          options: { redirectTo: `${origin}/login` }
        })
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, action, email })
      }
      case 'set_role': {
        const role = body.role
        if (!['owner', 'manager', 'super_admin'].includes(role)) {
          return NextResponse.json({ error: 'Rol inválido' }, { status: 400 })
        }
        const { error } = await admin.from('profiles').update({ role }).eq('id', id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
        return NextResponse.json({ ok: true, action, role })
      }
      default:
        return NextResponse.json({ error: 'Acción desconocida' }, { status: 400 })
    }
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'action failed' }, { status: 500 })
  }
}

export async function DELETE(req, { params }) {
  const ctx = await requireSuperAdmin()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, selfId } = ctx
  const id = params.id

  if (id === selfId) {
    return NextResponse.json({ error: 'No puedes eliminar tu propia cuenta desde aquí.' }, { status: 400 })
  }

  try {
    // Check role — refuse to delete another super_admin from the API
    const { data: prof } = await admin.from('profiles').select('role').eq('id', id).maybeSingle()
    if (prof?.role === 'super_admin') {
      return NextResponse.json({ error: 'No se puede eliminar a otro super admin.' }, { status: 400 })
    }
    // Delete profile first (tenant stays — owner may be re-linked)
    await admin.from('profiles').delete().eq('id', id)
    const { error } = await admin.auth.admin.deleteUser(id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'delete failed' }, { status: 500 })
  }
}
