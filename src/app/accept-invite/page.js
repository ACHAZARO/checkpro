'use client'
// src/app/accept-invite/page.js
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'

function AcceptInviteInner() {
  const router = useRouter()
  const params = useSearchParams()
  const token = params.get('token') || ''

  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState(null)
  const [error, setError] = useState(null)
  const [form, setForm] = useState({ name: '', password: '', confirmPassword: '' })
  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  useEffect(() => {
    async function load() {
      if (!token) { setError('Falta token en la URL'); setLoading(false); return }
      try {
        const r = await fetch(`/api/accept-invite?token=${encodeURIComponent(token)}`)
        const d = await r.json()
        if (!r.ok) { setError(d.error || 'Invitación inválida'); setLoading(false); return }
        setPreview(d)
      } catch (e) {
        setError('No se pudo verificar la invitación')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [token])

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) { toast.error('Las contraseñas no coinciden'); return }
    if (form.password.length < 8) { toast.error('La contraseña debe tener al menos 8 caracteres'); return }
    if (!form.name.trim()) { toast.error('Escribe tu nombre'); return }
    setSubmitting(true)
    try {
      const r = await fetch('/api/accept-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, name: form.name.trim(), password: form.password })
      })
      const d = await r.json()
      if (!r.ok) throw new Error(d.error || 'No se pudo aceptar la invitación')

      // Sign in on the browser so cookies persist
      const supabase = createClient()
      const { error: signErr } = await supabase.auth.signInWithPassword({ email: d.email, password: form.password })
      if (signErr) throw signErr
      toast.success('¡Bienvenido a CheckPro!')
      router.push('/dashboard')
      router.refresh()
    } catch (err) {
      toast.error(err.message || 'Error')
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <main className="min-h-dvh bg-dark-900 flex items-center justify-center">
        <div className="text-brand-400 font-mono text-sm animate-pulse">⬡ Verificando invitación...</div>
      </main>
    )
  }

  if (error || !preview) {
    return (
      <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5">
        <div className="max-w-md w-full text-center">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-xl font-bold mb-3">Invitación inválida</h1>
          <p className="text-gray-400 text-sm">{error || 'No se encontró información de la invitación.'}</p>
          <p className="text-xs text-gray-600 mt-6">Pídele a tu administrador que te envíe una nueva invitación.</p>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-2xl font-extrabold">Acepta tu invitación</h1>
          <p className="text-gray-400 text-sm mt-2">
            Has sido invitado como <span className="text-brand-400 font-semibold">Gerente</span>
            {preview.branchName && <> de <span className="text-white font-semibold">{preview.branchName}</span></>}
            {preview.tenantName && <> en <span className="text-white font-semibold">{preview.tenantName}</span></>}.
          </p>
          <p className="text-gray-600 text-xs mt-1">Correo: {preview.email}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Tu nombre completo</label>
            <input className="input" value={form.name}
              onChange={e => F('name', e.target.value)} required placeholder="María López" />
          </div>
          <div>
            <label className="label">Crea tu contraseña</label>
            <input className="input" type="password" value={form.password}
              onChange={e => F('password', e.target.value)} required placeholder="Mínimo 8 caracteres" />
          </div>
          <div>
            <label className="label">Confirma tu contraseña</label>
            <input className="input" type="password" value={form.confirmPassword}
              onChange={e => F('confirmPassword', e.target.value)} required placeholder="Repite la contraseña" />
          </div>

          <button type="submit" className="btn-primary mt-2" disabled={submitting}>
            {submitting ? '⏳ Aceptando...' : 'Aceptar invitación →'}
          </button>
        </form>
      </div>
    </main>
  )
}

export default function AcceptInvitePage() {
  return (
    <Suspense fallback={<main className="min-h-dvh bg-dark-900" />}>
      <AcceptInviteInner />
    </Suspense>
  )
}
