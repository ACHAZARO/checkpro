'use client'
// src/app/register/page.js
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'
import { slugify } from '@/lib/utils'

export default function RegisterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ companyName: '', email: '', password: '', confirmPassword: '' })
  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) { toast.error('Las contraseñas no coinciden'); return }
    if (form.password.length < 8) { toast.error('La contraseña debe tener al menos 8 caracteres'); return }
    setLoading(true)

    try {
      const supabase = createClient()

      // 1. Crear usuario en auth
      const { data: authData, error: authError } = await supabase.auth.signUp({
        email: form.email,
        password: form.password,
        options: { data: { name: form.companyName } }
      })
      if (authError) throw authError

      // 2. Crear tenant
      const slug = slugify(form.companyName) + '-' + Math.random().toString(36).slice(2,6)
      const { data: tenant, error: tenantError } = await supabase
        .from('tenants')
        .insert({ name: form.companyName, slug, owner_email: form.email })
        .select().single()
      if (tenantError) throw tenantError

      // 3. Crear perfil del owner
      const { error: profileError } = await supabase
        .from('profiles')
        .insert({ id: authData.user.id, tenant_id: tenant.id, name: form.companyName, role: 'owner' })
      if (profileError) throw profileError

      toast.success('¡Cuenta creada! Configurando tu empresa...')
      router.push('/dashboard/settings?onboarding=true')
    } catch (err) {
      toast.error(err.message || 'Error al crear la cuenta')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-2xl font-extrabold">Crear cuenta</h1>
          <p className="text-gray-500 text-sm mt-1">Empieza gratis. Sin tarjeta de crédito.</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Nombre de tu empresa / sucursal</label>
            <input className="input" placeholder="Café Central" value={form.companyName}
              onChange={e => F('companyName', e.target.value)} required />
          </div>
          <div>
            <label className="label">Correo electrónico</label>
            <input className="input" type="email" placeholder="tu@empresa.com" value={form.email}
              onChange={e => F('email', e.target.value)} required />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input className="input" type="password" placeholder="Mínimo 8 caracteres" value={form.password}
              onChange={e => F('password', e.target.value)} required />
          </div>
          <div>
            <label className="label">Confirmar contraseña</label>
            <input className="input" type="password" placeholder="Repite la contraseña" value={form.confirmPassword}
              onChange={e => F('confirmPassword', e.target.value)} required />
          </div>

          <button type="submit" className="btn-primary mt-2" disabled={loading}>
            {loading ? '⏳ Creando cuenta...' : 'Crear cuenta gratis →'}
          </button>
        </form>

        <p className="text-center text-gray-600 text-sm mt-6">
          ¿Ya tienes cuenta?{' '}
          <Link href="/login" className="text-brand-400 font-semibold hover:underline">Iniciar sesión</Link>
        </p>
      </div>
    </main>
  )
}
