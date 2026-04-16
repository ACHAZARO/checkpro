'use client'
// src/app/superadmin/page.js
// Overview dashboard — aggregate metrics across all tenants.
import { useState, useEffect } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'

export default function SuperAdminOverview() {
  const [stats, setStats] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/admin/stats')
      .then(r => r.json())
      .then(d => { setStats(d); setLoading(false) })
      .catch(e => { toast.error('Error al cargar estadísticas'); setLoading(false) })
  }, [])

  if (loading) return <div className="p-8 text-gray-400 font-mono text-sm animate-pulse">Cargando…</div>

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Panel de control general</h1>
        <p className="text-gray-400 text-sm mt-1">Vista consolidada de toda la plataforma CheckPro.</p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Stat label="Empresas" value={stats?.tenants ?? '—'} icon="🏢" accent="text-brand-400" />
        <Stat label="Usuarios admin" value={stats?.profiles ?? '—'} icon="👤" accent="text-indigo-400" />
        <Stat label="Empleados" value={stats?.employees ?? '—'} icon="👥" accent="text-emerald-400" />
        <Stat label="Sucursales" value={stats?.branches ?? '—'} icon="📍" accent="text-amber-400" />
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
        <Stat label="Checadas hoy" value={stats?.shiftsToday ?? '—'} icon="📅" accent="text-sky-400" />
        <Stat label="Checadas 7 días" value={stats?.shifts7d ?? '—'} icon="📈" accent="text-purple-400" />
        <Stat label="Invitaciones pendientes" value={stats?.invitesPending ?? '—'} icon="✉️" accent="text-yellow-400" />
        <Stat label="Empresas inactivas" value={stats?.tenantsInactive ?? '—'} icon="⛔" accent="text-red-400" />
      </div>

      <div className="bg-dark-800 border border-dark-border rounded-xl p-5 mb-6">
        <h2 className="text-white font-semibold mb-3">Acciones rápidas</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <QuickLink href="/superadmin/users" label="Ver todos los usuarios" icon="👤"
            desc="Buscar, suspender o restablecer contraseñas de cualquier cuenta." />
          <QuickLink href="/superadmin/tenants" label="Gestionar empresas" icon="🏢"
            desc="Ver empresas registradas, dar de baja o reactivar." />
          <QuickLink href="/superadmin/sitemap" label="Mapa del sitio" icon="🗺️"
            desc="Todas las pantallas del sistema y cómo se conectan." />
          <QuickLink href="/superadmin/docs" label="Manuales PDF" icon="📚"
            desc="Documentación completa para admin y empleados." />
          <QuickLink href="/dashboard" label="Ir al dashboard normal" icon="↩"
            desc="Regresar a la vista de propietario de tu empresa." />
        </div>
      </div>

      {stats?.topTenants?.length > 0 && (
        <div className="bg-dark-800 border border-dark-border rounded-xl p-5">
          <h2 className="text-white font-semibold mb-3">Empresas más activas (últimos 7 días)</h2>
          <div className="space-y-2">
            {stats.topTenants.map(t => (
              <div key={t.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
                <div>
                  <div className="text-white text-sm font-medium">{t.name}</div>
                  <div className="text-gray-500 text-xs">{t.employees} empleados · {t.branches} sucursales</div>
                </div>
                <div className="text-right">
                  <div className="text-brand-400 font-mono text-sm font-bold">{t.shifts7d}</div>
                  <div className="text-gray-500 text-[10px]">checadas</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, icon, accent }) {
  return (
    <div className="bg-dark-800 border border-dark-border rounded-xl p-4">
      <div className="text-2xl mb-1">{icon}</div>
      <div className={`text-2xl font-bold ${accent}`}>{value}</div>
      <div className="text-gray-500 text-[10px] uppercase tracking-wider font-mono mt-1">{label}</div>
    </div>
  )
}

function QuickLink({ href, label, icon, desc }) {
  return (
    <Link href={href} className="block bg-dark-700 hover:bg-dark-600 border border-dark-border hover:border-brand-400 rounded-lg p-4 transition-colors">
      <div className="flex items-start gap-3">
        <div className="text-2xl">{icon}</div>
        <div className="flex-1">
          <div className="text-white font-semibold text-sm">{label}</div>
          <div className="text-gray-400 text-xs mt-0.5">{desc}</div>
        </div>
      </div>
    </Link>
  )
}
