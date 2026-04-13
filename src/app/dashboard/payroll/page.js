'use client'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { isoDate, weekRange, empWeekSummary, monthlyToHourly } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function PayrollPage() {
  const [emps, setEmps] = useState([])
  const [shifts, setShifts] = useState([])
  const [cuts, setCuts] = useState([])
  const [tenantId, setTenantId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [closing, setClosing] = useState(false)

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
      if (!prof?.tenant_id) return
      setTenantId(prof.tenant_id)
      const [{ data: empData }, { data: shiftData }, { data: cutData }] = await Promise.all([
        supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).eq('status','active').eq('has_shift',true),
        supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).order('date_str',{ascending:false}),
        supabase.from('week_cuts').select('*').eq('tenant_id', prof.tenant_id).order('created_at',{ascending:false}),
      ])
      setEmps(empData||[]); setShifts(shiftData||[]); setCuts(cutData||[]); setLoading(false)
    }
    load()
  }, [])

  const range = weekRange(new Date(), 'dom')
  const weekShifts = shifts.filter(s => s.date_str >= isoDate(range.start) && s.date_str <= isoDate(range.end))

  async function closeWeek() {
    if (!confirm('¿Cerrar la semana y generar reporte?')) return
    setClosing(true)
    try {
      const supabase = createClient()
      const { error } = await supabase.from('week_cuts').insert({ tenant_id: tenantId, start_date: isoDate(range.start), end_date: isoDate(range.end), closed_by_name: 'Gerente', shift_ids: weekShifts.map(s=>s.id) })
      if (error) throw error
      toast.success('Semana cerrada')
      window.location.reload()
    } catch (err) { toast.error(err.message) }
    finally { setClosing(false) }
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5"><h1 className="text-2xl font-extrabold text-white">Nómina</h1><p className="text-gray-500 text-xs font-mono mt-0.5">SEMANA: {isoDate(range.start)} → {isoDate(range.end)}</p></div>
      <div className="space-y-3 mb-6">
        {emps.map(emp => {
          const s = empWeekSummary(emp, weekShifts, emps)
          return (
            <div key={emp.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div><div className="font-bold text-white">{emp.name}</div><div className="text-xs text-gray-500">{emp.department} · ${(monthlyToHourly(emp)).toFixed(2)}/hr</div></div>
                <div className="text-right"><div className="text-xl font-extrabold text-brand-400 font-mono">${s.netPay.toFixed(0)}</div><div className="text-[9px] text-gray-600 font-mono">NETO EST.</div></div>
              </div>
              <div className="text-xs text-gray-500 font-mono">{s.totalH} hs trabajadas · Bruto: ${s.grossPay.toFixed(2)}</div>
            </div>
          )
        })}
      </div>
      <div className="card mb-4">
        <p className="text-xs font-mono text-gray-500 uppercase mb-3">Corte semanal</p>
        <button onClick={closeWeek} disabled={closing} className="btn-primary">{closing?'⏳ Cerrando...':'🖨️ Cerrar semana'}</button>
      </div>
      {cuts.length > 0 && <div><p className="text-xs font-mono text-gray-500 uppercase mb-3">Cortes anteriores</p><div className="space-y-2">{cuts.map(c=><div key={c.id} className="card-sm"><div className="font-semibold text-sm text-white">{c.start_date} → {c.end_date}</div><div className="text-xs text-gray-500">{c.closed_by_name}</div></div>)}</div></div>}
    </div>
  )
}
