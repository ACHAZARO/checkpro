'use client'
// src/app/dashboard/payroll/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { isoDate, weekRange, empWeekSummary, monthlyToHourly, fmtTime } from '@/lib/utils'
import toast from 'react-hot-toast'

function buildReportHTML(cut, weekShifts, employees, branchName) {
  const active = employees.filter(e => e.has_shift)
  const rows = active.map(emp => {
    const s = empWeekSummary(emp, weekShifts, employees)
    const shiftRows = s.shifts.filter(sh => sh.status !== 'open').map(sh => {
      const cov = sh.covering_employee_id ? employees.find(e=>e.id===sh.covering_employee_id) : null
      const pay = (sh.duration_hours||0) * monthlyToHourly(cov||emp) * (sh.is_holiday?3:1)
      return `<tr>
        <td>${sh.date_str}</td><td>${fmtTime(sh.entry_time)}</td>
        <td>${sh.exit_time?fmtTime(sh.exit_time):'—'}</td>
        <td>${sh.duration_hours||'—'}</td>
        <td>${sh.classification?.label||'—'}${sh.is_holiday?' <b style="color:#c00">FERIADO ×3</b>':''}</td>
        <td>${cov?'Cubrió: '+cov.name:''}${sh.incidents?.length?' ⚠':''}</td>
        <td><b>$${pay.toFixed(2)}</b></td>
      </tr>`
    }).join('')
    return `<div style="margin-bottom:28px;page-break-inside:avoid">
      <div style="font-size:13pt;font-weight:bold;margin-bottom:3px">${emp.name}</div>
      <div style="font-size:9pt;color:#555;margin-bottom:8px">${emp.department||''} | Salario mensual: $${(emp.monthly_salary||0).toLocaleString()} | Tarifa/h: $${monthlyToHourly(emp).toFixed(2)}</div>
      <table style="width:100%;border-collapse:collapse;font-size:8.5pt;margin-bottom:6px">
        <thead><tr style="background:#f4f4f4">
          <th style="border:1px solid #ccc;padding:4px 6px">Fecha</th><th style="border:1px solid #ccc;padding:4px 6px">Entrada</th>
          <th style="border:1px solid #ccc;padding:4px 6px">Salida</th><th style="border:1px solid #ccc;padding:4px 6px">Hrs</th>
          <th style="border:1px solid #ccc;padding:4px 6px">Clasificación</th><th style="border:1px solid #ccc;padding:4px 6px">Notas</th>
          <th style="border:1px solid #ccc;padding:4px 6px">Pago</th>
        </tr></thead>
        <tbody>${shiftRows||'<tr><td colspan=7 style="text-align:center;color:#aaa;padding:8px">Sin registros</td></tr>'}</tbody>
      </table>
      <div style="text-align:right;font-size:9.5pt">
        Horas: <b>${s.totalH}</b> | Bruto: $${s.grossPay.toFixed(2)}
        ${s.retardoDesc>0?` | Desc. retardos: <span style="color:#c60">-$${s.retardoDesc.toFixed(2)}</span>`:''}
        ${s.incidentDesc>0?` | Desc. incidencias: <span style="color:#c00">-$${s.incidentDesc.toFixed(2)}</span>`:''}
        | <b>NETO: $${s.netPay.toFixed(2)}</b>
      </div>
      <div style="margin-top:28px;border-top:1px solid #000;display:inline-block;width:200px;text-align:center;font-size:8pt;padding-top:4px;color:#666">Firma del empleado</div>
    </div>`
  }).join('')

  return `<html><head><meta charset="utf-8"/><title>Reporte ${cut.start_date}</title>
    <style>body{font-family:Arial,sans-serif;font-size:10pt;color:#000;margin:0;padding:0}.page{padding:15mm 18mm;max-width:216mm;box-sizing:border-box}</style>
  </head><body><div class="page">
    <h1 style="font-size:18pt;margin:0 0 3px">${branchName||'Sucursal'}</h1>
    <h2 style="font-size:11pt;font-weight:400;color:#555;margin:0 0 14px">Reporte Semanal de Asistencia y Nómina</h2>
    <div style="font-size:9pt;color:#666;border-bottom:1px solid #ccc;padding-bottom:10px;margin-bottom:18px">
      Período: <b>${cut.start_date}</b> al <b>${cut.end_date}</b> | Cerrado por: ${cut.closed_by_name} | ${new Date(cut.created_at).toLocaleString('es-MX')}
      ${cut.notes?`<br/>Notas: ${cut.notes}`:''}
    </div>
    ${rows}
    <div style="margin-top:20px;font-size:7.5pt;color:#aaa;border-top:1px solid #eee;padding-top:8px">CheckPro · ${branchName} · Semana ${cut.start_date} / ${cut.end_date} · Documento interno</div>
  </div></body></html>`
}

export default function PayrollPage() {
  const [emps, setEmps] = useState([])
  const [shifts, setShifts] = useState([])
  const [cuts, setCuts] = useState([])
  const [cfg, setCfg] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cutNote, setCutNote] = useState('')
  const [closing, setClosing] = useState(false)
  const [printHTML, setPrintHTML] = useState(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)
    const { data: tenant } = await supabase.from('tenants').select('config').eq('id', prof.tenant_id).single()
    setCfg(tenant?.config)
    const [{ data: empData }, { data: shiftData }, { data: cutData }] = await Promise.all([
      supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).eq('status','active').eq('has_shift',true),
      supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).order('date_str',{ascending:false}),
      supabase.from('week_cuts').select('*').eq('tenant_id', prof.tenant_id).order('created_at',{ascending:false}),
    ])
    setEmps(empData||[])
    setShifts(shiftData||[])
    setCuts(cutData||[])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const range = cfg ? weekRange(new Date(), cfg.weekClosingDay||'dom') : weekRange(new Date(),'dom')
  const weekShifts = shifts.filter(s => s.date_str >= isoDate(range.start) && s.date_str <= isoDate(range.end))
  const incidents = shifts.filter(s => s.status === 'incident')

  async function closeWeek() {
    if (incidents.length > 0 && !confirm(`Hay ${incidents.length} incidencia(s) sin resolver. ¿Continuar de todas formas?`)) return
    setClosing(true)
    const supabase = createClient()
    const startStr = isoDate(range.start), endStr = isoDate(range.end)
    const uncutShifts = weekShifts.filter(s => !s.week_cut_id)
    const { data: cut, error } = await supabase.from('week_cuts').insert({
      tenant_id: tenantId, start_date: startStr, end_date: endStr,
      closed_by_name: 'Gerente', notes: cutNote, paid: true,
      shift_ids: uncutShifts.map(s=>s.id)
    }).select().single()
    if (error) { toast.error('Error al cerrar semana'); setClosing(false); return }
    await supabase.from('shifts').update({ week_cut_id: cut.id }).in('id', uncutShifts.map(s=>s.id))
    await supabase.from('audit_log').insert({ tenant_id: tenantId, action: 'WEEK_CUT', employee_name: 'Gerente', detail: `${startStr}→${endStr}`, success: true })
    toast.success('Semana cerrada exitosamente')
    await load()
    // Auto show report
    const { data: fresh } = await supabase.from('week_cuts').select('*').eq('id',cut.id).single()
    setPrintHTML(buildReportHTML(fresh, uncutShifts, emps, cfg?.branchName))
    setClosing(false)
  }

  function openReport(cut) {
    const ws = shifts.filter(s => cut.shift_ids?.includes(s.id))
    setPrintHTML(buildReportHTML(cut, ws, emps, cfg?.branchName))
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Nómina</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">SEMANA: {isoDate(range.start)} → {isoDate(range.end)}</p>
      </div>

      {incidents.length > 0 && (
        <div className="px-4 py-3 mb-4 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-semibold">
          🚩 {incidents.length} incidencia(s) sin resolver afectan el cálculo
        </div>
      )}

      {/* Week summary */}
      <div className="space-y-3 mb-6">
        {emps.map(emp => {
          const s = empWeekSummary(emp, weekShifts, emps)
          return (
            <div key={emp.id} className="card">
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="font-bold text-white">{emp.name}</div>
                  <div className="text-xs text-gray-500">{emp.department} · ${monthlyToHourly(emp).toFixed(2)}/h</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-extrabold text-brand-400 font-mono">${s.netPay.toFixed(0)}</div>
                  <div className="text-[9px] text-gray-600 font-mono">NETO EST.</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500 font-mono mb-3">
                <span>{s.totalH}h trabajadas</span>
                <span>Bruto: ${s.grossPay.toFixed(2)}</span>
                {s.retardoDesc > 0 && <span className="text-orange-400">-${s.retardoDesc.toFixed(2)} retardos</span>}
                {s.incidentDesc > 0 && <span className="text-red-400">-${s.incidentDesc.toFixed(2)} incid.</span>}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {s.retardos > 0 && <span className="badge-orange">{s.retardos} retardo{s.retardos>1?'s':''}</span>}
                {s.incidents > 0 && <span className="badge-red">{s.incidents} incidencia{s.incidents>1?'s':''}</span>}
                {s.retardos===0 && s.incidents===0 && <span className="badge-green">Sin incidencias ✓</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Close week */}
      <div className="card mb-4">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Corte semanal</p>
        <div className="mb-3"><label className="label">Notas del corte (opcional)</label>
          <input className="input text-sm" placeholder="Observaciones de la semana..." value={cutNote} onChange={e=>setCutNote(e.target.value)}/>
        </div>
        <button onClick={closeWeek} disabled={closing} className="btn-primary">
          {closing ? '⏳ Cerrando...' : '🖨️ Cerrar semana e imprimir reporte'}
        </button>
      </div>

      {/* Previous cuts */}
      {cuts.length > 0 && (
        <div>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Cortes anteriores</p>
          <div className="space-y-2">
            {cuts.map(c => (
              <div key={c.id} className="card-sm flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-white">{c.start_date} → {c.end_date}</div>
                  <div className="text-xs text-gray-500">{c.closed_by_name} · {c.notes || 'Sin notas'}</div>
                </div>
                <button onClick={() => openReport(c)}
                  className="px-3 py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white active:bg-dark-600 shrink-0">
                  🖨️
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Print modal */}
      {printHTML && (
        <div className="fixed inset-0 z-[500] bg-white flex flex-col">
          <div className="flex gap-3 items-center p-3 bg-dark-900 border-b border-dark-border shrink-0 no-print">
            <button onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl">
              🖨️ Imprimir / Guardar PDF
            </button>
            <button onClick={() => setPrintHTML(null)}
              className="flex items-center gap-2 px-4 py-2 bg-dark-700 border border-dark-border text-white text-sm font-semibold rounded-xl">
              ✕ Cerrar
            </button>
            <span className="text-xs text-gray-500 font-mono hidden md:block">Ctrl+P para imprimir</span>
          </div>
          <iframe srcDoc={printHTML} className="flex-1 border-0 w-full" title="Reporte semanal"/>
        </div>
      )}
    </div>
  )
}
