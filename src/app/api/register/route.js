// src/app/api/register/route.js
// Server-side registration endpoint — bypasses RLS via service_role.
// Handles new signups AND recovery of orphan auth users (those created
// by the old broken flow where RLS blocked tenants INSERT).
import { NextResponse } from 'next/server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { findAuthUserByEmail } from '@/lib/supabase-server'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'empresa'
}

function isStrongPassword(password) {
  return /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,}$/.test(String(password || ''))
}

export async function POST(req) {
  try {
    const ip = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || req.headers.get('x-real-ip') || 'unknown'
    const rl = rateLimit(`register:${ip}`, 5, 60 * 60_000)
    if (!rl.ok) {
      // FIX: rate limit contra abuso/brute force de registro.
      return NextResponse.json({ error: 'Demasiados intentos. Intenta mas tarde.', retryAfter: rl.retryAfter }, { status: 429 })
    }
    const { companyName, email, password } = await req.json()

    if (!companyName || !email || !password) {
      return NextResponse.json({ error: 'Faltan datos (empresa, email, contraseña).' }, { status: 400 })
    }
    // FIX: complejidad minima consistente server-side.
    if (!isStrongPassword(password)) {
      return NextResponse.json({ error: 'La contraseña debe tener al menos 8 caracteres.' }, { status: 400 })
    }

    const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL
    const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
    const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY

    if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
      return NextResponse.json({
        error: 'Configuración incompleta del servidor. Falta SUPABASE_SERVICE_ROLE_KEY o NEXT_PUBLIC_SUPABASE_ANON_KEY en Vercel.'
      }, { status: 500 })
    }

    // Admin client — bypasses RLS, can manage auth.users directly
    const admin = createSupabaseClient(SUPABASE_URL, SERVICE_KEY, {
      auth: { autoRefreshToken: false, persistSession: false }
    })

    const emailLower = String(email).trim().toLowerCase()
    const name = String(companyName).trim()

    // 1) Try to create the auth user. If it already exists, we fall through to recovery.
    let userId = null
    let isNew = false

    const createRes = await admin.auth.admin.createUser({
      email: emailLower,
      password,
      email_confirm: true,              // bypass email-confirm wall
      user_metadata: { name }
    })

    if (createRes.error) {
      const msg = String(createRes.error.message || '').toLowerCase()
      const alreadyExists = msg.includes('already') || msg.includes('registered') || msg.includes('exists') || createRes.error.status === 422
      if (!alreadyExists) {
        return NextResponse.json({ error: createRes.error.message || 'No se pudo crear el usuario' }, { status: 500 })
      }

      // User exists — look them up and verify the password before doing anything else.
      // (Password verification is the ONLY signal that this caller actually owns the account.)
      let existing
      try { existing = await findAuthUserByEmail(admin, emailLower) } catch (e) {
        return NextResponse.json({ error: e.message }, { status: 500 })
      }
      if (!existing) {
        return NextResponse.json({ error: 'No se encontró el usuario. Intenta de nuevo.' }, { status: 409 })
      }
      userId = existing.id

      // Make sure email is marked confirmed so signInWithPassword can work.
      if (!existing.email_confirmed_at) {
        await admin.auth.admin.updateUserById(userId, { email_confirm: true })
      }

      // Verify password matches using the public anon client.
      const anon = createSupabaseClient(SUPABASE_URL, ANON_KEY, {
        auth: { autoRefreshToken: false, persistSession: false }
      })
      const verify = await anon.auth.signInWithPassword({ email: emailLower, password })
      if (verify.error) {
        return NextResponse.json({
          error: 'Ese correo ya está registrado pero la contraseña no coincide. Inicia sesión con tu contraseña original o restablécela desde la pantalla de login.'
        }, { status: 401 })
      }
      // Sign out this server-side verification session so no cookie persists.
      try { await anon.auth.signOut() } catch {}
    } else {
      userId = createRes.data?.user?.id
      isNew = true
      if (!userId) {
        return NextResponse.json({ error: 'Usuario creado pero sin ID. Intenta de nuevo.' }, { status: 500 })
      }
    }

    // 2) Check if a profile already exists for this user.
    const { data: existingProfile } = await admin
      .from('profiles')
      .select('id, tenant_id')
      .eq('id', userId)
      .maybeSingle()

    let tenantId = existingProfile?.tenant_id || null

    // 3) Create tenant if the user doesn't have one.
    if (!tenantId) {
      const slug = slugify(name) + '-' + Math.random().toString(36).slice(2, 6)
      const { data: tenant, error: tenantError } = await admin
        .from('tenants')
        .insert({ name, slug, owner_email: emailLower })
        .select()
        .single()
      if (tenantError) {
        return NextResponse.json({ error: 'No se pudo crear la empresa: ' + tenantError.message }, { status: 500 })
      }
      tenantId = tenant.id
    }

    // 3b) Seed a default branch if the tenant has none yet.
    const { data: anyBranch } = await admin
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
    if (!anyBranch) {
      await admin.from('branches').insert({
        tenant_id: tenantId,
        name: 'Sucursal principal',
        config: {
          toleranceMinutes: 10,
          alertHours: 8,
          weekClosingDay: 'dom',
          location: { lat: 19.4326, lng: -99.1332, radius: 300, name: 'Sucursal' },
          businessHours: {},
          holidays: [],
          restDays: [],
          printHeader: '',
          printLegalText: '',
          printFooter: ''
        }
      })
    }

    // 4) Create profile if missing.
    if (!existingProfile) {
      const { error: profileError } = await admin
        .from('profiles')
        .insert({ id: userId, tenant_id: tenantId, name, role: 'owner' })
      if (profileError) {
        return NextResponse.json({ error: 'No se pudo crear el perfil: ' + profileError.message }, { status: 500 })
      }
    } else if (!existingProfile.tenant_id) {
      // Profile existed but without tenant — attach it.
      const { error: upErr } = await admin
        .from('profiles')
        .update({ tenant_id: tenantId })
        .eq('id', userId)
      if (upErr) {
        return NextResponse.json({ error: 'No se pudo vincular el perfil a la empresa: ' + upErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({
      ok: true,
      isNew,
      recovered: !isNew,
      userId,
      tenantId
    })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Error interno del servidor' }, { status: 500 })
  }
}
