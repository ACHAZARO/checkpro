// src/app/api/account/delete/route.js
// Borra la cuenta del usuario actual Y todos los datos de su empresa.
// Solo el propietario (owner/super_admin) puede invocarlo. Al borrarse:
//   - Se elimina la fila de `tenants` → cascade a employees, shifts, week_cuts,
//     audit_log, profiles, branches, vacation_periods, etc. (todas las tablas
//     tenant-scoped tienen FK CASCADE).
//   - Se borra el auth.users de cada profile del tenant (gerentes incluidos),
//     liberando los emails en Supabase Auth.
//
// Flujo:
//   GET    → preview: devuelve nombre de empresa + contadores de lo que se
//            borraría (sin borrar nada).
//   DELETE → ejecuta el borrado. Body: { password }. Re-autentica contra
//            Supabase Auth con signInWithPassword para confirmar que quien
//            dispara esto es realmente el dueño de la sesión (defensa extra
//            contra session hijack o cookies robadas).

import { NextResponse } from 'next/server'
import { createServerSupabaseClient, createServiceClient } from '@/lib/supabase-server'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function getOwnerContext() {
  const supabase = createServerSupabaseClient()
  const { data: { session } } = await supabase.auth.getSession()
  if (!session?.user) return { error: 'No autenticado', status: 401 }
  const admin = createServiceClient()
  const { data: prof, error: profErr } = await admin
    .from('profiles')
    .select('id, tenant_id, role')
    .eq('id', session.user.id)
    .maybeSingle()
  if (profErr || !prof) return { error: 'Perfil no encontrado', status: 403 }
  if (prof.role !== 'owner' && prof.role !== 'super_admin') {
    return { error: 'Solo el propietario puede eliminar la cuenta', status: 403 }
  }
  if (!prof.tenant_id) return { error: 'Sin empresa asociada', status: 400 }
  return { admin, profile: prof, user: session.user }
}

// Cuenta filas de una tabla tenant-scoped; si la tabla no existe o la query falla,
// devuelve 0 para que el preview no se caiga por una migración faltante.
async function safeCount(admin, table, tenantId) {
  try {
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
    if (error) return 0
    return count || 0
  } catch {
    return 0
  }
}

export async function GET() {
  const ctx = await getOwnerContext()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, profile } = ctx
  const tid = profile.tenant_id

  const [tenantRes, employees, shifts, cuts, branches, audits, profiles, vacations] = await Promise.all([
    admin.from('tenants').select('name, owner_email').eq('id', tid).maybeSingle(),
    safeCount(admin, 'employees', tid),
    safeCount(admin, 'shifts', tid),
    safeCount(admin, 'week_cuts', tid),
    safeCount(admin, 'branches', tid),
    safeCount(admin, 'audit_log', tid),
    safeCount(admin, 'profiles', tid),
    safeCount(admin, 'vacation_periods', tid),
  ])

  return NextResponse.json({
    tenant_name: tenantRes.data?.name || '',
    owner_email: tenantRes.data?.owner_email || '',
    counts: {
      employees,
      shifts,
      cuts,
      branches,
      audits,
      profiles,
      vacations,
    },
  })
}

export async function DELETE(req) {
  const ctx = await getOwnerContext()
  if (ctx.error) return NextResponse.json({ error: ctx.error }, { status: ctx.status })
  const { admin, profile, user } = ctx
  const body = await req.json().catch(() => ({}))
  const password = String(body.password || '')
  if (!password) return NextResponse.json({ error: 'Falta la contraseña' }, { status: 400 })

  // Re-autenticar con contraseña usando un cliente EFÍMERO (persistSession:false)
  // para no tocar las cookies del usuario — si la contraseña es correcta,
  // procedemos; si no, rechazamos.
  const verifyClient = createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    { auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false } }
  )
  const { error: authErr } = await verifyClient.auth.signInWithPassword({
    email: user.email,
    password,
  })
  if (authErr) {
    return NextResponse.json({ error: 'Contraseña incorrecta' }, { status: 401 })
  }

  const tid = profile.tenant_id

  // 1. Cachear los auth.user IDs de TODOS los profiles del tenant (owner +
  //    gerentes) antes de que el cascade del tenant los borre.
  const { data: tenantProfiles } = await admin
    .from('profiles')
    .select('id')
    .eq('tenant_id', tid)
  const userIds = (tenantProfiles || []).map(p => p.id)

  // 2. Borrar el tenant → cascade a employees, shifts, week_cuts, audit_log,
  //    branches, profiles, vacation_periods (todas FK ON DELETE CASCADE).
  const { error: delTenErr } = await admin.from('tenants').delete().eq('id', tid)
  if (delTenErr) {
    console.error('[account/delete] failed to delete tenant', tid, delTenErr)
    return NextResponse.json(
      { error: `Error eliminando empresa: ${delTenErr.message}` },
      { status: 500 }
    )
  }

  // 3. Barrer los auth.users del tenant — libera los emails en Supabase Auth.
  //    Best-effort: si uno falla, lo logueamos y seguimos. Los profiles ya no
  //    existen, así que el impacto de un huérfano es que ese email queda
  //    tomado (el owner puede contactar soporte).
  const failedUsers = []
  for (const uid of userIds) {
    try {
      const { error: delUserErr } = await admin.auth.admin.deleteUser(uid)
      if (delUserErr) {
        console.error('[account/delete] failed to delete auth user', uid, delUserErr)
        failedUsers.push(uid)
      }
    } catch (e) {
      console.error('[account/delete] unexpected error deleting auth user', uid, e)
      failedUsers.push(uid)
    }
  }

  return NextResponse.json({
    ok: true,
    deleted: {
      tenant_id: tid,
      auth_users_deleted: userIds.length - failedUsers.length,
      auth_users_failed: failedUsers.length,
    },
  })
}
