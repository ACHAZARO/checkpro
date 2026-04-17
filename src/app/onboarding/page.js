'use client'
// src/app/onboarding/page.js
// Flujo para usuarios autenticados que NO tienen tenant (o no pueden verlo por RLS).
// Casos cubiertos:
//  (a) profile.tenant_id es null
//  (b) profile.tenant_id apunta a tenant que no existe (borrado manualmente)
//  (c) profile.tenant_id apunta a tenant que RLS esconde (discrepancia owner_email/auth email)
// En todos los casos: permitir crear empresa nueva y dejar al usuario operativo.
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'
import { slugify } from '@/lib/utils'

export default function OnboardingPage() {
  const router = useRouter()
  const [checking, setChecking] = useState(true)
  const [session, setSession] = useState(null)
  const [existingProfile, setExistingProfile] = useState(null)
  const [companyName, setCompanyName] = useState('')
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    (async () => {
      const supabase = createClient()
      const { data: { session: s } } = await supabase.auth.getSession()
      if (!s) { router.push('/login'); return }
      setSession(s)

      // Ver si ya tiene profile y si ya tiene tenant vinculado y accesible
      const { data: prof } = await supabase.from('profiles').select('*').eq('id', s.user.id).single()
      setExistingProfile(prof || null)

      if (prof?.tenant_id) {
        // Intentar leer el tenant — si funciona, el usuario ya esta configurado, mandarlo al dashboard
        const { data: ten } = await supabase.from('tenants').select('id').eq('id', prof.tenant_id).single()
        if (ten?.id) { router.push('/dashboard'); return }
      }
      setChecking(false)
    })()
  }, [router])

  async function createCompany(e) {
    e.preventDefault()
    if (!companyName.trim()) { toast.error('Nombre requerido'); return }
    if (!session) { toast.error('Tu sesion expiro. Vuelve a iniciar sesion.'); router.push('/login'); return }
    setSubmitting(true)

    try {
      const supabase = createClient()
      const slug = slugify(companyName) + '-' + Math.random().toString(36).slice(2,6)

      // 1. Crear tenant con owner_email = email del auth actual (crucial para RLS tenant_select)
      const { data: tenant, error: tErr } = await supabase
        .from('tenants')
        .insert({ name: companyName.trim(), slug, owner_email: session.user.email })
        .select()
        .single()
      if (tErr) {
        console.error('[onboarding] tenant insert error:', tErr)
        toast.error(`No se pudo crear la empresa: ${tErr.message}`)
        return
      }

      // 2. Upsert del profile: si no existe crearlo; si existe actualizar tenant_id
      if (existingProfile) {
        const { error: pErr } = await supabase
          .from('profiles')
          .update({ tenant_id: tenant.id, role: 'owner', name: existingProfile.name || companyName.trim() })
          .eq('id', session.user.id)
        if (pErr) {
          console.error('[onboarding] profile update error:', pErr)
          toast.error(`Empresa creada, pero no se pudo vincular tu perfil: ${pErr.message}`)
          return
        }
      } else {
        const { error: pErr } = await supabase
          .from('profiles')
          .insert({ id: session.user.id, tenant_id: tenant.id, name: companyName.trim(), role: 'owner' })
        if (pErr) {
          console.error('[onboarding] profile insert error:', pErr)
          toast.error(`Empresa creada, pero no se pudo crear tu perfil: ${pErr.message}`)
          return
        }
      }

      // 3. Crear sucursal inicial — si no hay branches, Empleados/Asistencia/Nomina aparecen vacios
      //    sin guia. my_tenant_id() y is_tenant_admin() ya funcionan porque profile ya se guardo.
      const { error: bErr } = await supabase
        .from('branches')
        .insert({
          tenant_id: tenant.id,
          name: companyName.trim(),
          slug: slug + '-main',
          active: true,
          config: {}
        })
      if (bErr) {
        // No bloquear el flujo — el usuario puede crear la sucursal manualmente desde Config
        console.error('[onboarding] branch insert error (non-fatal):', bErr)
        toast('Empresa creada. Crea tu primera sucursal en Config → Sucursales.', { icon: '⚠️' })
      }

      toast.success('Empresa creada — configurando...')
      // Hard reload para que el layout recargue el tenant correctamente
      window.location.href = '/dashboard'
    } catch (err) {
      console.error('[onboarding] unexpected:', err)
      toast.error(err?.message || 'Error inesperado al crear empresa')
    } finally {
      setSubmitting(false)
    }
  }

  if (checking) return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center">
      <div className="text-brand-400 font-mono text-sm animate-pulse">⬡ Verificando tu cuenta...</div>
    </main>
  )

  return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-2xl font-extrabold">Crear tu empresa</h1>
          <p className="text-gray-500 text-sm mt-1">
            {existingProfile?.tenant_id
              ? 'La empresa anterior no esta disponible. Crea una nueva para continuar.'
              : 'Vamos a configurar tu empresa para que puedas empezar a usar CheckPro.'}
          </p>
        </div>

        <form onSubmit={createCompany} className="space-y-4">
          <div>
            <label className="label">Nombre de tu empresa / sucursal</label>
            <input
              className="input"
              placeholder="Mi Empresa"
              value={companyName}
              onChange={e => setCompanyName(e.target.value)}
              autoFocus
              required
            />
            <p className="text-[10px] text-gray-600 font-mono mt-1">
              Podras agregar mas sucursales, empleados y configurarla despues.
            </p>
          </div>

          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting ? 'Creando...' : 'Crear empresa →'}
          </button>
        </form>

        <p className="text-center text-gray-600 text-xs font-mono mt-6">
          Sesion: {session?.user?.email || '—'}
        </p>
      </div>
    </main>
  )
}
