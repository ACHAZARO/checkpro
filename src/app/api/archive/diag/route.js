// Endpoint de diagnostico eliminado. Responde 404.
import { NextResponse } from 'next/server'
export const dynamic = 'force-dynamic'
export async function GET() {
  return NextResponse.json({ error: 'Not found' }, { status: 404 })
}
