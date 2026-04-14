// src/app/api/check/session/route.js
// Creates an IP-bound + device-bound session token when employee scans the QR.
// Token lasts 12 hours (full shift duration).
import { NextResponse } from 'next/server'
import crypto from 'crypto'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

const TTL_MS = 12 * 60 * 60 * 1000 // 12 hours

export async function POST(req) {
  try {
    const { tenantId, branchId, deviceId } = await req.json()
    const ip = getClientIp(req)
    const ts = Date.now()
    const payload = { ip, tenantId, branchId, deviceId: deviceId || null, ts }
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'checkpro-fallback-secret'
    const sig = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    const token = Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
    return NextResponse.json({ token, ip, expiresIn: TTL_MS / 1000 })
  } catch (err) {
    return NextResponse.json({ error: 'Session creation failed' }, { status: 500 })
  }
}

// Utility: verify and decode a session token
// Returns { valid, ip, tenantId, branchId, deviceId, ts } or { valid:false, reason }
export function verifySessionToken(token, secret) {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { sig, ...payload } = data
    const expected = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    if (sig !== expected) return { valid: false, reason: 'tampered' }
    if (Date.now() - payload.ts > TTL_MS) return { valid: false, reason: 'expired' }
    return { valid: true, ...payload }
  } catch {
    return { valid: false, reason: 'invalid' }
  }
}
