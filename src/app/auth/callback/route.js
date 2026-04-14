// src/app/auth/callback/route.js
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET(request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const token_hash = searchParams.get('token_hash')
  const type = searchParams.get('type')

  // PKCE flow (code exchange)
  if (code) {
    const supabase = createServiceClient()
    const { error } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      return NextResponse.redirect(`${origin}/auth/reset`)
    }
  }

  // Token hash flow (magic link / recovery)
  if (token_hash && type) {
    return NextResponse.redirect(
      `${origin}/auth/reset?token_hash=${token_hash}&type=${type}`
    )
  }

  // Fallback: go to login
  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
