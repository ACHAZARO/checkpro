'use client'
// src/app/dashboard/payroll/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { isoDate, weekRange, empWeekSummary, monthlyToHourly, fmtTime, fmtDate, dayKey, DAYS, DAY_FL, vacationPayForWeek } from '@/lib/utils'
import toast from 'react-hot-toast'
import { Building2, Lock, AlertTriangle, Printer, FileSpreadsheet, Loader2, X, Check, Minus, DollarSign, Flag } from 'lucide-react'

// Default legend si el usuario no guardo uno custom (espejo de settings/DEFAULT_LEYENDA)
const DEFAULT_PAYROLL_LEGEND = 'Al firmar el presente comprobante de nómina, el trabajador acepta que los montos, horas trabajadas e incidencias registradas son correctos y conformes a su contrato laboral. Cualquier aclaración deberá presentarse por escrito en un plazo máximo de 5 días hábiles. Documento confidencial de uso interno.'

// ── Calculo de salario diario para PAGO DE VACACIONES ─────────────────────
// BUG 4: LFT art. 89 dicta salario diario = monthly_salary / 30.
// Se usa 30 fijo (no workDaysPerWeek*52/12) para que jornadas de <5 dias
// no inflen el diario. Coincide con lib/vacations.js computeCompensationAmount.
// Numero de dias entre dos fechas ISO (inclusive) que intersectan [aStart, aEnd]
// con [bStart, bEnd]. Todos como strings YYYY-MM-DD.
// ── Resumen de vacaciones que impactan el corte semanal ────────────────────
// Para un empleado, con sus periodos y rango de semana (weekStart, weekEnd):
// - tomadas (active o completed): dias en rango * dailyRate + prima.
// - compensadas con completed_at en rango: suma compensated_amount.
//
// BUG S (TODO P3): el corte semanal NO rastrea los vacation_period_ids pagados,
// solo shift_ids. Si se re-abre un corte pagado y se mueve la fecha del periodo,
// o si el completed_at de un periodo cae dos veces en rangos de cortes distintos
// (edge case de re-apertura), se pagaria doble. Fix real requiere migracion SQL
// agregando week_cuts.vacation_period_ids + enganche en closeWeek. Por ahora,
// dejamos la logica tal cual: el flujo normal (cortes inmutables una vez
// cerrados) no tiene el problema. Revisar cuando agreguemos edicion de cortes.
// FIX 10: escape HTML en todas las interpolaciones de datos del cliente
// dentro del HTML del reporte (corre en un iframe same-origin). Previene XSS
// si un gerente pega algo como "<img src=x onerror=...>" en notas del corte,
// nombres de empleado, departamentos o la leyenda.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Compact single-page report ───────────────────────────────────────────────
function buildReportHTML(cut, weekShifts, employees, branchName, logoUrl, payrollLegend, vacByEmp, coveragePayMode) {
  const active = employees.filter(e => e.has_shift)
  let totalNet = 0
  let totalGross = 0
  let totalDeductions = 0
  let totalVac = 0

  const weekStart = cut.start_date
  const weekEnd = cut.end_date

  // FIX: reporte impreso profesional, con columnas reducidas y firmas separadas.
  const rows = []
  const incidentRows = []
  const signatureRows = []
  const vacLines = []

  active.forEach((emp, idx) => {
    const s = empWeekSummary(emp, weekShifts, employees, coveragePayMode)
    const vac = vacationPayForWeek(emp, (vacByEmp && vacByEmp[emp.id]) || [], weekStart, weekEnd)
    const grossWithVac = s.grossPay + vac.totalVacationPay
    const deductions = s.retardoDesc + s.incidentDesc
    const netWithVac = Math.max(0, grossWithVac - deductions)
    totalGross += grossWithVac
    totalNet += netWithVac
    totalDeductions += deductions
    totalVac += vac.totalVacationPay
    const daysWorked = s.shifts.filter(sh => ['closed', 'incident'].includes(sh.status)).length

    const notes = []
    if (s.retardos > 0) notes.push(`${s.retardos} retardo${s.retardos !== 1 ? 's' : ''}`)
    if (s.incidents > 0) notes.push(`${s.incidents} incidencia${s.incidents !== 1 ? 's' : ''}`)
    if (s.faltasInjustificadas > 0) notes.push(`${s.faltasInjustificadas} falta${s.faltasInjustificadas !== 1 ? 's' : ''} injustificada${s.faltasInjustificadas !== 1 ? 's' : ''}`)
    if (vac.daysInRange > 0) notes.push(`${vac.daysInRange} día${vac.daysInRange !== 1 ? 's' : ''} de vacaciones`)
    if (vac.compensationPay > 0) notes.push('compensación de vacaciones')

    rows.push(`<tr class="${idx % 2 === 0 ? 'alt' : ''}">
      <td class="emp-cell">
        <div class="emp-name">${escapeHtml(emp.name)}</div>
        <div class="emp-code">${emp.employee_code ? escapeHtml(emp.employee_code) : ''}</div>
        ${notes.length ? `<div class="emp-note">${escapeHtml(notes.join(' · '))}</div>` : ''}
      </td>
      <td>${emp.department ? escapeHtml(emp.department) : '-'}</td>
      <td class="center">${daysWorked}d / ${Number(s.totalH || 0).toFixed(2)}h</td>
      <td class="money">$${monthlyToHourly(emp).toFixed(2)}</td>
      <td class="center">${Number(s.otHours || 0).toFixed(2)}</td>
      <td class="money">$${grossWithVac.toFixed(2)}</td>
      <td class="money">${deductions > 0 ? '-$' + deductions.toFixed(2) : '$0.00'}</td>
      <td class="money net">$${netWithVac.toFixed(2)}</td>
    </tr>`
    )

    if (s.retardoDesc > 0) {
      incidentRows.push(`<tr><td>${escapeHtml(emp.name)}</td><td>Retardos (${s.retardos})</td><td>${escapeHtml(weekStart)} al ${escapeHtml(weekEnd)}</td><td class="money">-$${s.retardoDesc.toFixed(2)}</td></tr>`)
    }
    if (s.incidentDesc > 0 || s.incidents > 0 || s.faltasInjustificadas > 0) {
      incidentRows.push(`<tr><td>${escapeHtml(emp.name)}</td><td>Incidencias${s.faltasInjustificadas > 0 ? ` / faltas (${s.faltasInjustificadas})` : ''}</td><td>${escapeHtml(weekStart)} al ${escapeHtml(weekEnd)}</td><td class="money">${s.incidentDesc > 0 ? '-$' + s.incidentDesc.toFixed(2) : '$0.00'}</td></tr>`)
    }

    signatureRows.push(`<div class="signature-row">
      <div>
        <div class="signature-name">${escapeHtml(emp.name)}</div>
        <div class="signature-code">${emp.employee_code ? escapeHtml(emp.employee_code) : 'Sin código'} · Neto: $${netWithVac.toFixed(2)}</div>
      </div>
      <div class="signature-block">
        <div class="signature-line"></div>
        <div class="signature-label">Firma de conformidad</div>
      </div>
    </div>`
    )

    for (const d of vac.details) {
      if (d.type === 'tomadas') {
        vacLines.push(`<tr>
          <td>${escapeHtml(emp.name)}</td><td>Vacaciones</td><td class="center">${d.days}d</td>
          <td>${escapeHtml(d.rangeStart)} al ${escapeHtml(d.rangeEnd)}</td>
          <td class="money">$${d.normalPay.toFixed(2)}</td>
          <td class="money">$${d.primaPay.toFixed(2)}<br/><span class="muted">prima ${d.primaPct}%</span></td>
        </tr>`)
      } else if (d.type === 'compensadas') {
        vacLines.push(`<tr>
          <td>${escapeHtml(emp.name)}</td><td>Compensación</td><td class="center">${d.days}d</td>
          <td>Finalizado ${escapeHtml(d.completedAt)}</td><td class="money">$0.00</td>
          <td class="money">$${d.amount.toFixed(2)}<br/><span class="muted">pago doble</span></td>
        </tr>`)
      }
    }
  })

  const vacSection = vacLines.length > 0
    ? `<section>
        <h2>Vacaciones y compensaciones</h2>
        <table class="detail-table">
          <thead><tr>
            <th>Empleado</th><th>Tipo</th><th class="center">Días</th><th>Período</th><th class="money">Pago base</th><th class="money">Prima / Comp.</th>
          </tr></thead>
          <tbody>${vacLines.join('')}</tbody>
        </table>
        <div class="section-note">Total vacaciones y compensaciones: <b>$${totalVac.toFixed(2)}</b></div>
       </section>`
    : ''

  const incidentSection = incidentRows.length > 0
    ? `<section>
        <h2>Incidencias aplicadas</h2>
        <table class="detail-table">
          <thead><tr><th>Empleado</th><th>Tipo</th><th>Fecha</th><th class="money">Descuento aplicado</th></tr></thead>
          <tbody>${incidentRows.join('')}</tbody>
        </table>
       </section>`
    : ''
  const issuedDate = new Date(cut.created_at || Date.now()).toLocaleDateString('es-MX')

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>Nómina ${escapeHtml(cut.start_date)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      @page { margin: 12mm; }
      body { font-family: 'Helvetica Neue', Arial, sans-serif; font-size: 9pt; color: #1f2937; line-height: 1.35; }
      .page { padding: 0; }
      table { width: 100%; border-collapse: collapse; }
      th { padding: 7px 8px; border-bottom: 1px solid #d1d5db; color: #4b5563; font-size: 8.5pt; font-weight: 700; text-align: left; }
      td { padding: 7px 8px; border-bottom: 1px solid #e5e7eb; vertical-align: top; }
      tfoot td { border-top: 1px solid #d1d5db; border-bottom: 0; font-weight: 700; }
      section { margin-top: 18px; }
      h1 { font-size: 20pt; letter-spacing: 0; line-height: 1.1; }
      h2 { font-size: 11pt; margin-bottom: 8px; }
      .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 18px; }
      .brand { display: flex; align-items: flex-start; gap: 12px; min-width: 0; }
      .logo { height: 42px; width: auto; object-fit: contain; }
      .subtitle { margin-top: 5px; color: #4b5563; font-size: 9pt; }
      .meta { min-width: 170px; text-align: right; color: #4b5563; font-size: 8.5pt; }
      .meta div { margin-bottom: 2px; }
      .alt { background: #fafafa; }
      .emp-cell { width: 25%; }
      .emp-name { font-weight: 700; color: #111827; }
      .emp-code, .muted, .section-note { color: #6b7280; font-size: 8pt; }
      .emp-note { margin-top: 2px; color: #6b7280; font-size: 8pt; }
      .center { text-align: center; }
      .money { text-align: right; white-space: nowrap; }
      .net { font-weight: 800; color: #111827; }
      .detail-table th, .detail-table td { font-size: 8.5pt; }
      .signatures { margin-top: 22px; }
      .signature-row { display: flex; align-items: flex-end; justify-content: space-between; gap: 24px; padding: 13px 0; border-bottom: 1px solid #e5e7eb; break-inside: avoid; }
      .signature-name { font-weight: 700; }
      .signature-code { margin-top: 2px; color: #6b7280; font-size: 8pt; }
      .signature-block { width: 48%; text-align: center; }
      .signature-line { border-bottom: 1px solid #6b7280; height: 18px; }
      .signature-label { margin-top: 4px; color: #6b7280; font-size: 8pt; }
      .legend { margin-top: 18px; padding-top: 10px; border-top: 1px solid #e5e7eb; color: #4b5563; font-size: 8.5pt; line-height: 1.45; }
      .footer { margin-top: 10px; padding-top: 8px; border-top: 1px solid #e5e7eb; color: #9ca3af; font-size: 8pt; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head><body><div class="page">

    <div class="header">
      <div class="brand">
        ${logoUrl ? `<img class="logo" src="${escapeHtml(logoUrl)}" alt="Logo"/>` : ''}
        <div>
          <h1>Nómina semanal</h1>
          <div class="subtitle">${escapeHtml(branchName || 'Sucursal sin nombre')} · Corte de ${escapeHtml(cut.start_date)} a ${escapeHtml(cut.end_date)}</div>
        </div>
      </div>
      <div class="meta">
        <div><b>Emisión:</b> ${escapeHtml(issuedDate)}</div>
        <div><b>Gerente:</b> ${escapeHtml(cut.closed_by_name || 'Gerente')}</div>
        ${cut.notes ? `<div><b>Notas:</b> ${escapeHtml(cut.notes)}</div>` : ''}
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Departamento</th>
          <th class="center">Días/Horas</th>
          <th class="money">Tarifa hora</th>
          <th class="center">HE (h)</th>
          <th class="money">Bruto</th>
          <th class="money">Deduc.</th>
          <th class="money">NETO</th>
        </tr>
      </thead>
      <tbody>${rows.join('')}</tbody>
      <tfoot>
        <tr>
          <td colspan="5">
            TOTALES · ${active.length} empleado${active.length !== 1 ? 's' : ''}
            ${totalVac > 0 ? `<span class="muted"> · incluye $${totalVac.toFixed(2)} de vacaciones/comp.</span>` : ''}
          </td>
          <td class="money">$${totalGross.toFixed(2)}</td>
          <td class="money">${totalDeductions > 0 ? '-$' + totalDeductions.toFixed(2) : '$0.00'}</td>
          <td class="money net">$${totalNet.toFixed(2)}</td>
        </tr>
      </tfoot>
    </table>

    ${incidentSection}
    ${vacSection}

    <section class="signatures">
      <h2>Firmas de conformidad</h2>
      ${signatureRows.join('')}
    </section>

    ${payrollLegend ? `
    <div class="legend">${escapeHtml(payrollLegend)}</div>` : ''}
    <div class="footer">CheckPro · Emitido ${escapeHtml(issuedDate)}</div>

  </div></body></html>`
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PayrollPage() {
  // Raw data (no filtering yet)
  const [allEmps, setAllEmps] = useState([])
  const [shifts, setShifts] = useState([])
  const [cuts, setCuts] = useState([])
  const [payrollIncidencias, setPayrollIncidencias] = useState([])
  const [vacPeriods, setVacPeriods] = useState([])
  const [tenantId, setTenantId] = useState(null)
  const [tenantData, setTenantData] = useState(null) // { config, name }
  // Rol + lista completa de sucursales + sucursal actualmente seleccionada.
  // - Gerente (role='manager'): queda FIJADO a su prof.branch_id, sin selector.
  // - Propietario (role='owner'|'super_admin'): puede cambiar la sucursal con
  //   un selector; por defecto arranca en su branch_id si tiene, si no en la
  //   primera activa. Cada sucursal se cierra POR SEPARADO.
  const [role, setRole] = useState(null)
  const [allBranches, setAllBranches] = useState([])
  const [selectedBranchId, setSelectedBranchId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cutNote, setCutNote] = useState('')
  const [closing, setClosing] = useState(false)
  const [printHTML, setPrintHTML] = useState(null)
  const [resolvingId, setResolvingId] = useState(null)
  const [exportingXLS, setExportingXLS] = useState(false)
  const [openPayrollIncidents, setOpenPayrollIncidents] = useState(0)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id,branch_id,role').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)
    setRole(prof.role || 'manager')
    const { data: tenant } = await supabase.from('tenants').select('config,name').eq('id', prof.tenant_id).single()
    setTenantData(tenant || null)
    // FIX: cargar sucursales reales (no de config JSONB).
    let branchQuery = supabase
      .from('branches')
      .select('id,name,config,active')
      .eq('tenant_id', prof.tenant_id)
      .eq('active', true)
      .order('created_at')
    if (prof.role === 'manager' && prof.branch_id) branchQuery = branchQuery.eq('id', prof.branch_id)
    const { data: branchData } = await branchQuery
    const branchList = branchData || []
    setAllBranches(branchList)
    const isOwnerRole = prof.role === 'owner' || prof.role === 'super_admin'
    // Preservar la selección actual del owner si ya estaba eligiendo una sucursal.
    // Para gerente, siempre forzar a su branch_id (no le permitimos cambiar).
    setSelectedBranchId(cur => {
      if (!isOwnerRole) return prof.branch_id || branchList[0]?.id || null
      if (cur && branchList.some(b => b.id === cur)) return cur
      return prof.branch_id || branchList[0]?.id || null
    })
    // FIX: branch isolation server-side
    const isManagerBranch = prof.role === 'manager' && !!prof.branch_id
    let empQuery = supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).eq('status', 'active').eq('has_shift', true)
    let shiftQuery = supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).order('date_str', { ascending: false })
    let cutQuery = supabase.from('week_cuts').select('*').eq('tenant_id', prof.tenant_id).order('created_at', { ascending: false })
    if (isManagerBranch) {
      empQuery = empQuery.eq('branch_id', prof.branch_id)
      shiftQuery = shiftQuery.eq('branch_id', prof.branch_id)
      cutQuery = cutQuery.eq('branch_id', prof.branch_id)
    }
    const [{ data: empData }, { data: shiftData }, { data: cutData }] = await Promise.all([
      empQuery,
      shiftQuery,
      cutQuery,
    ])
    const empIds = (empData || []).map(e => e.id)
    let vacQuery = supabase.from('vacation_periods')
      .select('id,employee_id,tipo,status,start_date,end_date,prima_pct,entitled_days,compensated_days,compensated_amount,completed_at')
      .eq('tenant_id', prof.tenant_id)
    if (isManagerBranch) vacQuery = empIds.length ? vacQuery.in('employee_id', empIds) : null
    let incQuery = supabase
      .from('incidencias')
      .select('id,employee_id,kind,status,date_str')
      .eq('tenant_id', prof.tenant_id)
    if (isManagerBranch) incQuery = empIds.length ? incQuery.in('employee_id', empIds) : null
    const [{ data: vacData }, { data: incData }] = await Promise.all([
      vacQuery ? vacQuery : Promise.resolve({ data: [] }),
      incQuery ? incQuery : Promise.resolve({ data: [] }),
    ])
    setAllEmps(empData || [])
    setShifts(shiftData || [])
    setCuts(cutData || [])
    setVacPeriods(vacData || [])
    setPayrollIncidencias(incData || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  // ── Valores derivados de la sucursal seleccionada ──────────────────────────
  const isOwner = role === 'owner' || role === 'super_admin'
  const myBranch = allBranches.find(b => b.id === selectedBranchId) || null
  const myBranchId = myBranch?.id || null
  const myBranchName = myBranch?.name || ''
  // cfg = tenant.config + branch.config override. Se recalcula al cambiar de sucursal.
  const cfg = {
    ...(tenantData?.config || {}),
    ...(myBranch?.config || {}),
    branchName: myBranch?.name || tenantData?.name || tenantData?.config?.branchName || '',
    payrollLegend: (myBranch?.config?.payrollLegend
                    || tenantData?.config?.payrollLegend
                    || DEFAULT_PAYROLL_LEGEND),
  }
  // FIX BUG: filtrar empleados por la sucursal seleccionada (columna real
  // branch_id con fallback legacy schedule.branch.id). Si no hay sucursal
  // elegida y no hay sucursales en el tenant, caemos a TODOS (tenant sin
  // migrar aún).
  const emps = myBranch
    ? allEmps.filter(e => {
        const bid = e.branch_id || e.schedule?.branch?.id
        return bid === myBranch.id
      })
    : (allBranches.length === 0 ? allEmps : [])

  const closingDay = cfg.weekClosingDay || 'dom'
  // FIX bug ventana gracia: weekRange(refDate, closingDay) devuelve la semana
  // que TERMINA en el proximo closingDay. Si hoy es closingDay+1 (gracia), eso
  // calcularia la semana SIGUIENTE (que aun no ocurrio). Ajustamos refDate a
  // "ayer" cuando estamos en gracia para que apunte al closingDay recien pasado.
  const todayKeyForRange = dayKey(new Date())
  const closingNextDay = DAYS[(DAYS.indexOf(closingDay) + 1) % 7]
  const isGraceDayForRange = todayKeyForRange === closingNextDay && todayKeyForRange !== closingDay
  const refDate = isGraceDayForRange
    ? new Date(Date.now() - 24 * 60 * 60 * 1000)
    : new Date()
  const range = weekRange(refDate, closingDay)
  const weekStartStr = isoDate(range.start)
  const weekEndStr = isoDate(range.end)
  // Turnos de la semana SOLO de empleados de mi sucursal (anti doble pago
  // entre sucursales si una persona aparece en ambas por algún bug viejo).
  const myEmpIds = new Set(emps.map(e => e.id))
  const weekShifts = shifts.filter(s =>
    s.date_str >= weekStartStr &&
    s.date_str <= weekEndStr &&
    myEmpIds.has(s.employee_id)
  )
  // FIX shifts huerfanos: si el gerente cierra el closingDay a media tarde,
  // los shifts que se crean despues quedan con date_str del closingDay y sin
  // week_cut_id, fuera de cualquier rango futuro. Rescatamos en el siguiente
  // cierre todos los shifts de la sucursal con week_cut_id IS NULL y date_str
  // anterior al weekStartStr (ventana de 30 dias para evitar rescatar shifts
  // muy viejos por errores historicos).
  const HUERFANO_LOOKBACK_DAYS = 30
  const orphanCutoff = (() => {
    const d = new Date(`${weekStartStr}T12:00:00Z`)
    d.setDate(d.getDate() - HUERFANO_LOOKBACK_DAYS)
    return isoDate(d)
  })()
  const orphanShifts = shifts.filter(s =>
    !s.week_cut_id &&
    s.date_str < weekStartStr &&
    s.date_str >= orphanCutoff &&
    myEmpIds.has(s.employee_id) &&
    ['closed', 'incident', 'absent'].includes(s.status)
  )
  const incidentShifts = weekShifts.filter(s => s.status === 'incident')
  // FIX: nomina cuenta incidencias reales del periodo desde tabla incidencias.
  const payrollIncidenciasForWeek = payrollIncidencias.filter(i =>
    i.date_str >= weekStartStr &&
    i.date_str <= weekEndStr &&
    myEmpIds.has(i.employee_id)
  )
  const hasUnresolved = incidentShifts.length > 0 || openPayrollIncidents > 0

  // FIX: permitir cierre el día configurado y una ventana de gracia de 24h.
  // dayKey() usa hora local (no UTC) — el gerente cierra cuando es ese día
  // en su zona horaria.
  const todayKey = todayKeyForRange // FIX: reutilizar el ya calculado para rango.

  // Cortes anteriores: filtrar a los que tocan turnos de MI sucursal.
  const cutsForBranch = myBranchId
    ? cuts.filter(c => {
        if (c.branch_id === myBranchId) return true
        if (!c.shift_ids || c.shift_ids.length === 0) return false
        // Un corte "es de mi sucursal" si al menos uno de sus shifts pertenece
        // a un empleado de mi sucursal. Funciona para cortes nuevos (que solo
        // incluyen turnos de mi sucursal) y para legacy mixtos.
        return c.shift_ids.some(sid => {
          const sh = shifts.find(s => s.id === sid)
          return sh && myEmpIds.has(sh.employee_id)
        })
      })
    : cuts
  // FIX: bloquear recierre del periodo y habilitar reimpresión del corte existente.
  const nextClosingDay = closingNextDay // FIX: reutilizar el ya calculado.
  const isClosingDayOrNextDay = todayKey === closingDay || todayKey === nextClosingDay
  const currentWeekCut = cutsForBranch.find(c => c.start_date === weekStartStr && c.end_date === weekEndStr) || null
  const weekAlreadyClosed = !!currentWeekCut
  const isGraceDay = isGraceDayForRange // FIX: reutilizar el ya calculado.
  // FIX precision: bloquear cierre el closingDay si hay turnos abiertos del dia.
  // Esto evita crear shifts huerfanos en primer lugar. El gerente debe esperar a
  // que los empleados cierren sus turnos, o cerrar al dia siguiente en periodo
  // de gracia (cuando ya todos los shifts del closingDay tienen su exit_time fijo).
  const openShiftsToday = shifts.filter(s =>
    s.date_str === weekEndStr &&
    myEmpIds.has(s.employee_id) &&
    s.status === 'open'
  )
  const blockedByOpenShifts = todayKey === closingDay && openShiftsToday.length > 0
  const canCloseToday = isClosingDayOrNextDay && !weekAlreadyClosed && !blockedByOpenShifts

  // Agrupa vacation_periods por employee_id para lookup rapido
  const vacByEmp = {}
  for (const p of vacPeriods) {
    if (!vacByEmp[p.employee_id]) vacByEmp[p.employee_id] = []
    vacByEmp[p.employee_id].push(p)
  }

  // ── Resolve an incident shift ─────────────────────────────────────────────
  useEffect(() => {
    setOpenPayrollIncidents(0)
  }, [selectedBranchId, weekStartStr, weekEndStr])

  async function countOpenPeriodIncidents(supabase, startStr, endStr) {
    if (!tenantId || myEmpIds.size === 0) return 0
    // FIX: cierre nomina bloquea incidencias abiertas
    const { count, error } = await supabase
      .from('incidencias')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', tenantId)
      .eq('status', 'open')
      .gte('date_str', startStr)
      .lte('date_str', endStr)
      .in('employee_id', [...myEmpIds])
    if (error) {
      console.error('[payroll] open incidencias check error:', error)
      throw error
    }
    return count || 0
  }

  async function resolveIncident(shiftId, action) {
    setResolvingId(shiftId)
    const supabase = createClient()
    const note = action === 'approve' ? 'Aprobado por gerente' : 'Descuento aplicado por gerente'
    // FIX: antes se swallowed el error silently — si RLS bloqueaba la update
    // el toast de exito salia igual y el gerente no se enteraba.
    const { error: uErr } = await supabase.from('shifts').update({
      status: 'closed',
      incidents: [{ resolved: true, action, note, resolvedAt: new Date().toISOString() }]
    }).eq('id', shiftId)
    if (uErr) {
      console.error('[payroll] resolveIncident error:', uErr)
      toast.error(`No se pudo resolver: ${uErr.message}`)
      setResolvingId(null)
      return
    }
    toast.success(action === 'approve' ? 'Incidencia aprobada ✓' : 'Descuento aplicado')
    setResolvingId(null)
    await load()
  }

  // ── Close week ────────────────────────────────────────────────────────────
  async function closeWeek() {
    if (incidentShifts.length > 0) {
      toast.error(`Resuelve las ${incidentShifts.length} incidencia(s) antes de cerrar la semana`)
      return
    }
    if (openPayrollIncidents > 0) {
      toast.error(`Hay ${openPayrollIncidents} incidencia(s) abierta(s) en el periodo. Resuelvelas antes de cerrar el corte.`)
      return
    }
    // FIX: no permitir recerrar una semana ya cerrada.
    if (weekAlreadyClosed) {
      toast.error('Esta semana ya está cerrada. Reimprime el reporte existente.')
      return
    }
    // FIX: bloquear cierre fuera del día de corte o su ventana de gracia.
    if (!isClosingDayOrNextDay) {
      toast.error(`El corte se puede cerrar los ${DAY_FL[closingDay]} y ${DAY_FL[nextClosingDay]}. Hoy es ${DAY_FL[todayKey]}.`)
      return
    }
    // FIX precision: bloquear cierre el closingDay con turnos abiertos del dia.
    if (blockedByOpenShifts) {
      toast.error(`Hay ${openShiftsToday.length} turno(s) abierto(s) de hoy. Espera a que cierren o cierra mañana en periodo de gracia.`)
      return
    }
    if (!myBranchId) {
      toast.error('No se detectó tu sucursal. Revisa tu perfil en Configuración.')
      return
    }
    setClosing(true)
    const supabase = createClient()
    const startStr = isoDate(range.start), endStr = isoDate(range.end)
    let openIncCount = 0
    try {
      openIncCount = await countOpenPeriodIncidents(supabase, startStr, endStr)
    } catch (e) {
      toast.error('No se pudieron validar incidencias abiertas antes del corte')
      setClosing(false)
      return
    }
    if (openIncCount > 0) {
      setOpenPayrollIncidents(openIncCount)
      toast.error(`Hay ${openIncCount} incidencia(s) abierta(s) en el periodo. Resuelvelas antes de cerrar el corte.`)
      setClosing(false)
      return
    }
    // FIX: rescatar shifts huerfanos previos (cerrados en cortes anteriores
    // del mismo dia que quedaron sin week_cut_id) para evitar perdidas.
    const uncutWeek = weekShifts.filter(s => !s.week_cut_id && ['closed', 'incident', 'absent'].includes(s.status))
    const uncutShifts = [...uncutWeek, ...orphanShifts]
    const orphanCount = orphanShifts.length
    const { data: cut, error } = await supabase.from('week_cuts').insert({
      tenant_id: tenantId, start_date: startStr, end_date: endStr,
      branch_id: myBranchId,
      closed_by_name: 'Gerente', notes: cutNote, paid: true,
      shift_ids: uncutShifts.map(s => s.id)
    }).select().single()
    if (error) { toast.error('Error al cerrar semana'); setClosing(false); return }
    // FIX: antes se swallowed el error — si week_cut_id no se pega a los shifts,
    // el week_cut existe pero la proxima semana re-incluye los mismos turnos =
    // doble pago. Surface con toast.error y rollback del week_cut.
    const { error: linkErr } = await supabase.from('shifts').update({ week_cut_id: cut.id }).in('id', uncutShifts.map(s => s.id))
    if (linkErr) {
      console.error('[payroll] link shifts→week_cut error:', linkErr)
      // Rollback: borrar el week_cut recien creado para que no quede huerfano.
      await supabase.from('week_cuts').delete().eq('id', cut.id)
      toast.error(`No se pudo vincular los turnos: ${linkErr.message}`)
      setClosing(false)
      return
    }
    await supabase.from('audit_log').insert({
      tenant_id: tenantId, action: 'WEEK_CUT', employee_name: 'Gerente',
      detail: `${startStr}→${endStr}${orphanCount > 0 ? ` · ${orphanCount} turnos rescatados de cortes previos` : ''}`, success: true
    })
    toast.success(orphanCount > 0
      ? `Semana cerrada · ${orphanCount} turnos pendientes de cortes previos rescatados`
      : 'Semana cerrada exitosamente')

    // Fanout: generar archivo semanal en paralelo con el corte.
    // Llama /api/archive/generate-week con cookie de admin (no bloquea el UI del corte).
    const archiveToast = toast.loading('Generando archivo semanal…')
    try {
      const res = await fetch('/api/archive/generate-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart: startStr, weekEnd: endStr }),
      })
      const json = await res.json().catch(() => ({}))
      if (res.ok && json?.ok) {
        toast.success(`Archivo generado (${json.filesGenerated} archivos)`, { id: archiveToast, duration: 5000 })
      } else {
        toast.error(`Archivo: ${json?.error || 'error'}`, { id: archiveToast, duration: 6000 })
      }
    } catch (e) {
      toast.error('Archivo: error de red', { id: archiveToast, duration: 6000 })
    }

    await load()
    const { data: fresh, error: freshErr } = await supabase.from('week_cuts').select('*').eq('id', cut.id).single()
    if (freshErr || !fresh) {
      console.error('Error recargando corte:', freshErr)
      toast.error('No se pudo cargar el reporte del corte')
      setClosing(false)
      return
    }
    setPrintHTML(buildReportHTML(fresh, uncutShifts, emps, cfg?.branchName, cfg?.logoUrl, cfg?.payrollLegend, vacByEmp, cfg?.coveragePayMode ?? 'covered'))
    setClosing(false)
  }

  function openReport(cut) {
    const ws = shifts.filter(s => cut.shift_ids?.includes(s.id))
    setPrintHTML(buildReportHTML(cut, ws, emps, cfg?.branchName, cfg?.logoUrl, cfg?.payrollLegend, vacByEmp, cfg?.coveragePayMode ?? 'covered'))
  }

  // ── Exportar XLS del corte ───────────────────────────────────────────────
  async function handleExportPayrollXLS(cut, cutShifts) {
    setExportingXLS(true)
    try {
      const { generatePayrollXLSX } = await import('@/lib/export-xlsx')
      generatePayrollXLSX({
        cut,
        weekShifts: cutShifts,
        emps,
        branchName: cfg?.branchName || myBranchName,
        empWeekSummaryFn: empWeekSummary,
        coveragePayMode: cfg?.coveragePayMode ?? 'covered',
        vacationPeriods: vacPeriods,
      })
      toast.success('Archivo generado correctamente')
    } catch (err) {
      console.error('[export-payroll-xlsx]', err)
      toast.error('Error al exportar: ' + err.message)
    }
    setExportingXLS(false)
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  // Aviso si no hay ninguna sucursal configurada para este tenant.
  if (allBranches.length === 0) {
    return (
      <div className="p-4 md:p-6 max-w-2xl">
        <h1 className="text-2xl font-extrabold text-white mb-2">Nómina</h1>
        <div className="card text-center py-10">
          <div className="flex justify-center mb-3 text-gray-500"><Building2 size={40} /></div>
          <p className="text-gray-400 text-sm mb-2">No hay sucursales configuradas.</p>
          <p className="text-gray-400 text-xs">Ve a <span className="text-brand-400">Configuración → Sucursales</span> para crear al menos una antes de generar cortes de nómina.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-6">
        <div className="page-eyebrow mb-2">Cortes · Semana en curso</div>
        <h1 className="page-title">Nómina</h1>
        <p className="text-[13px] font-mono mt-1.5" style={{ color: 'var(--cp-text-muted)' }}>
          Corte de {weekStartStr} a {weekEndStr}
        </p>
        <p className="text-brand-400/90 text-xs font-mono mt-1 flex items-center gap-1.5">
          <Building2 size={12} /> {myBranchName || 'Sucursal sin nombre'} · CORTE: {DAY_FL[closingDay]} / {DAY_FL[nextClosingDay]}
        </p>
      </div>

      {/* ── Selector de sucursal (solo propietario con >1 sucursal) ────────── */}
      {isOwner && allBranches.length > 1 && (
        <div className="card mb-4">
          <div className="flex items-center justify-between gap-3 mb-2">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Sucursal a cerrar</p>
            <span className="text-[9px] font-mono text-orange-400/80">
              Cada sucursal se cierra por separado
            </span>
          </div>
          <select
            className="input text-sm"
            value={selectedBranchId || ''}
            onChange={e => setSelectedBranchId(e.target.value)}
          >
            {allBranches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-400 font-mono mt-1.5">
            💡 Cambia de sucursal para generar el corte de cada una. Los empleados, turnos e incidencias se filtran automáticamente.
          </p>
        </div>
      )}

      {/* ── Aviso cuando el gerente no tiene sucursal asignada ──────────── */}
      {!isOwner && !myBranchId && (
        <div className="px-4 py-3 mb-4 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm font-bold">🚫 No tienes sucursal asignada</p>
          <p className="text-red-400/70 text-xs mt-0.5">
            Pídele al propietario de la empresa que te asigne una sucursal desde <span className="font-bold">Configuración → Equipo</span>.
          </p>
        </div>
      )}

      {/* ── Revisión de incidencias (requerida antes del corte) ─────────────── */}
      {incidentShifts.length > 0 && (
        <div className="mb-6">
          <div className="px-4 py-3 mb-3 bg-red-500/10 border border-red-500/30 rounded-xl">
            <p className="text-red-400 text-sm font-bold">
              🚩 {incidentShifts.length} incidencia{incidentShifts.length > 1 ? 's' : ''} pendiente{incidentShifts.length > 1 ? 's' : ''} de revisión
            </p>
            <p className="text-red-400/70 text-xs mt-0.5">
              El gerente debe resolver todas las incidencias antes de generar el corte de nómina.
            </p>
          </div>

          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Revisar Incidencias</p>
          <div className="space-y-2">
            {incidentShifts.map(sh => {
              const emp = emps.find(e => e.id === sh.employee_id)
              if (!emp) return null
              const isResolving = resolvingId === sh.id
              return (
                <div key={sh.id} className="card border-l-4 border-l-red-400">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-bold text-white text-sm">{emp.name}</div>
                      <div className="text-xs text-gray-400 font-mono mt-0.5">
                        {sh.date_str} · Entrada: {fmtTime(sh.entry_time)}
                        {sh.exit_time ? ` · Salida: ${fmtTime(sh.exit_time)}` : ' · ⚠ Sin salida'}
                        {sh.duration_hours ? ` · ${sh.duration_hours}h` : ''}
                      </div>
                      <div className="text-xs text-gray-500 mt-1">
                        {sh.classification?.label || 'Sin clasificación'}
                        {sh.incidents?.map((inc, i) => (
                          <span key={i} className="ml-2 text-orange-400">{inc.note || inc.type || ''}</span>
                        ))}
                      </div>
                    </div>
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        onClick={() => resolveIncident(sh.id, 'approve')}
                        disabled={isResolving}
                        className="px-3 py-1.5 bg-green-500/15 border border-green-500/30 rounded-lg text-green-400 text-xs font-semibold active:bg-green-500/25 disabled:opacity-40">
                        ✓ Aprobar
                      </button>
                      <button
                        onClick={() => resolveIncident(sh.id, 'deduct')}
                        disabled={isResolving}
                        className="px-3 py-1.5 bg-orange-500/15 border border-orange-500/30 rounded-lg text-orange-400 text-xs font-semibold active:bg-orange-500/25 disabled:opacity-40">
                        − Descontar
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* ── Resumen de la semana por empleado ─────────────────────────────── */}
      {openPayrollIncidents > 0 && (
        <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-xl">
          <p className="text-red-400 text-sm font-bold">
            Hay {openPayrollIncidents} incidencia(s) abierta(s) en el periodo. Resuelvelas antes de cerrar el corte.
          </p>
          <button
            onClick={() => { window.location.href = '/dashboard/incidencias?status=open' }}
            className="mt-3 px-3 py-1.5 bg-red-500/15 border border-red-500/30 rounded-lg text-red-300 text-xs font-semibold active:bg-red-500/25">
            Ir a incidencias
          </button>
        </div>
      )}

      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Resumen semanal</p>
      <div className="space-y-2 mb-6">
        {emps.map(emp => {
          // FIX R6: pasar coveragePayMode del tenant (antes se usaba default)
          const s = empWeekSummary(emp, weekShifts, emps, cfg?.coveragePayMode ?? 'covered')
          const vac = vacationPayForWeek(emp, vacByEmp[emp.id] || [], weekStartStr, weekEndStr)
          const grossWithVac = s.grossPay + vac.totalVacationPay
          const netWithVac = Math.max(0, grossWithVac - s.retardoDesc - s.incidentDesc)
          const realIncidents = payrollIncidenciasForWeek.filter(i => i.employee_id === emp.id)
          const totalIncidentCount = s.incidents + realIncidents.length
          return (
            <div key={emp.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-bold text-white text-sm break-words">{emp.name}</div>
                  <div className="text-xs text-gray-400">{emp.department} · ${monthlyToHourly(emp).toFixed(2)}/h</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-extrabold text-brand-400 font-mono">${netWithVac.toFixed(0)}</div>
                  <div className="text-[9px] text-gray-400 font-mono">NETO EST.</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-gray-400 font-mono mb-2">
                <span>{s.totalH}h trabajadas</span>
                {s.otHours > 0 && <span className="text-blue-400">+{s.otHours}h extra (×2)</span>}
                <span>Bruto: ${grossWithVac.toFixed(2)}</span>
                {s.retardoDesc > 0 && <span className="text-orange-400">-${s.retardoDesc.toFixed(2)} retardos</span>}
                {s.incidentDesc > 0 && <span className="text-red-400">-${s.incidentDesc.toFixed(2)} incid.</span>}
                {vac.daysInRange > 0 && (
                  <span className="text-purple-300">🏖 {vac.daysInRange}d vac. (${(vac.normalPay + vac.primaPay).toFixed(2)})</span>
                )}
                {vac.compensationPay > 0 && (
                  <span className="text-purple-300">💰 comp. ${vac.compensationPay.toFixed(2)}</span>
                )}
              </div>
              <div className="flex gap-1.5 flex-wrap">
                {s.retardos > 0 && <span className="badge-orange">{s.retardos} retardo{s.retardos > 1 ? 's' : ''}</span>}
                {totalIncidentCount > 0 && <span className="badge-red">{totalIncidentCount} incidencia{totalIncidentCount > 1 ? 's' : ''}</span>}
                {s.otHours > 0 && <span className="px-2 py-0.5 bg-blue-500/10 border border-blue-500/20 rounded-full text-blue-400 text-[10px] font-semibold">{s.otHours}h extra</span>}
                {vac.daysInRange > 0 && (
                  <span className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 rounded-full text-purple-300 text-[10px] font-semibold">
                    🏖 {vac.daysInRange}d vacaciones · prima ${vac.primaPay.toFixed(0)}
                  </span>
                )}
                {vac.compensationPay > 0 && (
                  <span className="px-2 py-0.5 bg-purple-500/10 border border-purple-500/30 rounded-full text-purple-300 text-[10px] font-semibold">
                    💰 Compensación ×2 = ${vac.compensationPay.toFixed(0)}
                  </span>
                )}
                {s.retardos === 0 && totalIncidentCount === 0 && s.otHours === 0 && vac.daysInRange === 0 && vac.compensationPay === 0 && (
                  <span className="badge-green">Sin incidencias ✓</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Corte semanal ─────────────────────────────────────────────────── */}
      <div className={`card mb-4 ${hasUnresolved || !canCloseToday ? 'opacity-60' : ''}`}>
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Corte semanal</p>
        <p className="text-[11px] text-gray-400 font-mono mb-3">Corte de {weekStartStr} a {weekEndStr}</p>
        {/* FIX info: rescate de turnos huerfanos de cortes previos (safety net). */}
        {orphanShifts.length > 0 && !weekAlreadyClosed && (
          <div className="px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs">
            <strong>{orphanShifts.length} turno{orphanShifts.length > 1 ? 's' : ''} pendiente{orphanShifts.length > 1 ? 's' : ''}</strong> de cortes anteriores se incluirán en este corte.
          </div>
        )}
        {/* FIX precision: bloquear cierre con shifts abiertos del closingDay. */}
        {blockedByOpenShifts && !weekAlreadyClosed && (
          <div className="px-3 py-2 mb-3 bg-orange-500/10 border border-orange-500/30 rounded-lg text-orange-300 text-xs">
            <strong>{openShiftsToday.length} turno{openShiftsToday.length > 1 ? 's' : ''} abierto{openShiftsToday.length > 1 ? 's' : ''}</strong> de hoy ({DAY_FL[closingDay]}). Espera a que cierren para preservar la fecha exacta de cada turno, o cierra mañana ({DAY_FL[nextClosingDay]}) en período de gracia.
          </div>
        )}
        {weekAlreadyClosed && currentWeekCut && (
          <div className="px-3 py-2 mb-3 bg-green-500/10 border border-green-500/20 rounded-lg text-green-400 text-xs font-semibold">
            Semana ya cerrada el {fmtDate(currentWeekCut.created_at)}{currentWeekCut.closed_by_name ? ` por ${currentWeekCut.closed_by_name}` : ''}
          </div>
        )}
        {isGraceDay && !weekAlreadyClosed && (
          <div className="px-3 py-2 mb-3 bg-blue-500/10 border border-blue-500/20 rounded-lg text-blue-300 text-xs font-semibold">
            Periodo de gracia activo (24h después del cierre regular). Cierra hoy o se mantendrá abierto.
          </div>
        )}
        {hasUnresolved && (
          <div className="px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-semibold">
            <span className="inline-flex items-center gap-1.5"><Lock size={12} /> Resuelve todas las incidencias para habilitar el corte</span>
          </div>
        )}
        {!isClosingDayOrNextDay && !hasUnresolved && !weekAlreadyClosed && (
          <div className="px-3 py-2 mb-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400 text-xs font-semibold">
            El corte de <span className="text-white">{myBranchName || 'esta sucursal'}</span> se puede cerrar los {DAY_FL[closingDay]} y {DAY_FL[nextClosingDay]}. Hoy es {DAY_FL[todayKey]}.
          </div>
        )}
        <div className="mb-3">
          <label className="label">Notas del corte (opcional)</label>
          <input className="input text-sm" placeholder="Observaciones de la semana..."
            value={cutNote} onChange={e => setCutNote(e.target.value)} disabled={hasUnresolved || !canCloseToday || weekAlreadyClosed} />
        </div>
        <div className="flex gap-2 flex-wrap">
          <button onClick={closeWeek} disabled={closing || hasUnresolved || !canCloseToday || weekAlreadyClosed}
            className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed flex-1">
            <span className="inline-flex items-center justify-center gap-1.5">
              {closing ? <><Loader2 size={14} className="animate-spin" /> Cerrando...</> : weekAlreadyClosed ? <><Lock size={14} /> Semana ya cerrada</> : blockedByOpenShifts ? <><Lock size={14} /> Espera turnos abiertos</> : !isClosingDayOrNextDay ? <><Lock size={14} /> Disponible {DAY_FL[closingDay]} / {DAY_FL[nextClosingDay]}</> : <><Printer size={14} /> Cerrar semana e imprimir reporte</>}
            </span>
          </button>
          {weekAlreadyClosed && currentWeekCut && (
            <button
              onClick={() => openReport(currentWeekCut)}
              className="flex items-center gap-1.5 px-3 py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-semibold text-white active:bg-dark-600 shrink-0">
              <Printer size={14} /> Reimprimir reporte
            </button>
          )}
          {weekShifts.length > 0 && (
            <button
              onClick={() => handleExportPayrollXLS(
                { start_date: weekStartStr, end_date: weekEndStr, closed_by_name: 'Gerente', notes: cutNote },
                weekShifts
              )}
              disabled={exportingXLS}
              className="flex items-center gap-1.5 px-3 py-2 bg-green-500/15 border border-green-500/30 rounded-xl text-xs font-semibold text-green-400 active:bg-green-500/25 disabled:opacity-40 shrink-0">
              {exportingXLS ? <Loader2 size={14} className="animate-spin" /> : <><FileSpreadsheet size={14} /> Exportar</>}
            </button>
          )}
        </div>
      </div>

      {/* ── Cortes anteriores ─────────────────────────────────────────────── */}
      {cutsForBranch.length > 0 && (
        <div>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">
            Cortes anteriores {myBranchName && <span className="normal-case text-gray-600">· {myBranchName}</span>}
          </p>
          <div className="space-y-2">
            {cutsForBranch.map(c => (
              <div key={c.id} className="card-sm flex items-center justify-between gap-3">
                <div>
                  <div className="font-semibold text-sm text-white">{c.start_date} → {c.end_date}</div>
                  <div className="text-xs text-gray-500">{c.closed_by_name} · {c.notes || 'Sin notas'}</div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <button onClick={() => openReport(c)}
                    className="px-3 py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white active:bg-dark-600">
                    <Printer size={14} />
                  </button>
                  <button
                    onClick={() => handleExportPayrollXLS(c, shifts.filter(s => c.shift_ids?.includes(s.id)))}
                    disabled={exportingXLS}
                    className="px-3 py-2 bg-green-500/15 border border-green-500/30 rounded-xl text-xs font-bold text-green-400 active:bg-green-500/25 disabled:opacity-40">
                    <FileSpreadsheet size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Print modal ────────────────────────────────────────────────────── */}
      {printHTML && (
        <div className="fixed inset-0 z-[500] bg-white flex flex-col">
          <div className="flex gap-3 items-center p-3 bg-dark-900 border-b border-dark-border shrink-0 no-print">
            <button onClick={() => window.print()}
              className="flex items-center gap-2 px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl">
              <Printer size={16} /> Imprimir / Guardar PDF
            </button>
            <button onClick={() => setPrintHTML(null)}
              className="flex items-center gap-2 px-4 py-2 bg-dark-700 border border-dark-border text-white text-sm font-semibold rounded-xl">
              <X size={16} /> Cerrar
            </button>
            <span className="text-xs text-gray-500 font-mono hidden md:block">Todos los empleados en una sola hoja</span>
          </div>
          <iframe srcDoc={printHTML} className="flex-1 border-0 w-full" title="Reporte semanal" />
        </div>
      )}
    </div>
  )
}
