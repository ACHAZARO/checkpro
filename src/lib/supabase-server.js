// src/lib/supabase-server.js - server-only (API routes + Server Components)
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'

export function createServerSupabaseClient() {
  const cookieStore = cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        get(name) { return cookieStore.get(name)?.value },
        set(name, value, options) { try { cookieStore.set({ name, value, ...options }) } catch {} },
        remove(name, options) { try { cookieStore.set({ name, value: '', ...options }) } catch {} },
      },
    }
  )
}

export function createServiceClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}

export async function findAuthUserByEmail(admin, email) {
  const target = email.toLowerCase()
  let page = 1
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 100 })
    if (error) throw error
    const found = data.users.find(u => (u.email || '').toLowerCase() === target)
    if (found) return found
    if (data.users.length < 100) return null
    page++
  }
}
