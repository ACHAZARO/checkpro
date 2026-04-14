// src/app/api/check/ip/route.js
// Returns the caller's public IP — used by:
//   1. Branch setup: admin detects branch IP to register it
//   2. Check page: periodic monitoring to detect if employee left branch WiFi
import { NextResponse } from 'next/server'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

export async function GET(req) {
  return NextResponse.json({ ip: getClientIp(req) })
}
