// src/app/api/check/tenant/route.js
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'

export async function GET(req) {
  try {
    const { searchParams } = new URL(req.url)
    const slug = searchParams.get('slug')
    if (!slug) return NextResponse.json({ error: 'Slug requerido' }, { status: 400 })
    const supabase = createServiceClient()
    const { data: tenant, error } = await supabase
      .from('tenants')
      .select('id,slug,config')
      .eq('slug', slug)
      .eq('active', true)
      .single()
    if (error || !tenant) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })
    return NextResponse.json({ id: tenant.id, slug: tenant.slug, config: tenant.config })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
