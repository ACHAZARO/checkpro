// src/app/api/check/session/route.js
// Creates a short-lived IP-bound session token when employee scans the QR
import { NextResponse } from 'next/server'
import crypto from 'crypto'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

export async function POST(req) {
  try {
    const { tenantId, branchId } = await req.json()
    const ip = getClientIp(req)
    const ts = Date.now()
    const payload = { ip, tenantId, branchId, ts }
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'checkpro-fallback-secret'
    const sig = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    const token = Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
    return NextResponse.json({ token, ip, expiresIn: 600 }) // 10 min TTL
  } catch (err) {
    return NextResponse.json({ error: 'Session creation failed' }, { status: 500 })
  }
}

// Utility exported for use in punch/abandon routes
export function verifySessionToken(token, secret) {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { sig, ...payload } = data
    const expected = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    if (sig !== expected) return { valid: false, reason: 'tampered' }
    if (Date.now() - payload.ts > 10 * 60 * 1000) return { valid: false, reason: 'expired' }
    return { valid: true, ...payload }
  } catch {
    return { valid: false, reason: 'invalid' }
  }
}
