// src/app/api/help/report/route.js
// Recibe un mensaje del centro de ayuda (pregunta / sugerencia / bug) y lo
// guarda en la tabla help_messages para que el pipeline semanal lo procese.
import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { rateLimit } from '@/lib/rate-limit'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const ALLOWED_KINDS = new Set(['pregunta', 'sugerencia', 'bug'])

export async function POST(req) {
  // 1) Autenticacion: tiene que estar logueado en el dashboard
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) {
    return NextResponse.json({ error: 'No autenticado' }, { status: 401 })
  }

  const admin = createServiceClient()
  const { data: profile, error: profErr } = await admin
    .from('profiles')
    .select('id, tenant_id, role, name, email')
    .eq('id', session.user.id)
    .maybeSingle()

  if (profErr || !profile) {
    return NextResponse.json({ error: 'Perfil no encontrado' }, { status: 403 })
  }
  if (!profile.tenant_id) {
    return NextResponse.json({ error: 'Usuario sin empresa asignada' }, { status: 403 })
  }

  // 2) Rate limit: max 10 mensajes por hora por usuario (suficiente para uso legitimo,
  //    suficiente techo para frenar spam accidental)
  const rl = rateLimit(`help:${profile.id}`, 10, 60 * 60_000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Demasiados mensajes. Intenta de nuevo en ${rl.retryAfter}s.` },
      { status: 429 }
    )
  }

  // 3) Validar payload
  const body = await req.json().catch(() => ({}))
  const kind = String(body.kind || '').trim()
  const title = String(body.title || '').trim()
  const description = String(body.description || '').trim()
  const page_context = String(body.page_context || '').slice(0, 300)
  const user_agent = String(body.user_agent || '').slice(0, 500)

  if (!ALLOWED_KINDS.has(kind)) {
    return NextResponse.json({ error: 'Tipo de mensaje invalido' }, { status: 400 })
  }
  if (title.length < 3 || title.length > 200) {
    return NextResponse.json({ error: 'El titulo debe tener entre 3 y 200 caracteres' }, { status: 400 })
  }
  if (description.length < 10 || description.length > 5000) {
    return NextResponse.json(
      { error: 'La descripcion debe tener entre 10 y 5000 caracteres' },
      { status: 400 }
    )
  }

  // 4) Insert via service role (bypasea RLS; el endpoint ya autenticó al usuario)
  const { data, error } = await admin
    .from('help_messages')
    .insert({
      tenant_id: profile.tenant_id,
      reporter_profile_id: profile.id,
      reporter_name: profile.name || null,
      reporter_email: profile.email || session.user.email || null,
      kind,
      title,
      description,
      page_context: page_context || null,
      user_agent: user_agent || null,
      status: 'open',
    })
    .select('id, kind, status, created_at')
    .single()

  if (error) {
    console.error('[help/report] insert error:', error)
    return NextResponse.json({ error: 'No se pudo guardar el mensaje' }, { status: 500 })
  }

  return NextResponse.json({ ok: true, message: data })
}
