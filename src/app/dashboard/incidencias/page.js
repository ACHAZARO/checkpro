'use client'
// src/app/dashboard/incidencias/page.js
// Gestión de incidencias con acciones directas por tipo:
//  - falta: registra la inasistencia (3 opciones) y resuelve la incidencia
//  - otros: resolución con nota breve
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { AlertCircle, CheckCircle2, Plus, Inbox, Lock, X } from 'lucide-react'

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

const ABSENCE_TYPES = [
  {
    value: 'falta_injustificada',
    label: 'Injustificada',
    desc: 'Sin causa válida. No se paga. Cuenta como falta grave (Art. 47 LFT).',
    color: 'red',
  },
  {
    value: 'falta_justificada_pagada',
    label: 'Justificada — con goce de sueldo',
    desc: 'Falta con justificante válido. Se paga el día.',
    color: 'green',
  },
  {
    value: 'falta_justificada_no_pagada',
    label: 'Justificada — sin goce de sueldo',
    desc: 'Falta con justificante pero sin pago del día.',
    color: 'orange',
  },
]

export default function IncidenciasPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [profile, setProfile] = useState(null)
  const [incidencias, setIncidencias] = useState([])
  const [filter, setFilter] = useState('open')
  const [resolvingId, setResolvingId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [resolutionText, setResolutionText] = useState('')
  const [absenceType, setAbsenceType] = useState('falta_injustificada')
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
      setIncidencias([])
      console.warn('[incidencias] select error:', error?.message)
    } else {
      setIncidencias(incs || [])
    }
    setLoading(false)
  }, [router, filter])

  useEffect(() => { load() }, [load])

  function openDetail(inc) {
    setDetail(inc)
    setResolutionText('')
    setAbsenceType('falta_injustificada')
  }

  async function resolveAsAbsence() {
    if (!detail) return
    setResolvingId(detail.id)
    const supabase = createClient()

    const typeLabels = {
      falta_injustificada: 'Falta injustificada',
      falta_justificada_pagada: 'Falta justificada (con goce de sueldo)',
      falta_justificada_no_pagada: 'Falta justificada (sin goce de sueldo)',
    }
    const label = typeLabels[absenceType] || absenceType
    const isGrave = absenceType === 'falta_injustificada'
    const note = resolutionText || label

    // 1) Verificar si ya existe un shift para ese día — evita duplicados
    const { data: existing } = await supabase
      .from('shifts')
      .select('id')
      .eq('tenant_id', detail.tenant_id)
      .eq('employee_id', detail.employee_id)
      .eq('date_str', detail.date_str)
      .maybeSingle()

    if (existing?.id) {
      // Actualizar el shift existente a absent con la clasificación elegida
      const { error: updErr } = await supabase.from('shifts').update({
        status: 'absent',
        classification: { type: absenceType, label },
        incidents: isGrave
          ? [{ type: 'grave', note, ts: new Date().toISOString() }]
          : [],
      }).eq('id', existing.id)
      if (updErr) {
        setResolvingId(null)
        toast.error(`No se pudo actualizar la jornada: ${updErr.message}`)
        return
      }
    } else {
      // Insert nuevo shift de ausencia
      const { error: insErr } = await supabase.from('shifts').insert({
        tenant_id: detail.tenant_id,
        employee_id: detail.employee_id,
        date_str: detail.date_str,
        entry_time: null,
        exit_time: null,
        duration_hours: 0,
        status: 'absent',
        classification: { type: absenceType, label },
        incidents: isGrave
          ? [{ type: 'grave', note, ts: new Date().toISOString() }]
          : [],
        corrections: [],
      })
      if (insErr) {
        setResolvingId(null)
        toast.error(`No se pudo registrar la falta: ${insErr.message}`)
        return
      }
    }

    // 2) Marcar incidencia como resuelta con referencia a la acción tomada
    const { error: resErr } = await supabase
      .from('incidencias')
      .update({
        status: 'resolved',
        resolution: `${label}${resolutionText ? ` · ${resolutionText}` : ''}`,
        resolved_by: profile?.id || null,
        resolved_by_name: profile?.name || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', detail.id)

    // 3) Audit log
    await supabase.from('audit_log').insert({
      tenant_id: detail.tenant_id,
      action: 'ABSENCE',
      employee_id: detail.employee_id,
      employee_name: detail.employee_name,
      detail: `${label} · ${detail.date_str}${resolutionText ? ' · ' + resolutionText : ''}`,
      success: true,
    })

    setResolvingId(null)
    if (resErr) {
      toast.error(`Falta registrada pero no se cerró la incidencia: ${resErr.message}`)
    } else {
      toast.success('Falta registrada y resuelta')
    }
    setDetail(null)
    setResolutionText('')
    load()
  }

  async function resolveGeneric() {
    if (!detail) return
    if (!resolutionText.trim()) {
      toast.error('Agrega una nota breve de resolución')
      return
    }
    setResolvingId(detail.id)
    const supabase = createClient()
    const { error } = await supabase
      .from('incidencias')
      .update({
        status: 'resolved',
        resolution: resolutionText,
        resolved_by: profile?.id || null,
        resolved_by_name: profile?.name || null,
        resolved_at: new Date().toISOString(),
      })
      .eq('id', detail.id)
    setResolvingId(null)
    if (error) { toast.error(`No se pudo resolver: ${error.message}`); return }
    toast.success('Incidencia resuelta')
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
  const isFalta = detail?.kind === 'falta'

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto">
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="page-title">Incidencias</h1>
          <p className="text-gray-400 text-xs font-mono mt-0.5 flex items-center gap-1.5">
            {openCount > 0 ? (
              <span className="text-red-400 inline-flex items-center gap-1.5">
                <Lock size={12} /> {openCount} abierta{openCount !== 1 ? 's' : ''} · bloquean el corte
              </span>
            ) : (
              <span className="text-brand-400 inline-flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Sin incidencias pendientes
              </span>
            )}
          </p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-400 text-black font-bold rounded-lg text-xs active:brightness-90">
          <Plus size={14} /> Nueva incidencia
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
          <div className="flex justify-center mb-3 text-gray-400">
            {filter === 'open' ? <CheckCircle2 size={40} /> : <Inbox size={40} />}
          </div>
          <p className="text-gray-200 text-sm font-semibold">
            {filter === 'open' ? 'Ninguna incidencia abierta' : 'Sin incidencias'}
          </p>
          <p className="text-gray-400 text-xs mt-2">
            Las incidencias detectadas automáticamente y las creadas manualmente aparecen aquí.
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
                  <span className="text-gray-400 text-[11px] font-mono">· {inc.date_str}</span>
                </div>
                {inc.description && <p className="text-gray-300 text-xs leading-snug">{inc.description}</p>}
                {inc.status !== 'open' && inc.resolution && (
                  <p className="text-gray-400 text-[11px] font-mono mt-1 inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> {inc.resolution}{inc.resolved_by_name ? ` · ${inc.resolved_by_name}` : ''}
                  </p>
                )}
              </div>
              {inc.status === 'open' && (
                <button onClick={() => openDetail(inc)}
                  className="px-3 py-1.5 bg-brand-400 text-black font-bold rounded-lg text-xs active:brightness-90">
                  Gestionar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal detalle — con scroll correcto */}
      {detail && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-dark-800 border border-dark-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col"
               style={{ maxHeight: '90dvh' }}>
            <div className="px-5 pt-4 pb-2 flex items-start justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white">{KIND_LABEL[detail.kind] || detail.kind}</h2>
                <p className="text-gray-400 text-xs font-mono mt-0.5">
                  {detail.employee_name || '—'} · {detail.date_str}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white hover:bg-white/10 rounded-md p-1 -mt-1 -mr-1 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pb-4 overflow-y-auto flex-1" style={{ touchAction: 'pan-y' }}>
              {detail.description && (
                <p className="text-gray-300 text-sm mb-3 bg-dark-700 p-3 rounded-lg">{detail.description}</p>
              )}

              {isFalta ? (
                <>
                  <p className="label mb-2">Tipo de falta</p>
                  <div className="space-y-2 mb-3">
                    {ABSENCE_TYPES.map(opt => (
                      <label key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                          ${absenceType === opt.value
                            ? opt.color === 'red' ? 'bg-red-500/10 border-red-500/30'
                              : opt.color === 'green' ? 'bg-green-500/10 border-green-500/30'
                              : 'bg-orange-500/10 border-orange-500/30'
                            : 'bg-dark-700 border-dark-border'
                          }`}>
                        <input type="radio" name="absenceType" value={opt.value}
                          checked={absenceType === opt.value}
                          onChange={() => setAbsenceType(opt.value)}
                          className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm text-white font-semibold">{opt.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                  {absenceType === 'falta_injustificada' && (
                    <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl inline-flex items-start gap-2">
                      <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={14} />
                      <div>
                        <p className="text-red-400 text-xs font-bold">Falta grave</p>
                        <p className="text-red-400/70 text-xs mt-0.5">A las 3 faltas graves acumuladas se genera una alerta automática (causal Art. 47 LFT).</p>
                      </div>
                    </div>
                  )}
                </>
              ) : null}

              <div className="mb-3">
                <label className="label">Nota {isFalta ? '(opcional)' : '(obligatoria)'}</label>
                <textarea className="input text-sm min-h-[60px]"
                  placeholder={isFalta ? 'Ej. justificante médico, aviso previo, etc.' : 'Describe la resolución'}
                  value={resolutionText}
                  onChange={e => setResolutionText(e.target.value)} />
              </div>
            </div>

            <div className="px-5 pb-5 pt-2 border-t border-dark-border shrink-0 flex gap-2">
              {isFalta ? (
                <button onClick={resolveAsAbsence}
                  disabled={resolvingId === detail.id}
                  className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90 disabled:opacity-50">
                  {resolvingId === detail.id ? 'Guardando...' : 'Registrar falta'}
                </button>
              ) : (
                <button onClick={resolveGeneric}
                  disabled={resolvingId === detail.id || !resolutionText.trim()}
                  className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90 disabled:opacity-50">
                  {resolvingId === detail.id ? 'Guardando...' : 'Marcar resuelta'}
                </button>
              )}
              <button onClick={() => setDetail(null)}
                className="px-3 py-2.5 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva */}
      {showNew && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
          <div className="bg-dark-800 border border-dark-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col"
               style={{ maxHeight: '90dvh' }}>
            <div className="px-5 pt-4 pb-2 flex items-start justify-between shrink-0">
              <h2 className="text-lg font-bold text-white">Nueva incidencia</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-white hover:bg-white/10 rounded-md p-1 -mt-1 -mr-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 pb-4 overflow-y-auto flex-1 space-y-3" style={{ touchAction: 'pan-y' }}>
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
                  placeholder="Detalle breve"
                  value={newForm.description}
                  onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="px-5 pb-5 pt-2 border-t border-dark-border shrink-0 flex gap-2">
              <button onClick={createIncidencia}
                className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90">
                Guardar
              </button>
              <button onClick={() => setShowNew(false)}
                className="px-3 py-2.5 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
