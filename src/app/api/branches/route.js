// src/app/api/branches/route.js
// List / create branches. Owner-only for create.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getAuthedProfile() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('id, tenant_id, role, branch_id')
    .eq('id', session.user.id)
    .maybeSingle()
  if (profErr || !prof) return { error: 'Perfil no encontrado', status: 403 }
  return { profile: prof, admin }
}

export async function GET() {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx

  let q = admin.from('branches').select('*').eq('tenant_id', profile.tenant_id).order('created_at', { ascending: true })
  // Manager only sees their branch
  if (profile.role !== 'owner' && profile.role !== 'super_admin') {
    q = q.eq('id', profile.branch_id)
  }
  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ branches: data || [] })
}

export async function POST(req) {
  const ctx = await getAuthedProfile()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { profile, admin } = ctx
  if (profile.role !== 'owner' && profile.role !== 'super_admin') {
    return NextResponse.json({ error: 'Solo el propietario puede crear sucursales' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = String(body.name || '').trim()
  if (!name) return NextResponse.json({ error: 'Falta el nombre de la sucursal' }, { status: 400 })

  const defaultConfig = {
    toleranceMinutes: 10,
    absenceMinutes: 60,
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

  const { data, error } = await admin
    .from('branches')
    .insert({ tenant_id: profile.tenant_id, name, config: { ...defaultConfig, ...(body.config || {}) } })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ branch: data })
}
