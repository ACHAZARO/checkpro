'use client'
// src/app/register/page.js
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'

export default function RegisterPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [form, setForm] = useState({ companyName: '', email: '', password: '', confirmPassword: '' })
  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) { toast.error('Las contraseñas no coinciden'); return }
    if (form.password.length < 8) { toast.error('La contraseña debe tener al menos 8 caracteres'); return }
    setLoading(true)

    try {
      // 1. Create user + tenant + profile server-side (bypasses RLS, handles orphan recovery)
      const res = await fetch('/api/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyName: form.companyName,
          email: form.email,
          password: form.password
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        throw new Error(data.error || 'Error al crear la cuenta')
      }

      // 2. Sign in on the client so the browser gets the auth cookies
      const supabase = createClient()
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: form.email,
        password: form.password
      })
      if (signErr) throw signErr

      if (data.recovered) {
        toast.success('¡Cuenta recuperada! Entrando...')
      } else {
        toast.success('¡Cuenta creada! Configurando tu empresa...')
      }
      router.push('/dashboard/settings?onboarding=true')
      router.refresh()
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
            <div className="relative">
              <input className="input pr-10" type={showPass ? 'text' : 'password'} placeholder="Mínimo 8 caracteres" value={form.password}
                onChange={e => F('password', e.target.value)} required />
              <button type="button" onClick={() => setShowPass(v => !v)}
                aria-label={showPass ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-brand-400 transition-colors text-lg px-1.5 py-0.5 rounded">
                {showPass ? '🙈' : '👁️'}
              </button>
            </div>
          </div>
          <div>
            <label className="label">Confirmar contraseña</label>
            <div className="relative">
              <input className="input pr-10" type={showConfirm ? 'text' : 'password'} placeholder="Repite la contraseña" value={form.confirmPassword}
                onChange={e => F('confirmPassword', e.target.value)} required />
              <button type="button" onClick={() => setShowConfirm(v => !v)}
                aria-label={showConfirm ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-brand-400 transition-colors text-lg px-1.5 py-0.5 rounded">
                {showConfirm ? '🙈' : '👁️'}
              </button>
            </div>
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
