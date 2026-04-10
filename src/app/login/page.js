'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { createClient } from '@/lib/supabase'

export default function LoginPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [form, setForm] = useState({ email: '', password: '' })

  async function handleSubmit(e) {
    e.preventDefault()
    setLoading(true)
    try {
      const { error } = await createClient().auth.signInWithPassword(form)
      if (error) throw error
      router.push('/dashboard')
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }

  return (
    <main className="min-h-dvh bg-dark-900 flex items-center justify-center px-5">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest mb-2">⬡ CHECKPRO</div>
          <h1 className="text-2xl font-extrabold">Iniciar sesión</h1>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div><label className="label">Correo</label><input className="input" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required/></div>
          <div><label className="label">Contraseña</label><input className="input" type="password" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} required/></div>
          <button type="submit" className="btn-primary" disabled={loading}>{loading ? 'Entrando...' : 'Iniciar sesión'}</button>
        </form>
        <p className="text-center text-gray-500 text-sm mt-4">
          <Link href="/register" className="text-brand-400">Registrar empresa</Link>
        </p>
      </div>
    </main>
  )
}
