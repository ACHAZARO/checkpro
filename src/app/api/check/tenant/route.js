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
      .select('id,slug,config,name')
      .eq('slug', slug)
      .eq('active', true)
      .single()
    if (error || !tenant) return NextResponse.json({ error: 'Empresa no encontrada' }, { status: 404 })

    // FIX: incluir sucursales reales (tabla) para que el kiosko resuelva ?branch=<id>
    // aunque tenants.config.branches legacy este vacio / desfasado.
    const { data: branches } = await supabase
      .from('branches')
      .select('id,name,active,config')
      .eq('tenant_id', tenant.id)
      .eq('active', true)
      .order('created_at')

    return NextResponse.json({
      id: tenant.id,
      slug: tenant.slug,
      name: tenant.name,
      config: tenant.config,
      branches: branches || [],
    })
  } catch (err) {
    console.error(err)
    return NextResponse.json({ error: 'Error interno' }, { status: 500 })
  }
}
