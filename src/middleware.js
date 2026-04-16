// src/middleware.js
// Runs on every /dashboard/* and /superadmin/* request.
// Uses @supabase/ssr's cookies API ({get,set,remove} — required by 0.3.x).
//
// Two bugs the previous version had:
//  1. getSession() can return stale data from the cookie without checking
//     with Supabase's auth server — so right after login the middleware
//     could say "no session" and bounce the user to /login. Fix: call
//     supabase.auth.getUser() which forces revalidation.
//  2. When Supabase refreshes an access token, the new cookie must be
//     forwarded onto the response (res.cookies.set). Otherwise every
//     request keeps using the stale cookie, which will eventually fail and
//     bounce the user to /login.
import { createServerClient } from '@supabase/ssr'
import { NextResponse } from 'next/server'

export async function middleware(req) {
  let res = NextResponse.next({ request: { headers: req.headers } })

  try {
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      {
        cookies: {
          get: (name) => req.cookies.get(name)?.value,
          set: (name, value, options) => {
            req.cookies.set({ name, value, ...options })
            res = NextResponse.next({ request: { headers: req.headers } })
            res.cookies.set({ name, value, ...options })
          },
          remove: (name, options) => {
            req.cookies.set({ name, value: '', ...options })
            res = NextResponse.next({ request: { headers: req.headers } })
            res.cookies.set({ name, value: '', ...options })
          },
        },
      }
    )

    const { data: { user } } = await supabase.auth.getUser()

    const path = req.nextUrl.pathname
    const protectedPath = path.startsWith('/dashboard') || path.startsWith('/superadmin')

    if (!user && protectedPath) {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', path)
      return NextResponse.redirect(url)
    }
  } catch (e) {
    // fail open — don't lock the user out if Supabase is temporarily unreachable
  }
  return res
}

export const config = {
  matcher: ['/dashboard/:path*', '/superadmin/:path*'],
}
