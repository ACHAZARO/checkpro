'use client'
// src/app/dashboard/incidencias/page.js
// feat/gerente-libre-candados — Pestaña Incidencias: listado, detalle, resolución.
// Candado: todas las incidencias deben estar 'resolved' o 'ignored' antes de cortar.
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'

const KIND_LABEL = {
  falta: 'Falta',
  retardo_justificado: 'Retardo justificado',
  permiso: 'Permiso',
  device_mismatch: 'Dispositivo diferente',
  ip_mismatch: 'Red diferente',
  no_planificado: 'Sin plan (mixto)',
  otro: 'Otro',
}

const KIND_COLOR = {
  falta: 'bg-red-500/10 border-red-500/30 text-red-300',
  retardo_justificado: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  permiso: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  device_mismatch: 'bg-purple-500/10 border-purple-500/30 text-purple-300',
  ip_mismatch: 'bg-purple-500/10 border-purple-500/30 text-purple-300',
  no_planificado: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  otro: 'bg-gray-500/10 border-gray-500/30 text-gray-300',
}

export default function IncidenciasPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [incidencias, setIncidencias] = useState([])
  const [filter, setFilter] = useState('open') // open | resolved | all
  const [resolvingId, setResolvingId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [resolutionText, setResolutionText] = useState('')
  // Creación manual
  const [showNew, setShowNew] = useState(false)
  const [employees, setEmployees] = useState([])
  const [newForm, setNewForm] = useState({ employee_id: '', date_str: '', kind: 'falta', description: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (!prof?.tenant_id) { router.push('/onboarding'); return }
    setProfile(prof)

    const { data: emps } = await supabase
      .from('employees')
      .select('id, name, employee_code, branch_id')
      .eq('tenant_id', prof.tenant_id)
      .eq('status', 'active')
      .order('name')
    setEmployees(emps || [])

    let q = supabase
      .from('incidencias')
      .select('*')
      .eq('tenant_id', prof.tenant_id)
      .order('date_str', { ascending: false })
      .order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter === 'resolved' ? 'resolved' : 'open')
    const { data: incs, error } = await q
    if (error) {
      // si la tabla aún no está migrada, mostrar estado vacío amigable
      setIncidencias([])
      console.warn('[incidencias] select error:', error?.message)
    } else {
      setIncidencias(incs || [])
    }
    setLoading(false)
  }, [router, filter])

  useEffect(() => { load() }, [load])

  async function resolveIncidencia(id, action) {
    setResolvingId(id)
    const supabase = createClient()
    const newStatus = action === 'resolve' ? 'resolved' : 'ignored'
    const { error } = await supabase
      .from('incidencias')
      .update({
        status: newStatus,
        resolution: resolutionText || (action === 'resolve' ? 'Resuelta por gerente' : 'Ignorada por gerente'),
        resolved_by: profile?.id || null,
        resolved_by_name: profile?.name || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', id)
    setResolvingId(null)
    if (error) { toast.error(`No se pudo resolver: ${error.message}`); return }
    toast.success(action === 'resolve' ? 'Incidencia resuelta ✓' : 'Incidencia ignorada')
    setDetail(null)
    setResolutionText('')
    load()
  }

  async function createIncidencia() {
    if (!newForm.employee_id || !newForm.date_str || !newForm.kind) {
      toast.error('Empleado, fecha y tipo son obligatorios')
      return
    }
    const emp = employees.find(e => e.id === newForm.employee_id)
    const supabase = createClient()
    const { error } = await supabase.from('incidencias').insert({
      tenant_id: profile.tenant_id,
      branch_id: emp?.branch_id || null,
      employee_id: emp?.id || null,
      employee_name: emp?.name || 'Sin empleado',
      date_str: newForm.date_str,
      kind: newForm.kind,
      description: newForm.description || null,
      status: 'open',
    })
    if (error) { toast.error(`Error: ${error.message}`); return }
    toast.success('Incidencia creada')
    setShowNew(false)
    setNewForm({ employee_id: '', date_str: '', kind: 'falta', description: '' })
    load()
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando incidencias...</div>

  const openCount = incidencias.filter(i => i.status === 'open').length

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Incidencias</h1>
          <p className="text-gray-500 text-xs font-mono mt-0.5">
            {openCount > 0 ? <span className="text-red-400">🔒 {openCount} abierta(s) · bloquean el corte</span> : <span className="text-brand-400">✓ Sin incidencias pendientes</span>}
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="px-3 py-2 bg-brand-400 text-black font-bold rounded-lg text-xs active:brightness-90">
          + Nueva incidencia
        </button>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { k: 'open', label: `Abiertas (${openCount})` },
          { k: 'resolved', label: 'Resueltas' },
          { k: 'all', label: 'Todas' },
        ].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === t.k
                ? 'bg-brand-400 text-black'
                : 'bg-dark-700 border border-dark-border text-gray-400 hover:text-white'
            }`}>{t.label}</button>
        ))}
      </div>

      {incidencias.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-3">{filter === 'open' ? '✅' : '📭'}</div>
          <p className="text-gray-300 text-sm font-semibold">
            {filter === 'open' ? 'Ninguna incidencia abierta' : 'Sin incidencias'}
          </p>
          <p className="text-gray-500 text-xs mt-2">
            Las incidencias detectadas automáticamente (dispositivo diferente, sin plan, etc.) y las creadas manualmente aparecerán aquí.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {incidencias.map(inc => (
            <div key={inc.id} className="card p-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${KIND_COLOR[inc.kind] || KIND_COLOR.otro}`}>
                    {KIND_LABEL[inc.kind] || inc.kind}
                  </span>
                  <span className="text-white font-semibold text-sm">{inc.employee_name || '—'}</span>
                  <span className="text-gray-500 text-[11px] font-mono">· {inc.date_str}</span>
                </div>
                {inc.description && <p className="text-gray-400 text-xs leading-snug">{inc.description}</p>}
                {inc.status !== 'open' && inc.resolution && (
                  <p className="text-gray-600 text-[11px] font-mono mt-1">
                    {inc.status === 'resolved' ? '✓' : '✗'} {inc.resolution}{inc.resolved_by_name ? ` · ${inc.resolved_by_name}` : ''}
                  </p>
                )}
              </div>
              {inc.status === 'open' && (
                <button onClick={() => { setDetail(inc); setResolutionText('') }}
                  className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-xs hover:bg-dark-600">
                  Revisar →
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal detalle */}
      {detail && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-md w-full">
            <h2 className="text-lg font-bold text-white mb-1">{KIND_LABEL[detail.kind] || detail.kind}</h2>
            <p className="text-gray-500 text-xs font-mono mb-3">
              {detail.employee_name || '—'} · {detail.date_str}
            </p>
            {detail.description && (
              <p className="text-gray-300 text-sm mb-3 bg-dark-700 p-3 rounded-lg">{detail.description}</p>
            )}
            <div className="mb-3">
              <label className="label">Resolución / nota (opcional)</label>
              <textarea className="input text-sm min-h-[60px]"
                placeholder="Ej. Se aplicó descuento, se justificó por cita médica, etc."
                value={resolutionText}
                onChange={e => setResolutionText(e.target.value)} />
            </div>
            <div className="flex gap-2 flex-wrap">
              <button onClick={() => resolveIncidencia(detail.id, 'resolve')}
                disabled={resolvingId === detail.id}
                className="flex-1 px-3 py-2 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90 disabled:opacity-50">
                ✓ Marcar resuelta
              </button>
              <button onClick={() => resolveIncidencia(detail.id, 'ignore')}
                disabled={resolvingId === detail.id}
                className="px-3 py-2 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-sm">
                Ignorar
              </button>
              <button onClick={() => setDetail(null)}
                className="px-3 py-2 text-gray-500 text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva */}
      {showNew && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="card max-w-md w-full">
            <h2 className="text-lg font-bold text-white mb-3">Nueva incidencia</h2>
            <div className="space-y-3">
              <div>
                <label className="label">Empleado</label>
                <select className="input text-sm"
                  value={newForm.employee_id}
                  onChange={e => setNewForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Seleccionar —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name} · {e.employee_code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input text-sm"
                  value={newForm.date_str}
                  onChange={e => setNewForm(f => ({ ...f, date_str: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tipo</label>
                <select className="input text-sm"
                  value={newForm.kind}
                  onChange={e => setNewForm(f => ({ ...f, kind: e.target.value }))}>
                  <option value="falta">Falta</option>
                  <option value="retardo_justificado">Retardo justificado</option>
                  <option value="permiso">Permiso</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="label">Descripción</label>
                <textarea className="input text-sm min-h-[60px]"
                  placeholder="Detalle breve de la incidencia"
                  value={newForm.description}
                  onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={createIncidencia}
                className="flex-1 px-3 py-2 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90">
                Guardar
              </button>
              <button onClick={() => setShowNew(false)}
                className="px-3 py-2 text-gray-500 text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
