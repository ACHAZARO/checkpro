// src/app/api/dashboard/tenant-token/route.js
// Returns a signed tenantToken for embedding in QR codes.
// Requires an authenticated dashboard session.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { signTenant } from '@/lib/tenant-token'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const supabase = createServerSupabaseClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) {
      return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
    }

    const admin = createServiceClient()
    const { data: prof, error: profErr } = await admin
      .from('profiles')
      .select('tenant_id')
      .eq('id', session.user.id)
      .maybeSingle()

    if (profErr || !prof?.tenant_id) {
      return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 403 })
    }

    const token = signTenant(prof.tenant_id)
    return NextResponse.json({ token })
  } catch (err) {
    console.error('tenant-token/route error:', err?.message)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
