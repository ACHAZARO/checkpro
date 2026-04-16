// src/lib/rate-limit.js
// In-memory rate limiter. OK para Vercel serverless con tráfico bajo por instancia.
// Para alto tráfico, reemplazar por Upstash Redis / Vercel KV.
const buckets = new Map()
const MAX_BUCKETS = 10000

export function rateLimit(key, max = 5, windowMs = 15 * 60_000) {
  const now = Date.now()
  const b = buckets.get(key)
  if (!b || now > b.resetAt) {
    if (buckets.size > MAX_BUCKETS) {
      for (const [k, v] of buckets) if (now > v.resetAt) buckets.delete(k)
    }
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return { ok: true, remaining: max - 1, retryAfter: 0 }
  }
  b.count++
  if (b.count > max) {
    return { ok: false, remaining: 0, retryAfter: Math.ceil((b.resetAt - now) / 1000) }
  }
  return { ok: true, remaining: max - b.count, retryAfter: 0 }
}
