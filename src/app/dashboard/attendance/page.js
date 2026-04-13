'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { fmtTime, isoDate } from '@/lib/utils'

export default function AttendancePage() {
  const [shifts, setShifts] = useState([])
  const [emps, setEmps] = useState([])
  const [loading, setLoading] = useState(true)
  const [from, setFrom] = useState(()=>{const d=new Date();d.setDate(d.getDate()-7);return isoDate(d)})
  const [to, setTo] = useState(isoDate(new Date()))

  async function load() {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    const [{ data: empData }, { data: shiftData }] = await Promise.all([
      supabase.from('employees').select('id,name').eq('tenant_id', prof.tenant_id).neq('status','deleted'),
      supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).gte('date_str',from).lte('date_str',to).order('date_str',{ascending:false}),
    ])
    setEmps(empData||[]); setShifts(shiftData||[]); setLoading(false)
  }

  useEffect(()=>{load()}, [])
  const getN = id => emps.find(e=>e.id===id)?.name||id

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5"><h1 className="text-2xl font-extrabold text-white">Asistencia</h1><p className="text-gray-500 text-xs font-mono mt-0.5">HISTORIAL DE JORNADAS</p></div>
      <div className="card mb-4 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Desde</label><input className="input text-sm py-2" type="date" value={from} onChange={e=>setFrom(e.target.value)}/></div>
          <div><label className="label">Hasta</label><input className="input text-sm py-2" type="date" value={to} onChange={e=>setTo(e.target.value)}/></div>
        </div>
        <button onClick={load} className="w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-sm font-semibold text-white">🔍 Buscar</button>
      </div>
      {loading ? <p className="text-gray-500 font-mono text-sm">Cargando...</p> : (
        <div className="space-y-2">
          {shifts.length === 0 && <div className="card text-center py-10 text-gray-500 font-mono text-sm">Sin registros en este período</div>}
          {shifts.map(s => (
            <div key={s.id} className={`card-sm ${s.status==='incident'?'border-red-500/20':''}`}>
              <div className="flex items-center gap-2 flex-wrap"><span className="font-bold text-sm text-white">{getN(ss.employee_id)}</span><span className={`badge-${s.status==='open'?'blue':s.status==='incident'?'red';'green'}`}>{s.status==='open'?'Abierta':s.status==='incident'?'Incidencia':'Completa'}</span></div>
              <div className="text-xs text-gray-500 font-mono mt-1">{s.date_str} · {fmtTime(s.entry_time)} – {s.exit_time?fmtTime(s.exit_time):'—'}{s.duration_hours?` · ${s.duration_hours}h`:''}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
