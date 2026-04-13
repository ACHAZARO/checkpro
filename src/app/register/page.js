'use client'
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

  async function handleSubmit(e) {
    e.preventDefault()
    if (form.password !== form.confirmPassword) { toast.error('Las contraseñas no coinciden'); return }
    if (form.password.length < 8) { toast.error('Minímo 8 caracteres'); return }
    setLoading(true)
    try {
      const supabase = createClient()
      const { data: authData, error: authError } = await supabase.auth.signUp({ email: form.email, password: form.password })
      if (authError) throw authError
      const slug = slugify(form.companyName) + '-' + Math.random().toString(36).slice(2,6)
      const { data: tenant, error: tEr } = await supabase.from('tenants').insert({ name: form.companyName, slug, owner_email: form.email, config: { branchName: form.companyName, toleranceMinutes: 10, alertHours: 8, weekClosingDay: 'dom', location: { lat: 19.4326, lng: -99.1332, radius: 300, name: 'Oficina Principal' }, holidays: [], restDays: [] } }).select().single()
      if (tEr) throw tEr
      const { error: pEr } = await supabase.from('profiles').insert({ id: authData.user.id, tenant_id: tenant.id, name: form.companyName, role: 'owner' })
      if (pEr) throw pEr
      toast.success('ʁCuenta creada!')
      router.push('/dashboard/settings?onboarding=true')
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
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
          <div><label className="label">Nombre de tu empresa</label><input className="input" placeholder="Café Central" value={form.companyName} onChange={e=>setForm(f=>({...f,companyName:e.target.value}))} required/></div>
          <div><label className="label">Correo</label><input className="input" type="email" value={form.email} onChange={e=>setForm(f=>({...f,email:e.target.value}))} required/></div>
          <div><label className="label">Contraseña</label><input className="input" type="password" placeholder="Mínimo 8 caracteres" value={form.password} onChange={e=>setForm(f=>({...f,password:e.target.value}))} required/></div>
          <div><label className="label">Confirmar contraseña</label><input className="input" type="password" value={form.confirmPassword} onChange={e=>setForm(f=>({...f,confirmPassword:e.target.value}))} required/></div>
          <button type="submit" className="btn-primary mt-2" disabled={loading}>{loading ? '⏳ Creando...' : 'Crear cuenta gratis →'}</button>
        </form>
        <p className="text-center text-gray-500 text-sm mt-4">
          Va tienes cuenta?{' '}<Link href="/login" className="text-brand-400 font-semibold">Iniciar sesión</Link>
        </p>
      </div>
    </main>
  )
}
