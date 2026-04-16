'use client'
// src/app/dashboard/layout.js
// Dashboard shell with branch selector + role-aware navigation.
// - Owner sees "Personal / Asistencia / Nómina / Configuración" + branch selector (all branches).
// - Manager sees "Personal / Asistencia / Nómina" only, locked to their branch.
// Selected branch is persisted in localStorage as `checkpro_active_branch`.
// When it changes we emit a window event `checkpro:branch-change` so pages can refetch.
import { useState, useEffect } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

const NAV_ALL = [
  { href: '/dashboard',            label: 'Hoy',        icon: '🏠', roles: ['owner','super_admin','manager'] },
  { href: '/dashboard/employees',  label: 'Personal',   icon: '👥', roles: ['owner','super_admin','manager'] },
  { href: '/dashboard/attendance', label: 'Asistencia', icon: '📅', roles: ['owner','super_admin','manager'] },
  { href: '/dashboard/payroll',    label: 'Nómina',     icon: '💰', roles: ['owner','super_admin','manager'] },
  { href: '/dashboard/archivo',    label: 'Archivo',    icon: '📦', roles: ['owner','super_admin'] },
  { href: '/dashboard/settings',   label: 'Config',     icon: '⚙️', roles: ['owner','super_admin'] },
]

export const ACTIVE_BRANCH_KEY = 'checkpro_active_branch'

export default function DashboardLayout({ children }) {
  const router = useRouter()
  const pathname = usePathname()
  const [profile, setProfile] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [branches, setBranches] = useState([])
  const [activeBranchId, setActiveBranchId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { router.push('/login'); return }

      let { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()

      // Orphan recovery: user has a valid session but no profile (from the old broken signup).
      // Bootstrap the tenant + profile on the fly.
      if (!prof) {
        try {
          const r = await fetch('/api/bootstrap', { method: 'POST' })
          if (r.ok) {
            const retry = await supabase.from('profiles').select('*').eq('id', session.user.id).maybeSingle()
            prof = retry.data
          }
        } catch (e) { /* fall through */ }
      }

      if (!prof) { router.push('/login'); return }
      setProfile(prof)

      if (prof.tenant_id) {
        const { data: ten } = await supabase.from('tenants').select('*').eq('id', prof.tenant_id).single()
        setTenant(ten)

        // Fetch branches via server-side endpoint (RLS-aware)
        try {
          const r = await fetch('/api/branches')
          if (r.ok) {
            const { branches: list } = await r.json()
            setBranches(list || [])

            const isAdmin = prof.role === 'owner' || prof.role === 'super_admin'
            let active = null
            if (isAdmin) {
              active = localStorage.getItem(ACTIVE_BRANCH_KEY)
              const stillExists = (list || []).some(b => b.id === active)
              if (!stillExists) active = (list || [])[0]?.id || null
            } else {
              // manager is locked to their branch
              active = prof.branch_id || (list || [])[0]?.id || null
            }
            if (active) {
              setActiveBranchId(active)
              localStorage.setItem(ACTIVE_BRANCH_KEY, active)
            }
          }
        } catch (e) { /* no branches yet */ }
      }
      setLoading(false)
    }
    load()
  }, [router])

  function changeBranch(id) {
    setActiveBranchId(id)
    localStorage.setItem(ACTIVE_BRANCH_KEY, id)
    window.dispatchEvent(new CustomEvent('checkpro:branch-change', { detail: { branchId: id } }))
    setMenuOpen(false)
  }

  async function signOut() {
    const supabase = createClient()
    await supabase.auth.signOut()
    localStorage.removeItem(ACTIVE_BRANCH_KEY)
    toast.success('Sesión cerrada')
    router.push('/login')
  }

  if (loading) return (
    <div className="min-h-dvh bg-dark-900 flex items-center justify-center">
      <div className="text-brand-400 font-mono text-sm animate-pulse">⬡ Cargando CheckPro...</div>
    </div>
  )

  const role = profile?.role || 'manager'
  const isAdmin = role === 'owner' || role === 'super_admin'
  const NAV = NAV_ALL.filter(n => n.roles.includes(role))
  const activeBranch = branches.find(b => b.id === activeBranchId)
  const roleLabel = role === 'owner' ? 'Propietario' : role === 'super_admin' ? 'Super admin' : 'Gerente'

  return (
    <div className="flex min-h-dvh bg-dark-900">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-60 bg-dark-800 border-r border-dark-border shrink-0">
        <div className="p-5 border-b border-dark-border">
          <div className="text-brand-400 font-mono text-xs font-bold tracking-widest">⬡ CHECKPRO</div>
          <div className="text-white font-bold text-sm mt-1 truncate">{tenant?.name || '—'}</div>
          <div className="text-gray-500 text-[10px] mt-0.5 font-mono uppercase tracking-wider">{roleLabel}</div>
          <div className="text-gray-400 text-xs mt-0.5 truncate">{profile?.name}</div>
        </div>

        {/* Branch switcher */}
        {branches.length > 0 && (
          <div className="px-4 pt-3 pb-2 border-b border-dark-border">
            <label className="text-[10px] font-mono text-gray-500 uppercase tracking-wider mb-1 block">Sucursal activa</label>
            {isAdmin ? (
              <select value={activeBranchId || ''} onChange={e => changeBranch(e.target.value)}
                className="w-full bg-dark-700 border border-dark-border rounded-lg px-2 py-1.5 text-sm text-white focus:border-brand-400 outline-none">
                {branches.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            ) : (
              <div className="bg-dark-700 border border-dark-border rounded-lg px-2 py-1.5 text-sm text-white flex items-center gap-2">
                <span className="text-brand-400 text-xs">🔒</span>
                <span className="truncate">{activeBranch?.name || '—'}</span>
              </div>
            )}
          </div>
        )}

        <nav className="flex-1 py-3">
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors
                ${pathname === n.href ? 'text-brand-400 bg-brand-400/5 border-l-2 border-brand-400' : 'text-gray-400 hover:text-white hover:bg-dark-700 border-l-2 border-transparent'}`}>
              <span>{n.icon}</span>{n.label}
            </Link>
          ))}
        </nav>
        <div className="p-4 border-t border-dark-border space-y-2">
          <Link href="/check" target="_blank"
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-brand-400 transition-colors rounded-lg hover:bg-dark-700">
            📍 Abrir checador
          </Link>
          <button onClick={signOut}
            className="flex items-center gap-2 px-3 py-2 text-xs text-gray-500 hover:text-red-400 transition-colors w-full rounded-lg hover:bg-dark-700">
            🚪 Cerrar sesión
          </button>
        </div>
      </aside>

      {/* Main content */}
      <main className="flex-1 flex flex-col min-w-0">
        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 bg-dark-900/92 backdrop-blur border-b border-dark-border px-4 py-2.5 flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] font-mono text-brand-400 tracking-widest">⬡ CHECKPRO</div>
            <div className="text-sm font-bold text-white truncate">{tenant?.name}</div>
          </div>
          {branches.length > 0 && (
            isAdmin ? (
              <select value={activeBranchId || ''} onChange={e => changeBranch(e.target.value)}
                className="bg-dark-700 border border-dark-border rounded-lg px-2 py-1 text-xs text-white focus:border-brand-400 outline-none max-w-[40%]">
                {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : (
              <div className="bg-dark-700 border border-dark-border rounded-lg px-2 py-1 text-xs text-white max-w-[40%] truncate">
                🔒 {activeBranch?.name}
              </div>
            )
          )}
          <button onClick={signOut} className="text-xs text-gray-500 font-mono px-2 py-1 rounded border border-dark-border active:bg-dark-700">
            Salir
          </button>
        </div>

        {/* Page content */}
        <div className="flex-1 overflow-y-auto pb-[72px] md:pb-0">
          {children}
        </div>

        {/* Mobile bottom nav */}
        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-dark-900/95 backdrop-blur border-t border-dark-border flex z-50"
          style={{ paddingBottom: 'env(safe-area-inset-bottom,0)' }}>
          {NAV.map(n => (
            <Link key={n.href} href={n.href}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-colors
                ${pathname === n.href ? 'text-brand-400' : 'text-gray-500'}`}>
              <span className="text-lg leading-none">{n.icon}</span>
              <span className="text-[10px] font-semibold">{n.label}</span>
            </Link>
          ))}
        </nav>
      </main>
    </div>
  )
}
