'use client'
// src/app/superadmin/users/page.js
// All users across all tenants. Search + actions (disable/enable/reset/confirm/delete/role).
import { useState, useEffect, useMemo } from 'react'
import toast from 'react-hot-toast'

export default function SuperAdminUsersPage() {
  const [users, setUsers] = useState([])
  const [loading, setLoading] = useState(true)
  const [q, setQ] = useState('')
  const [working, setWorking] = useState(null)

  async function load() {
    setLoading(true)
    const r = await fetch('/api/admin/users')
    const data = await r.json()
    if (r.ok) setUsers(data.users || [])
    else toast.error(data.error || 'Error al cargar')
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = useMemo(() => {
    if (!q.trim()) return users
    const t = q.toLowerCase()
    return users.filter(u =>
      (u.email || '').toLowerCase().includes(t)
      || (u.name || '').toLowerCase().includes(t)
      || (u.tenantName || '').toLowerCase().includes(t)
    )
  }, [users, q])

  async function doAction(id, action, extra = {}) {
    // FIX: acciones sensibles requieren confirmacion explicita en UI.
    if (action === 'disable' && !confirm('Suspender este usuario impedira su acceso. Continuar?')) return
    if (action === 'set_role' && !confirm(`Cambiar rol a ${extra.role}. Esta accion quedara auditada. Continuar?`)) return
    setWorking(id + ':' + action)
    try {
      const r = await fetch(`/api/admin/users/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra })
      })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      toast.success('Listo')
      await load()
    } catch (e) {
      toast.error(e.message || 'Error')
    } finally {
      setWorking(null)
    }
  }

  async function doDelete(u) {
    // FIX: borrado destructivo con confirmacion explicita.
    if (!confirm(`¿Eliminar cuenta de ${u.email}? Esto borra su acceso permanentemente.`)) return
    setWorking(u.id + ':delete')
    try {
      const r = await fetch(`/api/admin/users/${u.id}`, { method: 'DELETE' })
      const data = await r.json()
      if (!r.ok) throw new Error(data.error)
      toast.success('Usuario eliminado')
      await load()
    } catch (e) { toast.error(e.message || 'Error') } finally { setWorking(null) }
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-5">
        <h1 className="text-white text-2xl font-bold">Usuarios</h1>
        <p className="text-gray-400 text-sm mt-1">Todas las cuentas admin registradas en la plataforma.</p>
      </div>

      <div className="mb-4 flex gap-2 items-center">
        <input type="search" value={q} onChange={e => setQ(e.target.value)}
          placeholder="Buscar por correo, nombre o empresa…"
          className="flex-1 bg-dark-800 border border-dark-border rounded-lg px-3 py-2 text-sm text-white focus:border-brand-400 outline-none" />
        <button onClick={load}
          className="px-3 py-2 text-xs font-mono text-gray-400 border border-dark-border rounded-lg hover:bg-dark-700 hover:text-white">
          ↻ Refrescar
        </button>
      </div>

      {loading ? (
        <div className="text-gray-400 text-sm animate-pulse font-mono">Cargando…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-dark-800 border border-dark-border rounded-xl p-8 text-center text-gray-500">
          Sin resultados
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(u => <UserRow key={u.id} user={u} onAction={doAction} onDelete={doDelete} working={working} />)}
        </div>
      )}
    </div>
  )
}

function UserRow({ user, onAction, onDelete, working }) {
  const [expanded, setExpanded] = useState(false)
  const busy = (action) => working === user.id + ':' + action

  const roleColor = user.role === 'super_admin' ? 'text-red-400 bg-red-400/10'
    : user.role === 'owner' ? 'text-brand-400 bg-brand-400/10'
    : 'text-indigo-400 bg-indigo-400/10'

  return (
    <div className={`bg-dark-800 border rounded-xl p-4 ${user.banned ? 'border-red-500/40' : 'border-dark-border'}`}>
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-white font-semibold text-sm">{user.name || '—'}</span>
            <span className={`px-2 py-0.5 rounded text-[10px] font-mono uppercase ${roleColor}`}>
              {user.role}
            </span>
            {user.banned && <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-red-400/10 text-red-400">SUSPENDIDO</span>}
            {!user.emailConfirmed && <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-yellow-400/10 text-yellow-400">SIN CONFIRMAR</span>}
          </div>
          <div className="text-gray-300 text-sm mt-1">{user.email || <span className="text-gray-500 italic">sin correo</span>}</div>
          <div className="text-gray-500 text-xs mt-0.5">
            {user.tenantName} {user.branchName ? `· ${user.branchName}` : ''}
          </div>
          {user.lastSignInAt && (
            <div className="text-gray-600 text-[10px] font-mono mt-0.5">
              Último acceso: {new Date(user.lastSignInAt).toLocaleString('es-MX')}
            </div>
          )}
        </div>
        <button onClick={() => setExpanded(!expanded)}
          className="px-3 py-1.5 text-xs text-brand-400 border border-brand-400/30 rounded-lg hover:bg-brand-400/10">
          {expanded ? 'Cerrar' : 'Acciones'}
        </button>
      </div>

      {expanded && (
        <div className="mt-4 pt-4 border-t border-dark-border flex flex-wrap gap-2">
          <ActionBtn onClick={() => onAction(user.id, 'reset_password')} disabled={busy('reset_password')} color="brand">
            ✉️ Enviar reset contraseña
          </ActionBtn>
          {!user.emailConfirmed && (
            <ActionBtn onClick={() => onAction(user.id, 'confirm_email')} disabled={busy('confirm_email')} color="emerald">
              ✅ Confirmar correo
            </ActionBtn>
          )}
          {user.banned ? (
            <ActionBtn onClick={() => onAction(user.id, 'enable')} disabled={busy('enable')} color="emerald">
              ▶ Reactivar
            </ActionBtn>
          ) : (
            <ActionBtn onClick={() => onAction(user.id, 'disable')} disabled={busy('disable')} color="yellow">
              ⏸ Suspender
            </ActionBtn>
          )}
          {user.role !== 'super_admin' && (
            <ActionBtn onClick={() => onDelete(user)} disabled={busy('delete')} color="red">
              🗑 Eliminar cuenta
            </ActionBtn>
          )}
          {user.role === 'manager' && (
            <ActionBtn onClick={() => onAction(user.id, 'set_role', { role: 'owner' })} disabled={busy('set_role')} color="brand">
              ⬆ Hacer propietario
            </ActionBtn>
          )}
          {user.role === 'owner' && (
            <ActionBtn onClick={() => onAction(user.id, 'set_role', { role: 'manager' })} disabled={busy('set_role')} color="indigo">
              ⬇ Pasar a gerente
            </ActionBtn>
          )}
        </div>
      )}
    </div>
  )
}

function ActionBtn({ children, onClick, disabled, color }) {
  const colors = {
    brand: 'text-brand-400 border-brand-400/30 hover:bg-brand-400/10',
    emerald: 'text-emerald-400 border-emerald-400/30 hover:bg-emerald-400/10',
    red: 'text-red-400 border-red-400/30 hover:bg-red-400/10',
    yellow: 'text-yellow-400 border-yellow-400/30 hover:bg-yellow-400/10',
    indigo: 'text-indigo-400 border-indigo-400/30 hover:bg-indigo-400/10'
  }
  return (
    <button onClick={onClick} disabled={disabled}
      className={`px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors disabled:opacity-50 ${colors[color] || colors.brand}`}>
      {disabled ? '…' : children}
    </button>
  )
}
