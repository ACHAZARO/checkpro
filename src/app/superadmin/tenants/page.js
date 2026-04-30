'use client'
// src/app/superadmin/tenants/page.js
// All tenants (companies) list + management.
import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'

export default function SuperAdminTenantsPage() {
  const [tenants, setTenants] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [working, setWorking] = useState(null)
  const [detail, setDetail] = useState(null)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/tenants')
    const data = await r.json()
    if (r.ok) setTenants(data.tenants || [])
    else toast.error(data.error || 'Error')
    setLoading(false)
  }
  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!q.trim()) return tenants
    const t = q.toLowerCase()
    return tenants.filter(x =>
      (x.name || '').toLowerCase().includes(t)
      || (x.owner_email || '').toLowerCase().includes(t)
      || (x.slug || '').toLowerCase().includes(t)
    )
  }, [tenants, q])

  async function doPatch(id, patch) {
    // FIX: suspender/reactivar empresas requiere confirmacion explicita.
    if (typeof patch.active === 'boolean' && !confirm(`${patch.active ? 'Reactivar' : 'Suspender'} esta empresa?`)) return
    setWorking(id + ':patch')
    const r = await fetch(`/api/admin/tenants/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch)
    })
    const data = await r.json()
    if (!r.ok) toast.error(data.error || 'Error')
    else { toast.success('Listo'); await load() }
    setWorking(null)
  }

  async function doDelete(t) {
    // FIX: borrado destructivo con doble confirmacion explicita.
    if (!confirm(`Eliminar empresa "${t.name}" y TODOS sus datos (empleados, asistencia, usuarios)?\n\nEsta acción NO se puede deshacer.`)) return
    if (!confirm(`Confirma una vez más: esto borrará ${t.employees} empleados, ${t.branches} sucursales y ${t.profiles} usuarios.`)) return
    setWorking(t.id + ':delete')
    const r = await fetch(`/api/admin/tenants/${t.id}`, { method: 'DELETE' })
    const data = await r.json()
    if (!r.ok) toast.error(data.error || 'Error')
    else { toast.success('Empresa eliminada'); await load() }
    setWorking(null)
  }

  async function openDetail(id) {
    setDetail({ loading: true })
    const r = await fetch(`/api/admin/tenants/${id}`)
    const data = await r.json()
    if (r.ok) setDetail({ loading: false, ...data })
    else { setDetail(null); toast.error(data.error || 'Error') }
  }

  useEffect(() => {
    if (!detail) return
    const onKey = (e) => {
      if (e.key === 'Escape') setDetail(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail])

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-5">
        <h1 className="text-white text-2xl font-bold">Empresas</h1>
        <p className="text-gray-400 text-sm mt-1">Todas las empresas registradas en CheckPro.</p>
      </div>

      <div className="mb-4 flex gap-2 items-center">
        <input type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Buscar por nombre, correo o slug…"
          className="flex-1 bg-dark-800 border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:border-brand-400 outline-none" />
        <button onClick={load}
          className="px-3 py-2 text-xs font-mono text-gray-400 border border-dark-border rounded-lg hover:bg-dark-700 hover:text-white">
          ↻
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm animate-pulse font-mono">Cargando…</div>
      ) : (
        <div className="space-y-2">
          {filtered.map(t => (
            <div key={t.id} className={`bg-dark-800 border rounded-xl p-4 ${!t.active ? 'opacity-60 border-red-500/30' : 'border-dark-border'}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-white font-semibold text-sm">{t.name}</span>
                    <span className="text-[10px] font-mono text-gray-500 uppercase">{t.slug}</span>
                    <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${
                      t.plan === 'enterprise' ? 'bg-purple-400/10 text-purple-400' :
                      t.plan === 'pro' ? 'bg-brand-400/10 text-brand-400' :
                      'bg-gray-500/10 text-gray-400'
                    }`}>{t.plan}</span>
                    {!t.active && <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-400/10 text-red-400">INACTIVA</span>}
                  </div>
                  <div className="text-gray-400 text-xs mt-1">{t.owner_email || '—'}</div>
                  <div className="text-gray-500 text-[11px] mt-1 font-mono">
                    {t.employees} empleados · {t.branches} sucursales · {t.profiles} usuarios
                  </div>
                  <div className="text-gray-600 text-[10px] font-mono mt-0.5">
                    Creada: {new Date(t.created_at).toLocaleDateString('es-MX')}
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => openDetail(t.id)}
                    className="px-3 py-1.5 text-xs text-brand-400 border border-brand-400/30 rounded-lg hover:bg-brand-400/10">
                    Ver detalle
                  </button>
                  {t.active ? (
                    <button onClick={() => doPatch(t.id, { active: false })}
                      disabled={working === t.id + ':patch'}
                      className="px-3 py-1.5 text-xs text-yellow-400 border border-yellow-400/30 rounded-lg hover:bg-yellow-400/10 disabled:opacity-50">
                      Suspender
                    </button>
                  ) : (
                    <button onClick={() => doPatch(t.id, { active: true })}
                      disabled={working === t.id + ':patch'}
                      className="px-3 py-1.5 text-xs text-emerald-400 border border-emerald-400/30 rounded-lg hover:bg-emerald-400/10 disabled:opacity-50">
                      Reactivar
                    </button>
                  )}
                  <select value={t.plan} onChange={e => doPatch(t.id, { plan: e.target.value })}
                    className="bg-dark-700 border border-dark-border rounded-lg px-2 py-1.5 text-xs text-white focus:border-brand-400 outline-none">
                    <option value="free">Free</option>
                    <option value="pro">Pro</option>
                    <option value="enterprise">Enterprise</option>
                  </select>
                  {t.slug !== 'checkpro-system' && (
                    <button onClick={() => doDelete(t)}
                      disabled={working === t.id + ':delete'}
                      className="px-3 py-1.5 text-xs text-red-400 border border-red-400/30 rounded-lg hover:bg-red-400/10 disabled:opacity-50">
                      Eliminar
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {filtered.length === 0 && (
            <div className="bg-dark-800 border border-dark-border rounded-xl p-8 text-center text-gray-500">
              Sin resultados
            </div>
          )}
        </div>
      )}

      {detail && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setDetail(null)}>
          <div className="bg-dark-800 border border-dark-border rounded-xl p-6 max-w-2xl w-full max-h-[80vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <div className="text-white font-bold">Detalle de empresa</div>
              <button onClick={() => setDetail(null)} className="text-gray-400 text-xl">×</button>
            </div>
            {detail.loading ? <div className="text-gray-400 animate-pulse">Cargando…</div> : (
              <div className="space-y-4">
                <div>
                  <div className="text-white font-semibold">{detail.tenant?.name}</div>
                  <div className="text-gray-400 text-xs font-mono">{detail.tenant?.id}</div>
                </div>
                <Section title="Usuarios" items={detail.profiles || []} render={p => `${p.name} · ${p.role}`} />
                <Section title="Sucursales" items={detail.branches || []} render={b => b.name} />
                <Section title="Empleados" items={detail.employees || []} render={e => `${e.employee_code} ${e.name}`} />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function Section({ title, items, render }) {
  return (
    <div>
      <div className="text-gray-400 text-xs font-mono uppercase mb-1">{title} ({items.length})</div>
      <div className="bg-dark-900 border border-dark-border rounded-lg p-3 space-y-1">
        {items.length === 0 ? (
          <div className="text-gray-600 text-xs italic">Sin registros</div>
        ) : items.map(x => (
          <div key={x.id} className="text-gray-300 text-sm">{render(x)}</div>
        ))}
      </div>
    </div>
  )
}
