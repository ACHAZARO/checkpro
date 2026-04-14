'use client'
// src/app/dashboard/attendance/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { fmtTime, fmtDate, isoDate, weekRange } from '@/lib/utils'
import toast from 'react-hot-toast'

function ShiftBadge({ status, classification }) {
  if (status === 'open') return <span className="badge-blue">Abierta</span>
  if (status === 'incident') return <span className="badge-red">Incidencia</span>
  const t = classification?.type
  if (t === 'retardo') return <span className="badge-orange">Retardo</span>
  if (t === 'tolerancia') return <span className="badge-orange">Tolerancia</span>
  return <span className="badge-green">Completa</span>
}

export default function AttendancePage() {
  const [shifts, setShifts] = useState([])
  const [emps, setEmps] = useState([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  const [filterEmp, setFilterEmp] = useState('all')
  const [filterStatus, setFilterStatus] = useState('all')
  const [filterBranch, setFilterBranch] = useState('all')
  const [branches, setBranches] = useState([])
  const [filterFrom, setFilterFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return isoDate(d)
  })
  const [filterTo, setFilterTo] = useState(isoDate(new Date()))
  const [corrSheet, setCorrSheet] = useState(null)
  const [flagSheet, setFlagSheet] = useState(null)
  const [corrForm, setCorrForm] = useState({})
  const [flagForm, setFlagForm] = useState({ type: 'olvido_salida', note: '' })
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)

    const [{ data: empData }, { data: shiftData }, { data: tenantData }] = await Promise.all([
      supabase.from('employees').select('id,name,department,monthly_salary,schedule').eq('tenant_id', prof.tenant_id).neq('status','deleted'),
      supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).gte('date_str', filterFrom).lte('date_str', filterTo).order('date_str', { ascending: false }).order('entry_time', { ascending: false }),
      supabase.from('tenants').select('config').eq('id', prof.tenant_id).single()
    ])
    setEmps(empData || [])
    setShifts(shiftData || [])
    setBranches(tenantData?.config?.branches || [])
    setLoading(false)
  }, [filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  // Build a map of employeeId → branchId for quick lookup
  const empBranchMap = Object.fromEntries(emps.map(e => [e.id, e.schedule?.branch?.id || null]))

  const filtered = shifts.filter(s => {
    if (filterEmp !== 'all' && s.employee_id !== filterEmp) return false
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (filterBranch !== 'all' && empBranchMap[s.employee_id] !== filterBranch) return false
    return true
  })

  const getEmpName = id => emps.find(e => e.id === id)?.name || id

  async function saveCorr() {
    if (!corrForm.note) { toast.error('El motivo es obligatorio'); return }
    setSaving(true)
    const supabase = createClient()
    const entryTime = corrForm.entryTime ? new Date(corrForm.entryTime).toISOString() : corrSheet.entry_time
    const exitTime  = corrForm.exitTime  ? new Date(corrForm.exitTime).toISOString()  : corrSheet.exit_time
    const duration  = entryTime && exitTime ? parseFloat(((new Date(exitTime)-new Date(entryTime))/3600000).toFixed(2)) : corrSheet.duration_hours
    const corrections = [...(corrSheet.corrections || []), { ts: new Date().toISOString(), note: corrForm.note, entryTime, exitTime }]
    await supabase.from('shifts').update({ entry_time: entryTime, exit_time: exitTime, duration_hours: duration, status: exitTime ? 'closed' : corrSheet.status, corrections }).eq('id', corrSheet.id)
    await supabase.from('audit_log').insert({ tenant_id: tenantId, action: 'CORRECTION', employee_name: getEmpName(corrSheet.employee_id), detail: corrForm.note, success: true })
    toast.success('Corrección guardada')
    setSaving(false); setCorrSheet(null); await load()
  }

  async function saveFlag() {
    setSaving(true)
    const supabase = createClient()
    const incidents = [...(flagSheet.incidents || []), { id: crypto.randomUUID(), ts: new Date().toISOString(), type: flagForm.type, note: flagForm.note }]
    await supabase.from('shifts').update({ status: 'incident', incidents }).eq('id', flagSheet.id)
    await supabase.from('audit_log').insert({ tenant_id: tenantId, action: 'INCIDENT', employee_name: getEmpName(flagSheet.employee_id), detail: flagForm.type, success: true })
    toast.success('Incidencia registrada')
    setSaving(false); setFlagSheet(null); await load()
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Asistencia</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">HISTORIAL DE JORNADAS</p>
      </div>

      {/* Filters */}
      <div className="card mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Desde</label><input className="input text-sm py-2" type="date" value={filterFrom} onChange={e=>setFilterFrom(e.target.value)}/></div>
          <div><label className="label">Hasta</label><input className="input text-sm py-2" type="date" value={filterTo} onChange={e=>setFilterTo(e.target.value)}/></div>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Empleado</label>
            <select className="input text-sm py-2" value={filterEmp} onChange={e=>setFilterEmp(e.target.value)}>
              <option value="all">Todos</option>
              {emps.map(e=><option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Estatus</label>
            <select className="input text-sm py-2" value={filterStatus} onChange={e=>setFilterStatus(e.target.value)}>
              <option value="all">Todos</option>
              <option value="open">Abiertas</option>
              <option value="closed">Cerradas</option>
              <option value="incident">Incidencias</option>
            </select>
          </div>
        </div>
        {branches.length > 0 && (
          <div>
            <label className="label">Sucursal</label>
            <select className="input text-sm py-2" value={filterBranch} onChange={e=>setFilterBranch(e.target.value)}>
              <option value="all">Todas las sucursales</option>
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
        <button onClick={load} className="w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-sm font-semibold text-white active:bg-dark-600">
          🔍 Buscar
        </button>
      </div>

      {loading ? <p className="text-gray-500 font-mono text-sm">Cargando...</p> : (
        <>
          <p className="text-xs text-gray-600 font-mono mb-3">{filtered.length} registro(s)</p>
          <div className="space-y-2">
            {filtered.length === 0 && <div className="card text-center py-10 text-gray-500 font-mono text-sm">Sin registros en este período</div>}
            {filtered.map(s => (
              <div key={s.id} className={`card-sm ${s.status==='incident'?'border-red-500/20':''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-white">{getEmpName(s.employee_id)}</span>
                      <ShiftBadge status={s.status} classification={s.classification} />
                      {s.is_holiday && <span className="badge-orange text-[9px]">FERIADO ×3</span>}
                    </div>
                    <div className="text-xs text-gray-500 font-mono mt-1">
                      {s.date_str} · {fmtTime(s.entry_time)} – {s.exit_time ? fmtTime(s.exit_time) : '—'}
                      {s.duration_hours ? ` · ${s.duration_hours}h` : ''}
                    </div>
                    {s.classification?.label && (
                      <div className="text-xs text-gray-600 mt-0.5">{s.classification.label}</div>
                    )}
                    {s.covering_employee_id && (
                      <div className="text-xs text-blue-400 font-mono mt-0.5">Cubriendo: {getEmpName(s.covering_employee_id)}</div>
                    )}
                    {(() => {
                      const bid = empBranchMap[s.employee_id]
                      const bn = bid ? branches.find(b => b.id === bid)?.name : null
                      return bn ? <div className="text-[10px] text-gray-600 font-mono mt-0.5">🏢 {bn}</div> : null
                    })()}
                    {s.corrections?.overtime?.hours > 0 && (
                      <div className="text-[10px] text-blue-400 font-mono mt-0.5">⏰ {s.corrections.overtime.hours}h extra</div>
                    )}
                    {s.incidents?.length > 0 && s.incidents.map((inc,i) => (
                      <div key={i} className="text-xs text-red-400 mt-1">🚩 {inc.type} — {inc.note}</div>
                    ))}
                    {s.corrections?.length > 0 && (
                      <div className="text-xs text-yellow-500 mt-0.5">✏️ {s.corrections.length} corrección(es)</div>
                    )}
                  </div>
                  <div className="flex gap-1.5 shrink-0">
                    <button onClick={() => { setCorrSheet(s); setCorrForm({ entryTime: s.entry_time?.slice(0,16), exitTime: s.exit_time?.slice(0,16)||'', note: '' }) }}
                      className="p-2 bg-dark-700 border border-dark-border rounded-lg text-xs text-gray-400 active:bg-dark-600">✏️</button>
                    {s.status === 'open' && (
                      <button onClick={() => { setFlagSheet(s); setFlagForm({ type:'olvido_salida', note:'' }) }}
                        className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 active:bg-red-500/20">🚩</button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {/* Correction sheet */}
      {corrSheet && (
        <div className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end" style={{touchAction:'none'}}>
          <div className="bg-dark-800 rounded-t-2xl overflow-y-scroll no-scrollbar" style={{height:'75vh',touchAction:'pan-y'}}>
            <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-4"/>
            <div className="px-5 pb-10">
              <h3 className="text-lg font-bold text-white mb-1">Corrección de Jornada</h3>
              <p className="text-xs text-gray-500 font-mono mb-4">{getEmpName(corrSheet.employee_id)} · {corrSheet.date_str}</p>
              <div className="bg-yellow-500/10 border border-yellow-500/20 rounded-xl px-4 py-3 text-yellow-400 text-xs font-semibold mb-4">
                ⚠ Esta acción quedará registrada en auditoría.
              </div>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div><label className="label">Hora entrada</label><input className="input text-sm" type="datetime-local" value={corrForm.entryTime||''} onChange={e=>setCorrForm(f=>({...f,entryTime:e.target.value}))}/></div>
                <div><label className="label">Hora salida</label><input className="input text-sm" type="datetime-local" value={corrForm.exitTime||''} onChange={e=>setCorrForm(f=>({...f,exitTime:e.target.value}))}/></div>
              </div>
              <div className="mb-4"><label className="label">Motivo (obligatorio)</label><input className="input" placeholder="Describe el motivo..." value={corrForm.note||''} onChange={e=>setCorrForm(f=>({...f,note:e.target.value}))}/></div>
              <div className="flex gap-2">
                <button onClick={saveCorr} disabled={saving||!corrForm.note} className="btn-primary">{saving?'Guardando...':'Guardar corrección'}</button>
                <button onClick={()=>setCorrSheet(null)} className="btn-ghost">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Flag incident sheet */}
      {flagSheet && (
        <div className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end" style={{touchAction:'none'}}>
          <div className="bg-dark-800 rounded-t-2xl overflow-y-scroll no-scrollbar" style={{height:'65vh',touchAction:'pan-y'}}>
            <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-4"/>
            <div className="px-5 pb-10">
              <h3 className="text-lg font-bold text-white mb-1">Marcar Incidencia</h3>
              <p className="text-xs text-gray-500 font-mono mb-4">{getEmpName(flagSheet.employee_id)} · entrada {fmtTime(flagSheet.entry_time)}</p>
              <div className="mb-3"><label className="label">Tipo</label>
                <select className="input" value={flagForm.type} onChange={e=>setFlagForm(f=>({...f,type:e.target.value}))}>
                  <option value="olvido_salida">Olvido de salida</option>
                  <option value="salida_anticipada">Salida anticipada</option>
                  <option value="jornada_incompleta">Jornada incompleta</option>
                  <option value="otra">Otra</option>
                </select>
              </div>
              <div className="mb-4"><label className="label">Nota</label><input className="input" placeholder="Descripción..." value={flagForm.note||''} onChange={e=>setFlagForm(f=>({...f,note:e.target.value}))}/></div>
              <div className="flex gap-2">
                <button onClick={saveFlag} disabled={saving} className="btn-danger">{saving?'Guardando...':'Registrar incidencia'}</button>
                <button onClick={()=>setFlagSheet(null)} className="btn-ghost">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
