'use client'
// src/app/login/page.js
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ email: '', password: '' })
  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.signInWithPassword({ email: form.email, password: form.password })
      if (error) throw error

      // Safety net: if this account was orphaned by the old broken signup
      // (auth user exists but no tenant/profile), bootstrap it now.
      try {
        const r = await fetch('/api/bootstrap', { method: 'POST' })
        if (!r.ok) {
          const d = await r.json().catch(() => ({}))
          console.warn('[bootstrap] non-ok:', r.status, d)
        }
      } catch (bErr) {
        console.warn('[bootstrap] failed:', bErr)
      }

      toast.success('¡Bienvenido!')
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      toast.error(err.message || 'Credenciales incorrectas')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (!form.email) { toast.error('Ingresa tu correo primero'); return }
    const supabase = createClient()
    const { error } = await supabase.auth.resetPasswordForEmail(form.email, {
      redirectTo: `${window.location.origin}/auth/reset`
    })
    if (error) toast.error(error.message)
    else toast.success('Revisa tu correo para restablecer tu contraseña')
  }

  return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-2xl font-extrabold">Iniciar sesión</h1>
          <p className="text-gray-500 text-sm mt-1">Panel administrativo</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Correo electrónico</label>
            <input className="input" type="email" placeholder="tu@empresa.com"
              value={form.email} onChange={e => F('email', e.target.value)} required />
          </div>
          <div>
            <label className="label">Contraseña</label>
            <input className="input" type="password" placeholder="Tu contraseña"
              value={form.password} onChange={e => F('password', e.target.value)} required />
          </div>
          <button type="button" onClick={handleReset}
            className="text-xs text-gray-500 hover:text-brand-400 transition-colors text-right w-full">
            ¿Olvidaste tu contraseña?
          </button>
          <button type="submit" className="btn-primary" disabled={loading}>
            {loading ? '⏳ Entrando...' : 'Iniciar sesión →'}
          </button>
        </form>

        <div className="mt-6 p-4 bg-dark-800 border border-dark-border rounded-xl">
          <p className="text-xs font-mono text-gray-500 mb-2">¿EMPLEADO? USA EL CHECADOR</p>
          <Link href="/check" className="btn-ghost text-sm py-2.5 w-full block text-center">
            📍 Ir al reloj checador
          </Link>
        </div>

        <p className="text-center text-gray-600 text-sm mt-4">
          ¿Sin cuenta?{' '}
          <Link href="/register" className="text-brand-400 font-semibold hover:underline">Registrar empresa</Link>
        </p>
      </div>
    </main>
  )
}
