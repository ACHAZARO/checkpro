// src/app/api/bootstrap/route.js
// Safety-net endpoint called after login.
// If the authenticated user has no profile (orphan from the old broken signup),
// auto-create their tenant + profile using service_role.
// Idempotent: returns { ok: true } if already bootstrapped.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

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

export async function POST() {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const userId = session.user.id
    const emailLower = (session.user.email || '').toLowerCase()
    const metaName = session.user.user_metadata?.name
      || session.user.user_metadata?.full_name
      || (emailLower.split('@')[0] || 'Mi Empresa')

    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
      return NextResponse.json({
        error: 'Falta SUPABASE_SERVICE_ROLE_KEY en las variables de entorno de Vercel.'
      }, { status: 500 })
    }

    const admin = createServiceClient()

    // Check profile
    const { data: existingProfile, error: profErr } = await admin
      .from('profiles')
      .select('id, tenant_id, name, role')
      .eq('id', userId)
      .maybeSingle()
    if (profErr) {
      return NextResponse.json({ error: 'Error leyendo perfil: ' + profErr.message }, { status: 500 })
    }

    // Already fully bootstrapped — no-op.
    if (existingProfile?.tenant_id) {
      return NextResponse.json({ ok: true, bootstrapped: false, reason: 'already_set' })
    }

    // Check if a tenant already exists for this owner_email (e.g. partial prior run).
    const { data: existingTenant } = await admin
      .from('tenants')
      .select('id, name')
      .eq('owner_email', emailLower)
      .limit(1)
      .maybeSingle()

    let tenantId = existingTenant?.id || null

    if (!tenantId) {
      // FIX: use crypto.randomBytes instead of Math.random for unpredictable slugs
      const slug = slugify(metaName) + '-' + require('crypto').randomBytes(4).toString('hex')
      const { data: tenant, error: tenantError } = await admin
        .from('tenants')
        .insert({ name: metaName, slug, owner_email: emailLower })
        .select()
        .single()
      if (tenantError) {
        return NextResponse.json({ error: 'No se pudo crear la empresa: ' + tenantError.message }, { status: 500 })
      }
      tenantId = tenant.id
    }

    // Ensure the tenant has at least one branch (migration may not have run yet for new tenants).
    const { data: anyBranch } = await admin
      .from('branches')
      .select('id')
      .eq('tenant_id', tenantId)
      .limit(1)
      .maybeSingle()
    if (!anyBranch) {
      const defaultBranchConfig = {
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
      await admin.from('branches').insert({
        tenant_id: tenantId,
        name: 'Sucursal principal',
        config: defaultBranchConfig
      })
    }

    if (!existingProfile) {
      const { error: insErr } = await admin
        .from('profiles')
        .insert({ id: userId, tenant_id: tenantId, name: metaName, role: 'owner' })
      if (insErr) {
        return NextResponse.json({ error: 'No se pudo crear el perfil: ' + insErr.message }, { status: 500 })
      }
    } else {
      // Profile existed but tenant_id was null — attach.
      const { error: upErr } = await admin
        .from('profiles')
        .update({ tenant_id: tenantId })
        .eq('id', userId)
      if (upErr) {
        return NextResponse.json({ error: 'No se pudo vincular el perfil a la empresa: ' + upErr.message }, { status: 500 })
      }
    }

    return NextResponse.json({ ok: true, bootstrapped: true, tenantId })
  } catch (err) {
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 })
  }
}
