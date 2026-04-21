'use client'
// src/app/auth/reset/page.js
import { useState, useEffect, Suspense } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

function ResetPageInner() {
  const searchParams = useSearchParams()
  const router = useRouter()
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPass, setShowPass] = useState(false)
  const [showConfirm, setShowConfirm] = useState(false)
  const [loading, setLoading] = useState(false)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    async function verifyToken() {
      const supabase = createClient()

      // Check if there's a token_hash in the URL (Supabase email link flow)
      const token_hash = searchParams.get('token_hash')
      const type = searchParams.get('type')

      if (token_hash && type === 'recovery') {
        const { error } = await supabase.auth.verifyOtp({ token_hash, type: 'recovery' })
        if (error) {
          setError('El link expiró o ya fue usado. Solicita uno nuevo.')
          return
        }
        setReady(true)
        return
      }

      // Check if we already have an active session (from callback route)
      const { data: { session } } = await supabase.auth.getSession()
      if (session) {
        setReady(true)
        return
      }

      // Also handle hash fragment (older Supabase behavior)
      if (typeof window !== 'undefined' && window.location.hash) {
        const hash = window.location.hash.substring(1)
        const params = new URLSearchParams(hash)
        const access_token = params.get('access_token')
        const refresh_token = params.get('refresh_token')
        if (access_token) {
          const { error } = await supabase.auth.setSession({ access_token, refresh_token })
          if (!error) { setReady(true); return }
        }
      }

      setError('Link inválido. Por favor solicita un nuevo correo de restablecimiento.')
    }
    verifyToken()
  }, [searchParams])

  async function handleSubmit(e) {
    e.preventDefault()
    if (password.length < 6) { toast.error('La contraseña debe tener al menos 6 caracteres'); return }
    if (password !== confirm) { toast.error('Las contraseñas no coinciden'); return }
    setLoading(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.auth.updateUser({ password })
      if (error) throw error
      toast.success('¡Contraseña actualizada!')
      setTimeout(() => router.push('/dashboard'), 1500)
    } catch (err) {
      toast.error(err.message || 'Error al actualizar la contraseña')
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-2xl font-extrabold text-white">Nueva contraseña</h1>
          <p className="text-gray-500 text-sm mt-1">Ingresa tu nueva contraseña de acceso</p>
        </div>

        {error ? (
          <div className="card text-center py-8">
            <div className="text-4xl mb-3">⚠️</div>
            <p className="text-red-400 text-sm font-semibold mb-4">{error}</p>
            <button
              onClick={() => router.push('/login')}
              className="btn-primary">
              Volver al login →
            </button>
          </div>
        ) : !ready ? (
          <div className="card text-center py-8">
            <div className="text-3xl mb-3 animate-pulse">🔐</div>
            <p className="text-gray-400 text-sm font-mono">Verificando link...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card space-y-4">
            <div>
              <label className="label">Nueva contraseña</label>
              <div className="relative">
                <input
                  className="input pr-10" type={showPass ? 'text' : 'password'}
                  placeholder="Mínimo 6 caracteres"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  required minLength={6} />
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
                <input
                  className="input pr-10" type={showConfirm ? 'text' : 'password'}
                  placeholder="Repite la contraseña"
                  value={confirm}
                  onChange={e => setConfirm(e.target.value)}
                  required minLength={6} />
                <button type="button" onClick={() => setShowConfirm(v => !v)}
                  aria-label={showConfirm ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-brand-400 transition-colors text-lg px-1.5 py-0.5 rounded">
                  {showConfirm ? '🙈' : '👁️'}
                </button>
              </div>
            </div>
            {password && confirm && password !== confirm && (
              <p className="text-red-400 text-xs font-mono">⚠ Las contraseñas no coinciden</p>
            )}
            <button type="submit" className="btn-primary" disabled={loading || !password || !confirm}>
              {loading ? '⏳ Guardando...' : '✓ Actualizar contraseña'}
            </button>
          </form>
        )}
      </div>
    </main>
  )
}

export default function ResetPage() {
  return (
    <Suspense fallback={
      <div className="min-h-dvh bg-dark-900 flex items-center justify-center">
        <p className="text-gray-500 font-mono text-sm">Cargando...</p>
      </div>
    }>
      <ResetPageInner />
    </Suspense>
  )
}
