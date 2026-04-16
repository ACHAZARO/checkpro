// src/middleware.js
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function middleware(req) {
  const res = NextResponse.next()
  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          get: (name) => req.cookies.get(name)?.value,
          set: (name, value, options) => { res.cookies.set({ name, value, ...options }) },
          remove: (name, options) => { res.cookies.set({ name, value: '', ...options }) },
        },
      }
    )
    const { data: { session } } = await supabase.auth.getSession()
    if (!session && req.nextUrl.pathname.startsWith('/dashboard')) {
      const url = req.nextUrl.clone(); url.pathname = '/login'
      return NextResponse.redirect(url)
    }
  } catch (e) { /* fail open */ }
  return res
}

export const config = {
  matcher: ['/dashboard/:path*'],
}
