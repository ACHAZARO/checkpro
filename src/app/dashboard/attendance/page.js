'use client'
// src/app/dashboard/attendance/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { fmtTime, fmtDate, isoDate, weekRange, dayKey, countGraveIncidents } from '@/lib/utils'
import toast from 'react-hot-toast'

function ShiftBadge({ status, classification }) {
  if (status === 'open') return <span className="badge-blue">Abierta</span>
  if (status === 'incident') return <span className="badge-red">Incidencia</span>
  if (status === 'absent') {
    const t = classification?.type
    if (t === 'falta_injustificada') return <span className="badge-red">Falta injustificada</span>
    if (t === 'falta_justificada_pagada') return <span className="badge-orange">Falta justif. pagada</span>
    if (t === 'falta_justificada_no_pagada') return <span className="badge-orange">Falta justif. s/pago</span>
    return <span className="badge-red">Falta</span>
  }
  const t = classification?.type
  if (t === 'retardo') return <span className="badge-orange">Retardo</span>
  if (t === 'tolerancia') return <span className="badge-orange">Tolerancia</span>
  return <span className="badge-green">Completa</span>
}

// ── CSV export ────────────────────────────────────────────────────────────────
function exportToCSV(rows, filename) {
  const header = Object.keys(rows[0] || {}).join(',')
  const body = rows.map(r =>
    Object.values(r).map(v => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')
  ).join('\n')
  const blob = new Blob(['\uFEFF' + header + '\n' + body], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click()
  URL.revokeObjectURL(url)
}

// Días entre filterFrom y filterTo (inclusive), for absence detection
function dateRange(from, to) {
  const dates = []
  const d = new Date(from + 'T12:00:00')
  const end = new Date(to + 'T12:00:00')
  while (d <= end) {
    dates.push(isoDate(d))
    d.setDate(d.getDate() + 1)
  }
  return dates
}

// Check si una fecha (YYYY-MM-DD) cae en un periodo de vacaciones (start/end inclusivos)
function dateInPeriod(dateStr, period) {
  if (!dateStr || !period) return false
  const s = String(period.start_date || '').slice(0, 10)
  const e = String(period.end_date || '').slice(0, 10)
  if (!s || !e) return false
  return dateStr >= s && dateStr <= e
}

export default function AttendancePage() {
  const [shifts, setShifts] = useState([])
  const [allShifts, setAllShifts] = useState([]) // all shifts (for grave count)
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
  const [absenceSheet, setAbsenceSheet] = useState(null) // { emp, dateStr }
  const [corrForm, setCorrForm] = useState({})
  const [flagForm, setFlagForm] = useState({ type: 'olvido_salida', note: '' })
  const [absenceForm, setAbsenceForm] = useState({ type: 'falta_injustificada', note: '' })
  const [saving, setSaving] = useState(false)

  // Vacation periods que tocan el rango visible.
  const [vacationPeriods, setVacationPeriods] = useState([])

  // Suggested absences: employees who had scheduled workday but no shift record
  const [suggestedAbsences, setSuggestedAbsences] = useState([]) // { emp, dateStr }
  const [dismissedSuggestions, setDismissedSuggestions] = useState(new Set())

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)

    const [{ data: empData }, { data: shiftData }, { data: tenantData }, { data: allShiftData }, { data: vacData }] = await Promise.all([
      supabase.from('employees').select('id,name,department,monthly_salary,schedule').eq('tenant_id', prof.tenant_id).neq('status','deleted'),
      supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).gte('date_str', filterFrom).lte('date_str', filterTo).order('date_str', { ascending: false }).order('entry_time', { ascending: false }),
      supabase.from('tenants').select('config').eq('id', prof.tenant_id).single(),
      // Load all shifts for grave incident count (last 12 months)
      supabase.from('shifts').select('employee_id,classification,status').eq('tenant_id', prof.tenant_id)
        .gte('date_str', isoDate(new Date(Date.now() - 365 * 24 * 3600 * 1000))),
      // Periodos de vacaciones que tocan el rango [filterFrom, filterTo]
      // Solo status active/completed (no pending, no cancelled).
      supabase.from('vacation_periods')
        .select('id,employee_id,start_date,end_date,status,tipo,entitled_days')
        .eq('tenant_id', prof.tenant_id)
        .in('status', ['active', 'completed'])
        .lte('start_date', filterTo)
        .gte('end_date', filterFrom),
    ])
    setEmps(empData || [])
    setShifts(shiftData || [])
    setAllShifts(allShiftData || [])
    setBranches(tenantData?.config?.branches || [])
    setVacationPeriods(vacData || [])

    // Auto-detect possible absences (excluye dias que caen en vacaciones)
    const dates = dateRange(filterFrom, filterTo)
    const shiftsByEmpDate = new Set((shiftData || []).map(s => `${s.employee_id}_${s.date_str}`))
    const vacByEmp = {}
    for (const p of vacData || []) {
      if (!vacByEmp[p.employee_id]) vacByEmp[p.employee_id] = []
      vacByEmp[p.employee_id].push(p)
    }
    const suggestions = []
    for (const emp of (empData || [])) {
      const empVacs = vacByEmp[emp.id] || []
      for (const dateStr of dates) {
        const dk = dayKey(new Date(dateStr + 'T12:00:00'))
        const shouldWork = emp.schedule?.[dk]?.work === true
        const hasRecord = shiftsByEmpDate.has(`${emp.id}_${dateStr}`)
        const onVac = empVacs.some(p => dateInPeriod(dateStr, p))
        if (shouldWork && !hasRecord && !onVac) {
          suggestions.push({ emp, dateStr })
        }
      }
    }
    // Only show last 7 days suggestions to avoid noise
    const cutoff = isoDate(new Date(Date.now() - 7 * 24 * 3600 * 1000))
    setSuggestedAbsences(suggestions.filter(s => s.dateStr >= cutoff && s.dateStr < isoDate(new Date())))
    setLoading(false)
  }, [filterFrom, filterTo])

  useEffect(() => { load() }, [load])

  // Build a map of employeeId → branchId for quick lookup
  const empBranchMap = Object.fromEntries(emps.map(e => [e.id, e.schedule?.branch?.id || null]))

  // Mapas auxiliares: periodos por empleado (para lookup rapido) y
  // dias del rango que caen en vacaciones (para pintar "rows virtuales").
  const vacByEmp = {}
  for (const p of vacationPeriods) {
    if (!vacByEmp[p.employee_id]) vacByEmp[p.employee_id] = []
    vacByEmp[p.employee_id].push(p)
  }

  // Shifts filtrados (como antes). Ademas marcamos cada uno con si ese dia
  // esta dentro de un periodo de vacaciones del empleado (prevalece asistencia
  // registrada; solo usamos la marca para informar visualmente).
  const filtered = shifts.filter(s => {
    if (filterEmp !== 'all' && s.employee_id !== filterEmp) return false
    if (filterStatus !== 'all' && s.status !== filterStatus) return false
    if (filterBranch !== 'all' && empBranchMap[s.employee_id] !== filterBranch) return false
    return true
  })

  // Dias virtuales de vacaciones: para cada periodo visible, generar una fila por dia
  // en el rango [filterFrom, filterTo] que caiga en (start_date, end_date) del periodo,
  // SIEMPRE QUE no haya un shift registrado ese dia para ese empleado
  // (si checo, prevalece la asistencia real).
  const shiftsByEmpDate = new Set(shifts.map(s => `${s.employee_id}_${s.date_str}`))
  const virtualVacationRows = []
  for (const p of vacationPeriods) {
    if (filterEmp !== 'all' && p.employee_id !== filterEmp) continue
    const emp = emps.find(e => e.id === p.employee_id)
    if (!emp) continue
    if (filterBranch !== 'all' && empBranchMap[p.employee_id] !== filterBranch) continue
    // Solo active prevalece sobre falta. completed si cayo en rango tambien lo mostramos.
    const rangeDates = dateRange(filterFrom, filterTo)
    const s = String(p.start_date).slice(0, 10)
    const e = String(p.end_date).slice(0, 10)
    for (const d of rangeDates) {
      if (d < s || d > e) continue
      if (shiftsByEmpDate.has(`${emp.id}_${d}`)) continue // prevalece la asistencia real
      // BUG 10: ANTES filtrábamos por schedule.work=true (no mostrar
      // descansos/domingos), pero el pago de nómina es en días naturales
      // (LFT art. 89 — mensual/30). El gerente veía "5d vacaciones" en
      // asistencia y "7d pagados" en nómina. Mostramos TODOS los días
      // del rango que caen en el periodo — alinea UI con el pago real.
      virtualVacationRows.push({
        _virtual: 'vacation',
        id: `vac_${p.id}_${d}`,
        employee_id: emp.id,
        date_str: d,
        status: 'vacation',
        classification: { type: 'vacation', label: `🏖 Vacaciones${p.tipo ? ' (' + p.tipo + ')' : ''}` },
        period: p,
      })
    }
  }

  // Filtrar por status si aplica (vacation cuenta como un status virtual "vacation")
  const visibleVacationRows = filterStatus === 'all' || filterStatus === 'vacation'
    ? virtualVacationRows
    : []

  // Combinar shifts reales + filas virtuales de vacaciones, ordenado descendiente por fecha
  const combined = [
    ...filtered.map(s => ({ ...s, _virtual: null })),
    ...visibleVacationRows,
  ].sort((a, b) => {
    if (a.date_str === b.date_str) {
      // shifts reales primero
      if (a._virtual && !b._virtual) return 1
      if (!a._virtual && b._virtual) return -1
      return 0
    }
    return a.date_str < b.date_str ? 1 : -1
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

  // ── Register an absence ────────────────────────────────────────────────────
  async function saveAbsence() {
    if (!absenceSheet) return
    setSaving(true)
    const supabase = createClient()
    const { emp, dateStr } = absenceSheet
    const typeLabels = {
      falta_injustificada: 'Falta injustificada',
      falta_justificada_pagada: 'Falta justificada (con goce de sueldo)',
      falta_justificada_no_pagada: 'Falta justificada (sin goce de sueldo)',
    }
    const label = typeLabels[absenceForm.type] || absenceForm.type
    const isGrave = absenceForm.type === 'falta_injustificada'

    await supabase.from('shifts').insert({
      tenant_id: tenantId,
      employee_id: emp.id,
      date_str: dateStr,
      entry_time: null,
      exit_time: null,
      duration_hours: 0,
      status: 'absent',
      classification: { type: absenceForm.type, label },
      incidents: isGrave ? [{ type: 'grave', note: absenceForm.note || 'Falta injustificada registrada por gerente', ts: new Date().toISOString() }] : [],
      corrections: {},
    })

    await supabase.from('audit_log').insert({
      tenant_id: tenantId, action: 'ABSENCE',
      employee_id: emp.id, employee_name: emp.name,
      detail: `${label} · ${dateStr}${absenceForm.note ? ' · ' + absenceForm.note : ''}`,
      success: true
    })

    // Check for 3rd grave incident → alert in audit log
    const graveCount = countGraveIncidents(allShifts, emp.id) + 1
    if (isGrave && graveCount >= 3) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'GRAVE_ALERT',
        employee_id: emp.id, employee_name: emp.name,
        detail: `⚠ ALERTA: ${emp.name} acumula ${graveCount} faltas injustificadas. Revisar posible causal de despido.`,
        success: false
      })
      toast.error(`⚠ ${emp.name} tiene ${graveCount} faltas graves. Se generó alerta.`, { duration: 6000 })
    } else {
      toast.success(`Falta registrada: ${label}`)
    }

    setSaving(false)
    setAbsenceSheet(null)
    setAbsenceForm({ type: 'falta_injustificada', note: '' })
    setDismissedSuggestions(prev => new Set([...prev, `${emp.id}_${dateStr}`]))
    await load()
  }

  // Visible suggested absences (not yet dismissed or registered)
  const visibleSuggestions = suggestedAbsences.filter(s =>
    !dismissedSuggestions.has(`${s.emp.id}_${s.dateStr}`)
  )

  // Export filtered shifts to CSV
  function handleExportCSV(annual = false) {
    const src = annual ? shifts : filtered // annual = all loaded, filtered = current filter
    if (src.length === 0) { toast.error('No hay registros para exportar'); return }
    const rows = src.map(s => ({
      Fecha: s.date_str,
      Empleado: getEmpName(s.employee_id),
      Sucursal: (() => { const bid = empBranchMap[s.employee_id]; return bid ? branches.find(b => b.id === bid)?.name || '' : '' })(),
      Estado: s.status,
      Clasificación: s.classification?.label || '',
      Entrada: s.entry_time ? new Date(s.entry_time).toLocaleTimeString('es-MX') : '',
      Salida: s.exit_time ? new Date(s.exit_time).toLocaleTimeString('es-MX') : '',
      Horas: s.duration_hours || 0,
      HorasExtra: s.corrections?.overtime?.hours || 0,
      Retardo: s.classification?.type === 'retardo' ? 'Sí' : 'No',
      Feriado: s.is_holiday ? 'Sí' : 'No',
      Incidencias: (s.incidents || []).map(i => i.type).join('; '),
    }))
    const filename = `checkpro_asistencia_${filterFrom}_${filterTo}.csv`
    exportToCSV(rows, filename)
    toast.success(`${src.length} registros exportados`)
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Asistencia</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">HISTORIAL DE JORNADAS</p>
      </div>

      {/* ── Suggested absences ──────────────────────────────────────────── */}
      {visibleSuggestions.length > 0 && (
        <div className="mb-5">
          <div className="px-4 py-3 mb-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
            <p className="text-yellow-400 text-sm font-bold">
              📋 {visibleSuggestions.length} posible{visibleSuggestions.length > 1 ? 's' : ''} falta{visibleSuggestions.length > 1 ? 's' : ''} detectada{visibleSuggestions.length > 1 ? 's' : ''}
            </p>
            <p className="text-yellow-400/70 text-xs mt-0.5">
              Empleados con turno programado que no ficharon. Confirma o descarta cada una.
            </p>
          </div>
          <div className="space-y-2">
            {visibleSuggestions.map(({ emp, dateStr }) => {
              const graveCount = countGraveIncidents(allShifts, emp.id)
              return (
                <div key={`${emp.id}_${dateStr}`} className="card border-l-4 border-l-yellow-400">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white text-sm">{emp.name}</div>
                      <div className="text-xs text-gray-400 font-mono mt-0.5">{dateStr} · Sin registro</div>
                      {graveCount > 0 && (
                        <div className="mt-1 text-[10px] text-red-400 font-mono">
                          ⚠ {graveCount} falta{graveCount > 1 ? 's' : ''} grave{graveCount > 1 ? 's' : ''} previas
                          {graveCount >= 2 && ' — próxima = 3 faltas → ALERTA'}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => { setAbsenceSheet({ emp, dateStr }); setAbsenceForm({ type: 'falta_injustificada', note: '' }) }}
                        className="px-3 py-1.5 bg-red-500/15 border border-red-500/25 rounded-lg text-red-400 text-xs font-semibold active:bg-red-500/25">
                        Registrar falta
                      </button>
                      <button
                        onClick={() => setDismissedSuggestions(prev => new Set([...prev, `${emp.id}_${dateStr}`]))}
                        className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-gray-500 text-xs font-semibold active:bg-dark-600">
                        Descartar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Export */}
      <div className="flex gap-2 mb-4 flex-wrap">
        <button onClick={() => handleExportCSV(false)}
          className="flex items-center gap-1.5 px-3 py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-semibold text-white active:bg-dark-600">
          📥 Exportar filtro (.csv)
        </button>
        <button onClick={() => handleExportCSV(true)}
          className="flex items-center gap-1.5 px-3 py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-semibold text-white active:bg-dark-600">
          📦 Exportar todo el período (.csv)
        </button>
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
              <option value="absent">Faltas</option>
              <option value="vacation">Vacaciones</option>
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
          <p className="text-xs text-gray-600 font-mono mb-3">
            {combined.length} registro(s)
            {visibleVacationRows.length > 0 && (
              <span className="ml-2 text-purple-400">· {visibleVacationRows.length} día(s) de vacaciones</span>
            )}
          </p>
          <div className="space-y-2">
            {combined.length === 0 && <div className="card text-center py-10 text-gray-500 font-mono text-sm">Sin registros en este período</div>}
            {combined.map(s => {
              // ── Fila VIRTUAL de vacaciones ───────────────────────────────
              if (s._virtual === 'vacation') {
                const emp = emps.find(e => e.id === s.employee_id)
                const bid = empBranchMap[s.employee_id]
                const bn = bid ? branches.find(b => b.id === bid)?.name : null
                return (
                  <div key={s.id}
                    className="card-sm border-l-4 border-l-purple-400 bg-purple-500/10">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-bold text-sm text-white">{emp?.name || s.employee_id}</span>
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-purple-500/20 border border-purple-500/30 text-purple-300">
                            🏖 Vacaciones
                          </span>
                          {s.period?.status === 'completed' && (
                            <span className="px-1.5 py-0.5 bg-dark-700 border border-dark-border rounded-full text-gray-400 text-[9px] font-mono">
                              completado
                            </span>
                          )}
                        </div>
                        <div className="text-xs text-gray-500 font-mono mt-1">
                          {s.date_str}
                          {s.period?.start_date && s.period?.end_date && (
                            <> · Periodo {s.period.start_date} → {s.period.end_date}</>
                          )}
                        </div>
                        <div className="text-xs text-purple-300/80 mt-0.5">{s.classification.label}</div>
                        {bn && <div className="text-[10px] text-gray-600 font-mono mt-0.5">🏢 {bn}</div>}
                      </div>
                    </div>
                  </div>
                )
              }

              // ── Fila normal de shift ───────────────────────────────
              const bid = empBranchMap[s.employee_id]
              const bn = bid ? branches.find(b => b.id === bid)?.name : null
              const graveCount = s.status === 'absent' && s.classification?.type === 'falta_injustificada'
                ? countGraveIncidents(allShifts, s.employee_id)
                : 0
              // Si el empleado esta cubriendo a otro, resaltar en cyan
              const isCovering = !!s.covering_employee_id
              return (
                <div key={s.id}
                  className={`card-sm
                    ${s.status==='incident'||s.status==='absent' ? 'border-red-500/20' : ''}
                    ${isCovering ? 'border-l-4 border-l-cyan-400 bg-cyan-500/10' : ''}
                  `}>
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-white">{getEmpName(s.employee_id)}</span>
                        <ShiftBadge status={s.status} classification={s.classification} />
                        {isCovering && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-cyan-500/20 border border-cyan-500/30 text-cyan-300">
                            🔄 Cobertura
                          </span>
                        )}
                        {s.is_holiday && <span className="badge-orange text-[9px]">FERIADO ×3</span>}
                        {s.corrections?.overtime?.hours > 0 && (
                          <span className="px-1.5 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-[9px] font-mono">
                            +{s.corrections.overtime.hours}h HE
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500 font-mono mt-1">
                        {s.date_str}
                        {s.status !== 'absent' && ` · ${fmtTime(s.entry_time)} – ${s.exit_time ? fmtTime(s.exit_time) : '—'}`}
                        {s.duration_hours ? ` · ${s.duration_hours}h` : ''}
                      </div>
                      {s.classification?.label && s.status !== 'absent' && (
                        <div className="text-xs text-gray-600 mt-0.5">{s.classification.label}</div>
                      )}
                      {bn && <div className="text-[10px] text-gray-600 font-mono mt-0.5">🏢 {bn}</div>}
                      {s.covering_employee_id && (
                        <div className="text-xs text-cyan-300 font-mono mt-0.5">Cubriendo: {getEmpName(s.covering_employee_id)}</div>
                      )}
                      {s.incidents?.length > 0 && s.incidents.map((inc,i) => (
                        <div key={i} className="text-xs text-red-400 mt-1">🚩 {inc.type} — {inc.note}</div>
                      ))}
                      {graveCount > 0 && (
                        <div className={`text-[10px] font-mono mt-1 ${graveCount >= 3 ? 'text-red-400 font-bold' : 'text-orange-400'}`}>
                          ⚠ {graveCount} falta{graveCount > 1 ? 's' : ''} grave{graveCount > 1 ? 's' : ''} acumulada{graveCount > 1 ? 's' : ''}
                          {graveCount >= 3 && ' — ALERTA GENERADA'}
                        </div>
                      )}
                      {Array.isArray(s.corrections) && s.corrections.length > 0 && (
                        <div className="text-xs text-yellow-500 mt-0.5">✏️ {s.corrections.length} corrección(es)</div>
                      )}
                    </div>
                    {s.status !== 'absent' && (
                      <div className="flex gap-1.5 shrink-0">
                        <button onClick={() => { setCorrSheet(s); setCorrForm({ entryTime: s.entry_time?.slice(0,16), exitTime: s.exit_time?.slice(0,16)||'', note: '' }) }}
                          className="p-2 bg-dark-700 border border-dark-border rounded-lg text-xs text-gray-400 active:bg-dark-600">✏️</button>
                        {s.status === 'open' && (
                          <button onClick={() => { setFlagSheet(s); setFlagForm({ type:'olvido_salida', note:'' }) }}
                            className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400 active:bg-red-500/20">🚩</button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}

      {/* ── Register absence sheet ─────────────────────────────────────────── */}
      {absenceSheet && (
        <div className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end" style={{touchAction:'none'}}>
          <div className="bg-dark-800 rounded-t-2xl overflow-y-scroll no-scrollbar" style={{maxHeight:'80vh',touchAction:'pan-y'}}>
            <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-4"/>
            <div className="px-5 pb-10">
              <h3 className="text-lg font-bold text-white mb-1">Registrar Falta</h3>
              <p className="text-xs text-gray-500 font-mono mb-4">{absenceSheet.emp.name} · {absenceSheet.dateStr}</p>

              <div className="mb-4">
                <p className="label mb-2">Tipo de falta</p>
                <div className="space-y-2">
                  {[
                    {
                      value: 'falta_injustificada',
                      label: 'Injustificada',
                      desc: 'Sin causa válida. No se paga. Se marca como falta grave.',
                      color: 'red'
                    },
                    {
                      value: 'falta_justificada_pagada',
                      label: 'Justificada — con goce de sueldo',
                      desc: 'Falta con justificante válido. Se paga el día.',
                      color: 'green'
                    },
                    {
                      value: 'falta_justificada_no_pagada',
                      label: 'Justificada — sin goce de sueldo',
                      desc: 'Falta con justificante pero sin pago del día.',
                      color: 'orange'
                    },
                  ].map(opt => (
                    <label key={opt.value}
                      className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                        ${absenceForm.type === opt.value
                          ? opt.color === 'red' ? 'bg-red-500/10 border-red-500/30' : opt.color === 'green' ? 'bg-green-500/10 border-green-500/30' : 'bg-orange-500/10 border-orange-500/30'
                          : 'bg-dark-700 border-dark-border'
                        }`}>
                      <input type="radio" name="absenceType" value={opt.value}
                        checked={absenceForm.type === opt.value}
                        onChange={() => setAbsenceForm(f => ({ ...f, type: opt.value }))}
                        className="mt-0.5 shrink-0" />
                      <div>
                        <p className="text-sm text-white font-semibold">{opt.label}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              {absenceForm.type === 'falta_injustificada' && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/20 rounded-xl">
                  <p className="text-red-400 text-xs font-bold">⚠ Falta grave</p>
                  <p className="text-red-400/70 text-xs mt-0.5">
                    A las 3 faltas graves acumuladas se genera una alerta automática. Esto puede constituir causal de despido sin responsabilidad (Art. 47 LFT).
                  </p>
                </div>
              )}

              <div className="mb-4">
                <label className="label">Nota / Justificante</label>
                <input className="input" placeholder="Descripción o referencia del justificante..."
                  value={absenceForm.note}
                  onChange={e => setAbsenceForm(f => ({ ...f, note: e.target.value }))} />
              </div>

              <div className="flex gap-2">
                <button onClick={saveAbsence} disabled={saving}
                  className="btn-danger flex-1">
                  {saving ? 'Guardando...' : 'Registrar falta'}
                </button>
                <button onClick={() => { setAbsenceSheet(null) }} className="btn-ghost">Cancelar</button>
              </div>
            </div>
          </div>
        </div>
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
