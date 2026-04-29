'use client'
// src/app/dashboard/layout.js
import { useState, useEffect, useRef } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import { useTheme } from '@/lib/ThemeContext'
import toast from 'react-hot-toast'
import {
  Home, Users, ClipboardList, AlertTriangle,
  DollarSign, Settings as SettingsIcon, MapPin, Wrench, LogOut,
} from 'lucide-react'

const NAV = [
  { href: '/dashboard',              label: 'Hoy',          shortLabel: 'Hoy',     Icon: Home },
  { href: '/dashboard/employees',    label: 'Personal',     shortLabel: 'Equipo',  Icon: Users },
  { href: '/dashboard/planning',     label: 'Planificador', shortLabel: 'Plan',    Icon: ClipboardList, mixedOnly: true },
  { href: '/dashboard/incidencias',  label: 'Incidencias',  shortLabel: 'Alertas', Icon: AlertTriangle },
  { href: '/dashboard/payroll',      label: 'Nómina',       shortLabel: 'Nómina',  Icon: DollarSign },
  { href: '/dashboard/settings',     label: 'Config',       shortLabel: 'Config',  Icon: SettingsIcon },
]

export default function DashboardLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const lastDetectRef = useRef(0)
  const { theme } = useTheme()

  // Reemplaza al cron de Vercel: dispara deteccion automatica de incidencias en tiempo real.
  // - Idempotente (insertIncidenciaOnce dedup por tenant+empleado+fecha+kind)
  // - Throttle 60s para evitar doble disparo en clicks rapidos consecutivos.
  // - Se llama en cada cambio de ruta dentro del dashboard, asi cada vez que clickeas
  //   una pestana (Hoy, Nomina, Incidencias, etc.) los datos quedan al dia.
  async function maybeDetectIncidencias(prof, accessToken) {
    if (!prof || !accessToken) return
    if (!['owner','admin','manager','super_admin'].includes(prof.role)) return
    const THROTTLE_MS = 60 * 1000
    const now = Date.now()
    if (now - lastDetectRef.current < THROTTLE_MS) return
    lastDetectRef.current = now
    try {
      await fetch('/api/incidencias/detect-now', {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}` },
      })
    } catch {
      // fire-and-forget: deteccion no debe romper el dashboard
    }
  }

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

      const [{ data: ten, error: tErr }, { data: branchData }] = await Promise.all([
        supabase.from('tenants').select('*').eq('id', prof.tenant_id).single(),
        supabase.from('branches').select('id,config').eq('tenant_id', prof.tenant_id),
      ])
      if (tErr || !ten) {
        // Tenant borrado o RLS bloquea → tambien mandar a onboarding para crear uno nuevo
        console.error('[dashboard] tenant not visible:', tErr, 'tenant_id:', prof.tenant_id)
        router.push('/onboarding')
        return
      }
      setTenant(ten)
      setBranches(branchData || [])
      setLoading(false)
    }
    load()
  }, [router])

  // Disparo en tiempo real: cada navegacion dentro de /dashboard llama detect-now.
  // Cubre tambien el primer mount (cuando profile pasa de null a cargado).
  useEffect(() => {
    if (!profile) return
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.access_token) maybeDetectIncidencias(profile, session.access_token)
    })
  }, [pathname, profile])

  // Respaldo: re-disparar al volver al tab (caso tab abierto sin navegar por horas).
  useEffect(() => {
    if (!profile) return
    function onVisibility() {
      if (document.visibilityState !== 'visible') return
      const supabase = createClient()
      supabase.auth.getSession().then(({ data: { session } }) => {
        if (session?.access_token) maybeDetectIncidencias(profile, session.access_token)
      })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [profile])

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

  // FIX: mixedSchedule por sucursal
  const branchScope = profile?.role === 'manager' && profile?.branch_id
    ? branches.filter(b => b.id === profile.branch_id)
    : branches
  const showMixedNav = branchScope.length > 0
    ? branchScope.some(b => (b.config?.mixedSchedule || tenant?.config?.mixedSchedule)?.enabled === true)
    : tenant?.config?.mixedSchedule?.enabled === true

  return (
    <div className="flex h-dvh overflow-hidden" style={{ backgroundColor: 'var(--cp-bg)' }}>
      {/* Desktop sidebar — respeta theme para no chocar con UI claro */}
      <aside data-sidebar
        className={`hidden md:flex flex-col w-60 shrink-0 relative border-r ${
          theme === 'dark' ? 'border-dark-border' : 'border-gray-200'
        }`}
        style={{
          background: theme === 'dark'
            ? 'linear-gradient(180deg, #0c0f15 0%, #101318 40%, #0e1117 100%)'
            : 'linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)',
        }}>
        <div className="absolute top-0 left-0 right-0 h-px" style={{ background: 'linear-gradient(90deg, transparent, rgba(61,255,160,0.25), transparent)' }} />
        <div className={`p-5 pb-4 border-b ${theme === 'dark' ? 'border-dark-border' : 'border-gray-200'}`}>
          <div className="flex items-center gap-2">
            <img src="/logo-icon.svg" alt="CheckPro" className="w-7 h-7 shrink-0" style={{ filter: 'drop-shadow(0 4px 8px rgba(61,255,160,0.35))' }} />
            <div className="flex-1 min-w-0">
              <div className={`font-bold text-[13px] leading-tight truncate ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`} title={tenant?.name || tenant?.config?.branchName || '—'}>{tenant?.name || tenant?.config?.branchName || '—'}</div>
              <div className={`text-[10px] font-mono tracking-wider uppercase mt-0.5 truncate ${theme === 'dark' ? 'text-gray-400' : 'text-gray-500'}`} title={profile?.name}>{profile?.name}</div>
            </div>
          </div>
        </div>
        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV.filter(n => !n.mixedOnly || showMixedNav).map(n => {
            const active = pathname === n.href
            const inactiveCls = theme === 'dark'
              ? 'text-gray-300 hover:text-white hover:bg-dark-700'
              : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100'
            return (
              <Link key={n.href} href={n.href}
                className={`relative flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-all
                  ${active ? 'text-black' : inactiveCls}`}
                style={active ? { background: 'linear-gradient(135deg, rgba(82,255,176,0.95), rgba(61,255,160,0.9))', boxShadow: '0 4px 16px -4px rgba(61,255,160,0.3), inset 0 1px 0 rgba(255,255,255,0.2)' } : undefined}>
                <n.Icon size={16} /> {n.label}
              </Link>
            )
          })}
        </nav>
        <div className={`p-4 border-t space-y-2 ${theme === 'dark' ? 'border-dark-border' : 'border-gray-200'}`}>
          <Link href="/check" target="_blank"
            className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors rounded-lg ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-brand-400 hover:bg-dark-700'
                : 'text-gray-600 hover:text-brand-500 hover:bg-gray-100'
            }`}>
            <MapPin size={13} /> Abrir checador
          </Link>
          {['owner','manager','super_admin'].includes(profile?.role) && (
            <Link href="/dashboard/bugs"
              className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors rounded-lg ${
                pathname === '/dashboard/bugs'
                  ? (theme === 'dark' ? 'text-brand-400' : 'text-brand-500')
                  : (theme === 'dark'
                      ? 'text-gray-400 hover:text-brand-400 hover:bg-dark-700'
                      : 'text-gray-600 hover:text-brand-500 hover:bg-gray-100')
              }`}>
              <Wrench size={13} /> Bugs y mejoras
            </Link>
          )}
          <button onClick={signOut}
            className={`flex items-center gap-2 px-3 py-2 text-xs transition-colors w-full rounded-lg ${
              theme === 'dark'
                ? 'text-gray-400 hover:text-red-400 hover:bg-dark-700'
                : 'text-gray-600 hover:text-red-500 hover:bg-gray-100'
            }`}>
            <LogOut size={13} /> Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className={`md:hidden sticky top-0 z-30 backdrop-blur border-b px-4 py-3 flex items-center justify-between ${theme === 'dark' ? 'bg-dark-900/92 border-dark-border' : 'bg-white/95 border-gray-200'}`}>
          <div className="flex items-center gap-2.5 min-w-0 flex-1 pr-3">
            <img src="/logo-icon.svg" alt="CheckPro" className="w-7 h-7 shrink-0" />
            <div className="min-w-0">
              <div className="text-[10px] font-mono text-brand-400 tracking-widest leading-none mb-0.5">CHECKPRO</div>
              <div className={`text-sm font-bold truncate leading-tight ${theme === 'dark' ? 'text-white' : 'text-gray-900'}`} title={tenant?.name || tenant?.config?.branchName}>{tenant?.name || tenant?.config?.branchName}</div>
            </div>
          </div>
          <button onClick={signOut} className={`shrink-0 text-xs font-mono px-2.5 py-1.5 rounded-lg border transition-colors ${theme === 'dark' ? 'text-gray-400 border-dark-border hover:text-gray-200 hover:bg-dark-700' : 'text-gray-500 border-gray-300 hover:text-gray-800 hover:bg-gray-100'}`}>
            Salir
          </button>
        </div>

        {/* Page content */}
        <div
          className="flex-1 overflow-y-auto pb-[calc(72px+env(safe-area-inset-bottom,0px))] md:pb-0"
          style={{ overscrollBehavior: 'contain' }}>
          {children}
        </div>

        {/* Mobile bottom nav — promovida a capa propia para evitar flicker al navegar */}
        <nav
          data-bottom-nav
          className={`md:hidden fixed bottom-0 left-0 right-0 backdrop-blur border-t flex z-50 ${theme === 'dark' ? 'bg-dark-900/95 border-dark-border' : 'bg-white/95 border-gray-200'}`}
          style={{
            paddingBottom: 'env(safe-area-inset-bottom,0)',
            transform: 'translateZ(0)',
            willChange: 'transform',
            backfaceVisibility: 'hidden',
          }}>
          {NAV.filter(n => !n.mixedOnly || showMixedNav).map(n => {
            const active = pathname === n.href
            return (
              <Link key={n.href} href={n.href}
                prefetch
                className={`flex-1 flex flex-col items-center gap-0.5 py-2 transition-colors duration-150 min-w-0
                  ${active ? 'text-brand-400' : 'text-gray-400'}`}>
                <n.Icon size={18} className="shrink-0" />
                <span className="text-[9px] font-semibold truncate w-full text-center leading-tight">{n.shortLabel}</span>
              </Link>
            )
          })}
        </nav>
      </main>
    </div>
  )
}

