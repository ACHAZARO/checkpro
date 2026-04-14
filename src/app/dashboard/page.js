'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { fmtTime, isoDate, diffMin } from '@/lib/utils'
import Link from 'next/link'

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const now = new Date()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
      if (!profile?.tenant_id) return
      const [{ data: emps }, { data: shifts }, { data: incs }] = await Promise.all([
        supabase.from('employees').select('*').eq('tenant_id', profile.tenant_id).eq('status', 'active').eq('has_shift', true),
        supabase.from('shifts').select('*').eq('tenant_id', profile.tenant_id).eq('date_str', isoDate(now)),
        supabase.from('shifts').select('id,employee_id').eq('tenant_id', profile.tenant_id).eq('status', 'incident'),
      ])
      setData({ employees: emps||[], todayShifts: shifts||[], incidents: incs||[] })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>
  if (!data) return null
  const { employees, todayShifts, incidents } = data
  const checkedIn = employees.filter(e => todayShifts.some(s => s.employee_id === e.id))
  const notYet = employees.filter(e => !todayShifts.some(s => s.employee_id === e.id))
  const activeNow = todayShifts.filter(s => s.status === 'open')
  const getN = id => employees.find(e=>e.id===id)?.name || id

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Hoy</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">{low.getDay() && now.toLocaleDateString('es-MX',{weekday:'long',day:'2-digit',month:'long'}).toUpperCase()}</p>
      </div>
      {incidents.length > 0 && <Link href="/dashboard/attendance" className="flex items-center gap-3 px-4 py-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-semibold">🚩 {incidents.length} incidencia(s) sin resolver →</Link>}
      <div className="grid grid-cols-2 gap-3 mb-5">
        {[['Con entrada',checkedIn.length,'text-brand-400'],['Sin checar',notYet.length,'text-orange-400'],['Activos ahora',activeNow.length,'text-blue-400'],['Incidencias',incidents.length,'text-red-400']].map(([label,val,col])=><div key={label} className="card-sm"><div className="text-xs font-mono text-gray-500 uppercase mb-1">{label}</div><div className={`text-3xl font-extrabold ${col}`}>{val}</div></div>)}
      </div>
      {activeNow.length > 0 && <div className="card mb-4"><div className="flex items-center gap-2 mb-3"><span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse"/><span className="text-xs font-mono text-gray-500 uppercase">Jornadas activas</span></div>{activeNow.map(s=><div key={s.id} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0"><div><div className="font-semibold text-sm text-white">{getN(s.employee_id)}</div><div className="text-xs text-gray-500 font-mono">{fmtTime(s.entry_time)} · {diffMin(s.entry_time, now.toISOString())} min</div></div><span className="badge-blue">Activo</span></div>))}</div>}
      {notYet.length > 0 && <div className="card"><div className="text-xs font-mono text-gray-500 uppercase mb-3">Sin registro hoy</div>{notYet.map(e=><div key={e.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0"><div className="font-semibold text-sm text-white">{e.name}</div><span className="badge-gray">Sin registro</span></div>))}</div>}
      {employees.length === 0 && <div className="text-center py-12 text-gray-600"><div className="text-4xl mb-3">📍</div><p className="font-mono text-sm">Agrega empleados para empezar</p><Link href="/dashboard/employees" className="text-brand-400 text-sm font-semibold mt-2 inline-block">+ Agregar empleados →</Link></div>}
    </div>
  )
}
