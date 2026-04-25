// src/app/api/check/session/route.js
// Firma un token de sesión IP+device para el kiosk.
import { NextResponse } from 'next/server'
import crypto from 'crypto'
import { verifyTenant } from '@/lib/tenant-token'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

const TTL_MS = 4 * 60 * 60 * 1000 // 4h

function secret() {
  const s = process.env.KIOSK_SESSION_SECRET
  if (!s) throw new Error('KIOSK_SESSION_SECRET no configurado')
  return s
}

export async function POST(req) {
  try {
    const { tenantToken, branchId, deviceId } = await req.json()

    const effectiveTenant = tenantToken ? verifyTenant(tenantToken) : null
    if (!effectiveTenant) {
      return NextResponse.json({ error: 'tenantToken inválido o ausente' }, { status: 401 })
    }

    const ip = getClientIp(req)
    const ts = Date.now()
    const payload = { ip, tenantId: effectiveTenant, branchId: branchId || null, deviceId: deviceId || null, ts }
    const sig = crypto.createHmac('sha256', secret()).update(JSON.stringify(payload)).digest('hex')
    const token = Buffer.from(JSON.stringify({ ...payload, sig })).toString('base64url')
    return NextResponse.json({ token, ip, expiresIn: TTL_MS / 1000 })
  } catch (err) {
    console.error('session/route error:', err?.message)
    return NextResponse.json({ error: 'Session creation failed' }, { status: 500 })
  }
}

export function verifySessionToken(token) {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { sig, ...payload } = data
    const expected = crypto.createHmac('sha256', secret()).update(JSON.stringify(payload)).digest('hex')
    if (sig !== expected) return { valid: false, reason: 'tampered' }
    if (Date.now() - payload.ts > TTL_MS) return { valid: false, reason: 'expired' }
    return { valid: true, ...payload }
  } catch {
    return { valid: false, reason: 'invalid' }
  }
}
