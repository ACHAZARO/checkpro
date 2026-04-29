// src/app/api/invite/[id]/route.js
// FIX: manager flow integrado
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient, findAuthUserByEmail } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthedProfile() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof } = await admin
    .from('profiles')
    .select('id, tenant_id, role, branch_id, name')
    .eq('id', session.user.id)
    .maybeSingle()
  if (!prof) return { error: 'Perfil no encontrado', status: 403 }
  return { profile: prof, admin }
}

export async function PATCH(req, { params }) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  const id = params?.id
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })

  const body = await req.json().catch(() => ({}))
  const action = body.action
  if (!['cancel', 'revoke'].includes(action)) {
    return NextResponse.json({ error: 'Accion invalida' }, { status: 400 })
  }

  const { data: invitation, error: invErr } = await admin
    .from('invitations')
    .select('id, email, tenant_id, invited_by')
    .eq('id', id)
    .maybeSingle()
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
  if (!invitation || invitation.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Invitacion no encontrada' }, { status: 404 })
  }

  const canManage = profile.role === 'owner'
    || profile.role === 'super_admin'
    || invitation.invited_by === profile.id
  if (!canManage) return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })

  if (action === 'revoke') {
    let user = null
    try {
      user = await findAuthUserByEmail(admin, invitation.email)
    } catch (e) {
      return NextResponse.json({ error: e.message || 'No se pudo buscar el usuario' }, { status: 500 })
    }
    if (user?.id) {
      const { error: profileErr } = await admin
        .from('profiles')
        .delete()
        .eq('id', user.id)
        .eq('tenant_id', profile.tenant_id)
        .eq('role', 'manager')
      if (profileErr) return NextResponse.json({ error: profileErr.message }, { status: 500 })
    }
  }

  const { error: updErr } = await admin
    .from('invitations')
    .update({
      expires_at: new Date().toISOString(),
      ...(action === 'revoke' ? { accepted_at: null } : {}),
    })
    .eq('id', invitation.id)
    .eq('tenant_id', profile.tenant_id)
  if (updErr) return NextResponse.json({ error: updErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, action })
}
