// src/lib/tenant-token.js
import { createHmac, timingSafeEqual } from 'crypto'

function secret() {
  const s = process.env.TENANT_QR_SECRET || process.env.KIOSK_SESSION_SECRET
  if (!s) throw new Error('TENANT_QR_SECRET/KIOSK_SESSION_SECRET no configurado')
  return s
}

export function signTenant(tenantId) {
  const sig = createHmac('sha256', secret()).update(tenantId).digest('base64url')
  return `${tenantId}.${sig}`
}

export function verifyTenant(token) {
  if (!token || typeof token !== 'string') return null
  const [id, sig] = token.split('.')
  if (!id || !sig) return null
  try {
    const exp = createHmac('sha256', secret()).update(id).digest('base64url')
    const a = Buffer.from(sig), b = Buffer.from(exp)
    if (a.length !== b.length) return null
    if (timingSafeEqual(a, b)) return id
  } catch { /* fallthrough */ }
  return null
}
