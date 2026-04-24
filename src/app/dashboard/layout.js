'use client'
// src/app/dashboard/layout.js
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useTheme } from '@/lib/ThemeContext'
import toast from 'react-hot-toast'
import {
  Home, Users, CalendarCheck, ClipboardList, AlertTriangle,
  DollarSign, Settings as SettingsIcon, MapPin, Wrench, LogOut,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard',              label: 'Hoy',          Icon: Home },
  { href: '/dashboard/employees',    label: 'Personal',     Icon: Users },
  { href: '/dashboard/attendance',   label: 'Registros',    Icon: CalendarCheck },
  { href: '/dashboard/planning',     label: 'Planificador', Icon: ClipboardList, mixedOnly: true },
  { href: '/dashboard/incidencias',  label: 'Incidencias',  Icon: AlertTriangle },
  { href: '/dashboard/payroll',      label: 'Nómina',       Icon: DollarSign },
  { href: '/dashboard/settings',     label: 'Config',       Icon: SettingsIcon },
]

export default function DashboardLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [loading, setLoading] = useState(true)
  const { theme } = useTheme()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      const { data: prof, error: pErr } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
      if (pErr || !prof) {
        console.error('[dashboard] no profile:', pErr)
        // Sin profile → onboarding (creara profile + tenant)
        router.push('/onboarding')
        return
      }
      setProfile(prof)

      // Si el profile no tiene tenant asignado → onboarding
      if (!prof.tenant_id) {
        router.push('/onboarding')
        return
      }

      const { data: ten, error: tErr } = await supabase.from('tenants').select('*').eq('id', prof.tenant_id).single()
      if (tErr || !ten) {
        // Tenant borrado o RLS bloquea → tambien mandar a onboarding para crear uno nuevo
        console.error('[dashboard] tenant not visible:', tErr, 'tenant_id:', prof.tenant_id)
        router.push('/onboarding')
        return
      }
      setTenant(ten)
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
    <div className="min-h-dvh flex items-center justify-center" style={{ backgroundColor: 'var(--cp-bg)' }}>
      <div className="text-brand-400 font-mono text-sm animate-pulse">⬡ Cargando CheckPro...</div>
    </div>
  )

  return (
    <div className="flex min-h-dvh" style={{ backgroundColor: 'var(--cp-bg)' }}>
      {/* Desktop sidebar */}
      <aside data-sidebar className="hidden md:flex flex-col w-60 shrink-0 relative" style={{ background: 'linear-gradient(180deg, #0c0f15 0%, #101318 40%, #0e1117 100%)', borderRight: '1px solid #1f2636' }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(61,255,160,0.25), transparent)' }} />
        <div className="p-5 pb-4 border-b border-dark-border">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center font-mono text-[11px] font-bold text-black shrink-0" style={{ background: 'linear-gradient(135deg, #52ffb0, #00d97e)', boxShadow: '0 4px 12px -2px rgba(61,255,160,0.4)' }}>CP</div>
            <div className="flex-1 min-w-0">
              <div className="text-white font-bold text-[13px] leading-tight truncate">{tenant?.name || tenant?.config?.branchName || '—'}</div>
              <div className="text-gray-500 text-[10px] font-mono tracking-wider uppercase mt-0.5 truncate">{profile?.name}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.filter(n => !n.mixedOnly || tenant?.config?.mixedSchedule?.enabled).map(n => {
            const active = pathname === n.href
            return (
              <Link key={n.href} href={n.href}
                className={`relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all
                  ${active ? 'text-black' : 'text-gray-400 hover:text-white hover:bg-dark-700/60'}`}
                style={active ? { background: 'linear-gradient(135deg, rgba(82,255,176,0.95), rgba(61,255,160,0.9))', boxShadow: '0 4px 16px -4px rgba(61,255,160,0.3), inset 0 1px 0 rgba(255,255,255,0.2)' } : undefined}>
                <n.Icon size={16} /> {n.label}
              </Link>
            )
          })}
        </nav>
        <div className="p-4 border-t border-dark-border space-y-2">
          <Link href="/check" target="_blank"
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-brand-400 transition-colors rounded-lg hover:bg-dark-700">
            <MapPin size={13} /> Abrir checador
          </Link>
          {['owner','manager','super_admin'].includes(profile?.role) && (
            <Link href="/dashboard/bugs"
              className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors rounded-lg hover:bg-dark-700 ${
                pathname === '/dashboard/bugs' ? 'text-brand-400' : 'text-gray-500 hover:text-brand-400'
              }`}>
              <Wrench size={13} /> Bugs y mejoras
            </Link>
          )}
          <button onClick={signOut}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-red-400 transition-colors w-full rounded-lg hover:bg-dark-700">
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className={`md:hidden sticky top-0 z-30 backdrop-blur border-b px-5 py-3 flex items-center justify-between ${theme === 'dark' ? 'bg-dark-900/92 border-dark-border' : 'bg-white/95 border-gray-200'}`}>
          <div>
            <div className="text-xs font-mono text-brand-400 tracking-widest">⬡ CHECKPRO</div>
            <div className="text-sm font-bold text-white">{tenant?.name || tenant?.config?.branchName}</div>
          </div>
          <button onClick={signOut} className="text-xs text-gray-500 font-mono px-2 py-1 rounded border border-dark-border active:bg-dark-700">
            Salir
          </button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto pb-[72px] md:pb-0">
          {children}
        </div>

        {/* Mobile bottom nav */}
        <nav className={`md:hidden fixed bottom-0 left-0 right-0 backdrop-blur border-t flex z-50 ${theme === 'dark' ? 'bg-dark-900/95 border-dark-border' : 'bg-white/95 border-gray-200'}`}
          style={{ paddingBottom: 'env(safe-area-inset-bottom,0)' }}>
          {NAV.filter(n => !n.mixedOnly || tenant?.config?.mixedSchedule?.enabled).map(n => (
            <Link key={n.href} href={n.href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors
                ${pathname === n.href ? 'text-brand-400' : 'text-gray-500'}`}>
              <n.Icon size={18} />
              <span className="text-[10px] font-semibold">{n.label}</span>
            </Link>
          ))}
        </nav>
      </main>
    </div>
  )
}

