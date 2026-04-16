// src/app/api/archive/diag/route.js
// TEMP diagnostic — borrar una vez resuelto el auth.
import { NextResponse } from 'next/server'
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export const dynamic = 'force-dynamic'

export async function GET() {
  const cookieStore = await cookies()
  const all = cookieStore.getAll()
  const cookieInfo = all.map((c) => ({
    name: c.name,
    len: (c.value || '').length,
    head: (c.value || '').slice(0, 30),
  }))

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: () => {},
      },
    },
  )

  let sessionResult = null
  let sessionErr = null
  try {
    const { data, error } = await supabase.auth.getSession()
    sessionResult = {
      hasSession: !!data?.session,
      hasUser: !!data?.session?.user,
      userId: data?.session?.user?.id || null,
      expiresAt: data?.session?.expires_at || null,
      tokenHead: data?.session?.access_token?.slice(0, 20) || null,
    }
    sessionErr = error?.message || null
  } catch (e) {
    sessionErr = String(e)
  }

  let userResult = null
  let userErr = null
  try {
    const { data, error } = await supabase.auth.getUser()
    userResult = {
      hasUser: !!data?.user,
      userId: data?.user?.id || null,
    }
    userErr = error?.message || null
  } catch (e) {
    userErr = String(e)
  }

  return NextResponse.json({
    cookieCount: all.length,
    cookies: cookieInfo,
    env: {
      hasUrl: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
      hasAnon: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      urlHost: process.env.NEXT_PUBLIC_SUPABASE_URL?.replace(/^https?:\/\//, '').slice(0, 40),
    },
    session: sessionResult,
    sessionErr,
    user: userResult,
    userErr,
  })
}
