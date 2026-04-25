// src/app/api/accept-invite/route.js
// Accept an invitation: validates token, verifies/creates auth user with the
// given password, creates profile with role=manager + branch_id.
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { createServiceClient, findAuthUserByEmail } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// GET: preview an invitation (used by accept-invite page to show branch + tenant name)
export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const token = searchParams.get('token')
    if (!token) return NextResponse.json({ error: 'Falta token' }, { status: 400 })

    const admin = createServiceClient()
    const { data: inv, error } = await admin
      .from('invitations')
      .select('id, email, role, branch_id, expires_at, accepted_at, tenant_id')
      .eq('token', token)
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!inv) return NextResponse.json({ error: 'Invitación no encontrada' }, { status: 404 })
    if (inv.accepted_at) return NextResponse.json({ error: 'Esta invitación ya fue usada' }, { status: 410 })
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Invitación expirada' }, { status: 410 })

    const { data: branch } = await admin.from('branches').select('name').eq('id', inv.branch_id).maybeSingle()
    const { data: tenant } = await admin.from('tenants').select('name').eq('id', inv.tenant_id).maybeSingle()

    return NextResponse.json({
      email: inv.email,
      role: inv.role,
      branchName: branch?.name || null,
      tenantName: tenant?.name || null
    })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Error' }, { status: 500 })
  }
}

// POST: accept invitation — body { token, name, password }
export async function POST(req) {
  try {
    const body = await req.json().catch(() => ({}))
    const token = String(body.token || '').trim()
    const name = String(body.name || '').trim()
    const password = String(body.password || '')
    if (!token || !name || !password) {
      return NextResponse.json({ error: 'Faltan datos (nombre, contraseña, token).' }, { status: 400 })
    }
    if (password.length < 8) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 })
    }

    const admin = createServiceClient()

    const { data: inv, error: invErr } = await admin
      .from('invitations')
      .select('*')
      .eq('token', token)
      .maybeSingle()
    if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })
    if (!inv) return NextResponse.json({ error: 'Invitación no encontrada' }, { status: 404 })
    if (inv.accepted_at) return NextResponse.json({ error: 'Esta invitación ya fue usada' }, { status: 410 })
    if (new Date(inv.expires_at) < new Date()) return NextResponse.json({ error: 'Invitación expirada' }, { status: 410 })

    const email = String(inv.email).toLowerCase()

    // Find or create the auth user
    let userId = null

    // Find existing user (Supabase inviteUserByEmail may have created one)
    let existing
    try { existing = await findAuthUserByEmail(admin, email) } catch (e) {
      return NextResponse.json({ error: e.message }, { status: 500 })
    }

    if (existing) {
      userId = existing.id
      // Set password + ensure email confirmed
      const upd = await admin.auth.admin.updateUserById(userId, {
        password,
        email_confirm: true,
        user_metadata: { ...(existing.user_metadata || {}), name }
      })
      if (upd.error) return NextResponse.json({ error: upd.error.message }, { status: 500 })
    } else {
      const created = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, invited: true }
      })
      if (created.error) return NextResponse.json({ error: created.error.message }, { status: 500 })
      userId = created.data?.user?.id
    }

    if (!userId) return NextResponse.json({ error: 'No se pudo obtener el usuario' }, { status: 500 })

    // Upsert profile with role=manager + branch_id
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, tenant_id, role, branch_id')
      .eq('id', userId)
      .maybeSingle()

    if (existingProfile) {
      const { error: upErr } = await admin
        .from('profiles')
        .update({
          tenant_id: inv.tenant_id,
          branch_id: inv.branch_id,
          role: existingProfile.role === 'owner' || existingProfile.role === 'super_admin' ? existingProfile.role : 'manager',
          name,
          status: 'active'
        })
        .eq('id', userId)
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    } else {
      const { error: insErr } = await admin
        .from('profiles')
        .insert({
          id: userId,
          tenant_id: inv.tenant_id,
          branch_id: inv.branch_id,
          name,
          role: 'manager',
          status: 'active'
        })
      if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })
    }

    // Mark invitation accepted
    await admin
      .from('invitations')
      .update({ accepted_at: new Date().toISOString() })
      .eq('id', inv.id)

    return NextResponse.json({ ok: true, email })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Error al aceptar invitación' }, { status: 500 })
  }
}
