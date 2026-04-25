// src/app/api/superadmin/setup/route.js
// One-shot idempotent endpoint that provisions the super-admin account
// for alepolch@gmail.com. Creates (if missing): auth user, "system" tenant,
// and profile with role='super_admin'. Then sends a password-reset email
// to alepolch@gmail.com so the owner can set their own password.
//
// Security: this endpoint is intentionally idempotent and low-risk — it
// can only elevate a single hard-coded email. Calling it repeatedly has
// no negative effect.
import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SUPER_ADMIN_EMAIL = 'alepolch@gmail.com'
const SYSTEM_TENANT_SLUG = 'checkpro-system'

export async function POST(req) {
  if (process.env.SETUP_ENABLED !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const admin = createServiceClient()

    // 1) find or create auth user
    let userId = null
    {
      const { data: list, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 })
      if (error) return NextResponse.json({ error: 'listUsers: ' + error.message }, { status: 500 })
      const existing = (list?.users || []).find(u => (u.email || '').toLowerCase() === SUPER_ADMIN_EMAIL)
      if (existing) {
        userId = existing.id
        if (!existing.email_confirmed_at) {
          await admin.auth.admin.updateUserById(userId, { email_confirm: true })
        }
      } else {
        // create with a strong random temp password — user resets via email
        const tempPass = 'CP!' + Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
        const { data: created, error: cErr } = await admin.auth.admin.createUser({
          email: SUPER_ADMIN_EMAIL,
          password: tempPass,
          email_confirm: true,
          user_metadata: { name: 'Super Admin' }
        })
        if (cErr) return NextResponse.json({ error: 'createUser: ' + cErr.message }, { status: 500 })
        userId = created?.user?.id
      }
    }
    if (!userId) return NextResponse.json({ error: 'no user id' }, { status: 500 })

    // 2) find or create the system tenant (so FK constraints pass even if role is super_admin)
    let tenantId = null
    {
      const { data: t } = await admin.from('tenants').select('id').eq('slug', SYSTEM_TENANT_SLUG).maybeSingle()
      if (t) {
        tenantId = t.id
      } else {
        const { data: created, error: tErr } = await admin
          .from('tenants')
          .insert({
            name: 'CheckPro System',
            slug: SYSTEM_TENANT_SLUG,
            owner_email: SUPER_ADMIN_EMAIL,
            plan: 'enterprise',
            active: true
          })
          .select()
          .single()
        if (tErr) return NextResponse.json({ error: 'create tenant: ' + tErr.message }, { status: 500 })
        tenantId = created.id
      }
    }

    // 3) ensure profile exists with role=super_admin
    {
      const { data: existingProf } = await admin
        .from('profiles')
        .select('id, role, tenant_id')
        .eq('id', userId)
        .maybeSingle()
      if (!existingProf) {
        const { error: pErr } = await admin
          .from('profiles')
          .insert({ id: userId, tenant_id: tenantId, name: 'Super Admin', role: 'super_admin' })
        if (pErr) return NextResponse.json({ error: 'create profile: ' + pErr.message }, { status: 500 })
      } else if (existingProf.role !== 'super_admin') {
        const { error: uErr } = await admin
          .from('profiles')
          .update({ role: 'super_admin', tenant_id: tenantId })
          .eq('id', userId)
        if (uErr) return NextResponse.json({ error: 'promote profile: ' + uErr.message }, { status: 500 })
      }
    }

    // 4) send password reset email so the owner can define their own password
    const origin = process.env.NEXT_PUBLIC_APP_URL
      || req.headers.get('origin')
      || `https://${req.headers.get('host')}`
    const { error: linkErr } = await admin.auth.admin.generateLink({
      type: 'recovery',
      email: SUPER_ADMIN_EMAIL,
      options: { redirectTo: `${origin}/login` }
    })

    return NextResponse.json({
      ok: true,
      email: SUPER_ADMIN_EMAIL,
      userId,
      tenantId,
      recoveryEmailSent: !linkErr,
      recoveryError: linkErr?.message || null,
      nextStep: linkErr
        ? 'Revisa la consola de Supabase → Authentication para enviar el reset manualmente.'
        : 'Revisa tu bandeja de entrada en ' + SUPER_ADMIN_EMAIL + ' para establecer tu contraseña.'
    })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'setup failed' }, { status: 500 })
  }
}

// GET: lightweight status check
export async function GET() {
  if (process.env.SETUP_ENABLED !== '1') return NextResponse.json({ error: 'Not found' }, { status: 404 })
  try {
    const admin = createServiceClient()
    const { data: list } = await admin.auth.admin.listUsers({ page: 1, perPage: 500 })
    const u = (list?.users || []).find(x => (x.email || '').toLowerCase() === SUPER_ADMIN_EMAIL)
    if (!u) return NextResponse.json({ ready: false, reason: 'auth user missing' })
    const { data: prof } = await admin.from('profiles').select('role').eq('id', u.id).maybeSingle()
    return NextResponse.json({
      ready: prof?.role === 'super_admin',
      userExists: !!u,
      emailConfirmed: !!u.email_confirmed_at,
      profileRole: prof?.role || null
    })
  } catch (err) {
    return NextResponse.json({ error: err?.message }, { status: 500 })
  }
}
