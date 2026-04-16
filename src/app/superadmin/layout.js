'use client'
// src/app/superadmin/layout.js
// Shell + role guard for the super-admin backoffice.
// Only users whose profile.role === 'super_admin' may enter.
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

const NAV = [
  { href: '/superadmin',          label: 'Panel',      icon: '📊' },
  { href: '/superadmin/users',    label: 'Usuarios',   icon: '👤' },
  { href: '/superadmin/tenants',  label: 'Empresas',   icon: '🏢' },
  { href: '/superadmin/sitemap',  label: 'Mapa',       icon: '🗺️' },
  { href: '/superadmin/docs',     label: 'Manuales',   icon: '📚' }
]

export default function SuperAdminLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [denied, setDenied] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login?next=/superadmin'); return }
      const { data: prof } = await supabase
        .from('profiles')
        .select('id, name, role, tenant_id')
        .eq('id', session.user.id)
        .maybeSingle()
      if (!prof) { router.push('/login'); return }
      if (prof.role !== 'super_admin') {
        setDenied(true)
        setLoading(false)
        return
      }
      setProfile(prof)
      setLoading(false)
    }
    load()
  }, [router])

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    toast.success('Sesión cerrada')
    router.push('/login')
  }

  if (loading) return (
    <div className="min-h-dvh bg-dark-900 flex items-center justify-center">
      <div className="text-brand-400 font-mono text-sm animate-pulse">⬡ Verificando acceso…</div>
    </div>
  )

  if (denied) return (
    <div className="min-h-dvh bg-dark-900 flex items-center justify-center p-6">
      <div className="max-w-md w-full bg-dark-800 border border-red-500/30 rounded-xl p-6 text-center">
        <div className="text-4xl mb-3">🚫</div>
        <div className="text-white font-bold text-lg mb-1">Acceso denegado</div>
        <div className="text-gray-400 text-sm mb-4">
          Esta zona está reservada para el administrador general de CheckPro.
        </div>
        <Link href="/dashboard" className="inline-block px-4 py-2 bg-brand-500 text-white rounded-lg text-sm font-semibold">
          Ir al dashboard
        </Link>
      </div>
    </div>
  )

  return (
    <div className="flex min-h-dvh bg-dark-900">
      <aside className="hidden md:flex flex-col w-60 bg-dark-800 border-r border-dark-border shrink-0">
        <div className="p-5 border-b border-dark-border">
          <div className="text-red-400 font-mono text-xs font-bold tracking-widest">⬢ SUPER ADMIN</div>
          <div className="text-white font-bold text-sm mt-1">CheckPro Backoffice</div>
          <div className="text-gray-500 text-[10px] mt-0.5 font-mono uppercase tracking-wider">Acceso total</div>
          <div className="text-gray-400 text-xs mt-0.5 truncate">{profile?.name}</div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors
                ${pathname === n.href ? 'text-red-400 bg-red-400/5 border-l-2 border-red-400' : 'text-gray-400 hover:text-white hover:bg-dark-700 border-l-2 border-transparent'}`}>
              <span>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-dark-border space-y-2">
          <Link href="/dashboard"
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-brand-400 transition-colors rounded-lg hover:bg-dark-700">
            ↩ Volver al dashboard
          </Link>
          <button onClick={signOut}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-red-400 transition-colors w-full rounded-lg hover:bg-dark-700">
            🚪 Cerrar sesión
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden sticky top-0 z-30 bg-dark-900/92 backdrop-blur border-b border-dark-border px-4 py-2.5 flex items-center justify-between gap-3">
          <div>
            <div className="text-[10px] font-mono text-red-400 tracking-widest">⬢ SUPER ADMIN</div>
            <div className="text-sm font-bold text-white">Backoffice</div>
          </div>
          <button onClick={signOut} className="text-xs text-gray-500 font-mono px-2 py-1 rounded border border-dark-border active:bg-dark-700">
            Salir
          </button>
        </div>

        <div className="flex-1 overflow-y-auto pb-[72px] md:pb-0">
          {children}
        </div>

        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-900/95 backdrop-blur border-t border-dark-border flex z-50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom,0)' }}>
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors
                ${pathname === n.href ? 'text-red-400' : 'text-gray-500'}`}>
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[9px] font-semibold">{n.label}</span>
            </Link>
          ))}
        </nav>
      </main>
    </div>
  )
}
