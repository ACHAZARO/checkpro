// src/app/api/archive/download/route.js
// Genera signed URL para descargar un archivo del bucket 'archives'.
// Solo admin del tenant puede descargar paths de su propio tenant.
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

async function getAdminTenantId() {
  const cookieStore = await cookies()
  // @supabase/ssr ^0.3.0 usa API vieja get/set/remove (no getAll/setAll).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get: (name) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    },
  )
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return null
  const svc = createServiceClient()
  const { data: profile } = await svc
    .from('profiles')
    .select('id, tenant_id, role, status')
    .eq('id', session.user.id)
    .eq('status', 'active')
    .maybeSingle()
  if (!profile) return null
  // FIX: archive_files no tiene branch_id; evitar descarga tenant-wide por gerentes.
  if (!['owner', 'super_admin'].includes(profile.role)) return { error: 'Solo propietario puede descargar archivo historico', status: 403 }
  return { tenantId: profile.tenant_id }
}

export async function GET(req) {
  try {
    const auth = await getAdminTenantId()
    if (!auth) return NextResponse.json({ error: 'No autorizado' }, { status: 401 })
    if (auth.error) return NextResponse.json({ error: auth.error }, { status: auth.status })

    const { searchParams } = new URL(req.url)
    const path = searchParams.get('path')
    if (!path) return NextResponse.json({ error: 'path requerido' }, { status: 400 })

    // Validacion: el path debe empezar con tenantId/ del admin autenticado
    if (!path.startsWith(`${auth.tenantId}/`)) {
      return NextResponse.json({ error: 'Path de otro tenant' }, { status: 403 })
    }

    const supabase = createServiceClient()

    // Verificar que esta registrado en archive_files
    const { data: record } = await supabase
      .from('archive_files')
      .select('id, content_type')
      .eq('path', path)
      .eq('tenant_id', auth.tenantId)
      .maybeSingle()
    if (!record) return NextResponse.json({ error: 'Archivo no encontrado' }, { status: 404 })

    const { data, error } = await supabase.storage
      .from('archives')
      .createSignedUrl(path, 3600) // 1 hora TTL

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ url: data.signedUrl, expiresIn: 3600 })
  } catch (err) {
    console.error('archive/download error:', err)
    return NextResponse.json({ error: err?.message || 'Error interno' }, { status: 500 })
  }
}
