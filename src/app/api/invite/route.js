// src/app/api/invite/route.js
// Owner creates an invitation for a manager.
// Uses Supabase admin.inviteUserByEmail so the recipient gets a real email
// from Supabase's SMTP; our redirectTo lands them on /accept-invite.
import { NextResponse } from 'next/server'
import { randomBytes } from 'crypto'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

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

// GET: list invitations for the tenant (owner-only)
export async function GET() {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (profile.role !== 'owner' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  const { data, error } = await admin
    .from('invitations')
    .select('id, email, role, branch_id, expires_at, accepted_at, created_at')
    .eq('tenant_id', profile.tenant_id)
    .order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ invitations: data || [] })
}

// POST: create invitation + send magic link
export async function POST(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (profile.role !== 'owner' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Solo el propietario puede invitar gerentes' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const email = String(body.email || '').trim().toLowerCase()
  const branchId = body.branchId || null
  if (!email || !email.includes('@')) return NextResponse.json({ error: 'Correo inválido' }, { status: 400 })
  if (!branchId) return NextResponse.json({ error: 'Falta la sucursal' }, { status: 400 })

  // Verify branch belongs to tenant
  const { data: branch } = await admin.from('branches').select('id, tenant_id, name').eq('id', branchId).maybeSingle()
  if (!branch || branch.tenant_id !== profile.tenant_id) {
    return NextResponse.json({ error: 'Sucursal inválida' }, { status: 400 })
  }

  // Create invitation token
  const token = randomBytes(24).toString('base64url')

  const { data: inv, error: invErr } = await admin
    .from('invitations')
    .insert({
      tenant_id: profile.tenant_id,
      branch_id: branchId,
      email,
      role: 'manager',
      token,
      invited_by: profile.id
    })
    .select()
    .single()
  if (invErr) return NextResponse.json({ error: invErr.message }, { status: 500 })

  // Build redirect URL
  const origin = process.env.NEXT_PUBLIC_APP_URL
    || req.headers.get('origin')
    || `https://${req.headers.get('host')}`
  const redirectTo = `${origin}/accept-invite?token=${encodeURIComponent(token)}`

  // Fire Supabase invite email (creates auth user in unconfirmed state if not exists,
  // sends a magic link).
  const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(email, {
    redirectTo,
    data: {
      invitation_token: token,
      tenant_id: profile.tenant_id,
      branch_id: branchId,
      role: 'manager'
    }
  })

  if (mailErr) {
    // If user already exists (invited before or has an account), inviteUserByEmail may fail.
    // Fall back to magiclink generation — still delivers a working link.
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email,
      options: { redirectTo }
    })
    if (linkErr) {
      return NextResponse.json({
        error: 'La invitación se registró pero no se pudo enviar el correo: ' + (mailErr.message || linkErr.message),
        invitationId: inv.id,
        manualLink: redirectTo
      }, { status: 500 })
    }
  }

  return NextResponse.json({
    ok: true,
    invitation: {
      id: inv.id,
      email,
      branchId,
      branchName: branch.name,
      expiresAt: inv.expires_at
    }
  })
}

// DELETE: cancel an invitation
export async function DELETE(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (profile.role !== 'owner' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Sin acceso' }, { status: 403 })
  }
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'Falta id' }, { status: 400 })
  const { error } = await admin
    .from('invitations')
    .delete()
    .eq('id', id)
    .eq('tenant_id', profile.tenant_id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
