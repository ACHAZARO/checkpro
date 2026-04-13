'use client'
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'

const NAV = [
  { href: '/dashboard', label: 'Hoy', icon: 'H' },
  { href: '/dashboard/employees', label: 'Personal', icon: 'P' },
  { href: '/dashboard/attendance', label: 'Asistencia', icon: 'A' },
  { href: '/dashboard/payroll', label: 'Nomina', icon: 'N' },
  { href: '/dashboard/settings', label: 'Config', icon: 'C' },
]

export default function DashboardLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    (async () => {
      const sb = createClient()
      const { data: { session } } = await sb.auth.getSession()
      if (!session) { router.push('/login'); return }
      const { data: prof } = await sb.from('profiles').select('*').eq('id', session.user.id).single()
      if (!prof) { router.push('/login'); return }
      setProfile(prof)
      if (prof.tenant_id) {
        const { data: ten } = await sb.from('tenants').select('*').eq('id', prof.tenant_id).single()
        setTenant(ten)
      }
      setLoading(false)
    })()
  }, [router])

  if (loading) return (
    <div className="min-h-dvh bg-dark-900 flex items-center justify-center">
      <div className="text-brand-400 font-mono animate-pulse">Cargando...</div>
    </div>
  )

  return (
    <div className="flex min-h-dvh bg-dark-900">
      <aside className="hidden md:flex flex-col w-56 bg-dark-800 border-r border-dark-border shrink-0">
        <div className="p-5 border-b border-dark-border">
          <div className="text-brand-400 font-mono text-xs font-bold">CHECKPRO</div>
          <div className="text-white font-bold text-sm mt-1 truncate">{tenant?.config?.branchName || tenant?.name}</div>
          <div className="text-gray-500 text-xs mt-0.5 truncate">{profile?.name}</div>
        </div>
        <nav className="flex-1 py-3">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={pathname === n.href
                ? 'flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-brand-400 bg-brand-400/5'
                : 'flex items-center gap-3 px-4 py-2.5 text-sm font-medium text-gray-400 hover:text-white hover:bg-dark-700'}
            >
              <span>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-dark-border space-y-2">
          <Link href="/check" target="_blank" className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-brand-400 rounded-lg hover:bg-dark-700">Abrir checador</Link>
          <button onClick={async () => { await createClient().auth.signOut(); router.push('/login') }} className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-red-400 rounded-lg hover:bg-dark-700 w-full">Cerrar sesion</button>
        </div>
      </aside>
      <main className="flex-1 flex flex-col min-w-0">
        <div className="md:hidden sticky top-0 z-30 bg-dark-900/92 border-b border-dark-border px-4 py-3 flex items-center justify-between">
          <div className="text-xs font-mono text-brand-400">CHECKPRO</div>
          <button onClick={async () => { await createClient().auth.signOut(); router.push('/login') }} className="text-xs text-gray-500 font-mono px-2 py-1 rounded border border-dark-border">Salir</button>
        </div>
        <div className="flex-1 overflow-y-auto pb-[72px] md:pb-0">{children}</div>
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-900/95 border-t border-dark-border flex z-50">
          {NAV.map(n => (
            <Link href={n.href} key={n.href}
              className={pathname === n.href ? 'flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors text-brand-400' : 'flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors text-gray-500'}
            >
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[10px] font-semibold">{n.label}</span>
            </Link>
          ))}
        </nav>
      </main>
    </div>
  )
}
