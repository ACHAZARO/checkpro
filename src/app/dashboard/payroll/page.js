'use client'
// src/app/dashboard/payroll/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { isoDate, weekRange, empWeekSummary, monthlyToHourly, fmtTime, fmtDate } from '@/lib/utils'
import toast from 'react-hot-toast'

// ── Calculo de salario diario para PAGO DE VACACIONES ─────────────────────
// BUG 4: LFT art. 89 dicta salario diario = monthly_salary / 30.
// Se usa 30 fijo (no workDaysPerWeek*52/12) para que jornadas de <5 dias
// no inflen el diario. Coincide con lib/vacations.js computeCompensationAmount.
function computeDailyRate(emp) {
  if (!emp) return 0
  const salary = Number(emp.monthly_salary) || 0
  return salary / 30
}

// Numero de dias entre dos fechas ISO (inclusive) que intersectan [aStart, aEnd]
// con [bStart, bEnd]. Todos como strings YYYY-MM-DD.
function daysIntersect(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0
  const s = aStart > bStart ? aStart : bStart
  const e = aEnd < bEnd ? aEnd : bEnd
  if (s > e) return 0
  // Diferencia en dias inclusive
  const d1 = new Date(s + 'T12:00:00')
  const d2 = new Date(e + 'T12:00:00')
  return Math.round((d2 - d1) / (24 * 3600 * 1000)) + 1
}

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
function vacationPayForWeek(emp, periodsForEmp, weekStart, weekEnd) {
  const dailyRate = computeDailyRate(emp)
  let daysInRange = 0
  let normalPay = 0
  let primaPay = 0
  let compensationPay = 0
  const details = []

  for (const p of periodsForEmp || []) {
    const tipo = p.tipo || 'tomadas'
    const status = p.status
    if (tipo === 'tomadas' && (status === 'active' || status === 'completed')) {
      const startStr = String(p.start_date || '').slice(0, 10)
      const endStr = String(p.end_date || '').slice(0, 10)
      const days = daysIntersect(startStr, endStr, weekStart, weekEnd)
      if (days > 0) {
        const pct = Number(p.prima_pct) || 0
        const baseNormal = days * dailyRate
        const basePrima = baseNormal * (pct / 100)
        daysInRange += days
        normalPay += baseNormal
        primaPay += basePrima
        details.push({
          type: 'tomadas',
          periodId: p.id,
          days,
          rangeStart: startStr,
          rangeEnd: endStr,
          primaPct: pct,
          normalPay: baseNormal,
          primaPay: basePrima,
        })
      }
    } else if (tipo === 'compensadas') {
      const completedAt = p.completed_at ? String(p.completed_at).slice(0, 10) : null
      if (completedAt && completedAt >= weekStart && completedAt <= weekEnd) {
        const amt = Number(p.compensated_amount) || 0
        compensationPay += amt
        details.push({
          type: 'compensadas',
          periodId: p.id,
          days: Number(p.compensated_days) || 0,
          completedAt,
          amount: amt,
        })
      }
    }
  }

  return {
    dailyRate: Math.round(dailyRate * 100) / 100,
    daysInRange,
    normalPay: Math.round(normalPay * 100) / 100,
    primaPay: Math.round(primaPay * 100) / 100,
    compensationPay: Math.round(compensationPay * 100) / 100,
    totalVacationPay: Math.round((normalPay + primaPay + compensationPay) * 100) / 100,
    details,
  }
}

// FIX 10: escape HTML en todas las interpolaciones de datos del cliente
// dentro del HTML del reporte (corre en un iframe same-origin). Previene XSS
// si un gerente pega algo como "<img src=x onerror=...>" en notas del corte,
// nombres de empleado, departamentos o la leyenda.
function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}

// ── Compact single-page report ───────────────────────────────────────────────
function buildReportHTML(cut, weekShifts, employees, branchName, logoUrl, payrollLegend, vacByEmp) {
  const active = employees.filter(e => e.has_shift)
  let totalNet = 0
  let totalGross = 0
  let totalVac = 0

  const weekStart = cut.start_date
  const weekEnd = cut.end_date

  const rows = active.map(emp => {
    const s = empWeekSummary(emp, weekShifts, employees)
    const vac = vacationPayForWeek(emp, (vacByEmp && vacByEmp[emp.id]) || [], weekStart, weekEnd)
    // Para la UI del reporte, sumamos la paga de vacaciones al neto/bruto.
    const grossWithVac = s.grossPay + vac.totalVacationPay
    const netWithVac = Math.max(0, grossWithVac - s.retardoDesc - s.incidentDesc)
    totalGross += grossWithVac
    totalNet += netWithVac
    totalVac += vac.totalVacationPay
    const daysWorked = s.shifts.filter(sh => ['closed', 'incident'].includes(sh.status)).length
    const deductions = s.retardoDesc + s.incidentDesc

    const badges = []
    if (s.retardos > 0) badges.push(`<span style="background:#fff3cd;color:#856404;padding:1px 5px;border-radius:3px;font-size:7pt">${s.retardos} ret.</span>`)
    if (s.incidents > 0) badges.push(`<span style="background:#f8d7da;color:#842029;padding:1px 5px;border-radius:3px;font-size:7pt">${s.incidents} inc.</span>`)
    if (s.faltasInjustificadas > 0) badges.push(`<span style="background:#f8d7da;color:#842029;padding:1px 5px;border-radius:3px;font-size:7pt">${s.faltasInjustificadas} f.inj.</span>`)
    if (s.otHours > 0) badges.push(`<span style="background:#d1ecf1;color:#0c5460;padding:1px 5px;border-radius:3px;font-size:7pt">${s.otHours}h HE</span>`)
    if (vac.daysInRange > 0) badges.push(`<span style="background:#e9d8fd;color:#553c9a;padding:1px 5px;border-radius:3px;font-size:7pt">${vac.daysInRange}d vac.</span>`)
    if (vac.compensationPay > 0) badges.push(`<span style="background:#e9d8fd;color:#553c9a;padding:1px 5px;border-radius:3px;font-size:7pt">comp.</span>`)

    return `<tr>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:8.5pt;font-weight:600">${escapeHtml(emp.name)}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:8pt;color:#555">${emp.department ? escapeHtml(emp.department) : '—'}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:8pt;text-align:center">${daysWorked}d / ${s.totalH}h${s.otHours > 0 ? `<br/><span style="font-size:7pt;color:#0c5460">+${s.otHours}h HE</span>` : ''}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:8pt;text-align:center">${badges.join(' ') || '<span style="color:#198754">✓</span>'}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:8.5pt;text-align:right">$${grossWithVac.toFixed(2)}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:8.5pt;text-align:right;color:${deductions > 0 ? '#c60' : '#aaa'}">${deductions > 0 ? '-$' + deductions.toFixed(2) : '—'}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;font-size:9pt;text-align:right;font-weight:700">$${netWithVac.toFixed(2)}</td>
      <td style="border:1px solid #ddd;padding:5px 7px;width:80px"></td>
    </tr>`
  }).join('')

  // Signature grid: 3 columns
  const sigCols = active.map(emp => {
    const s = empWeekSummary(emp, weekShifts, employees)
    const vac = vacationPayForWeek(emp, (vacByEmp && vacByEmp[emp.id]) || [], weekStart, weekEnd)
    const grossWithVac = s.grossPay + vac.totalVacationPay
    const netWithVac = Math.max(0, grossWithVac - s.retardoDesc - s.incidentDesc)
    return `<div style="padding:8px 4px">
      <div style="border-top:1px solid #000;padding-top:4px">
        <div style="font-size:8pt;font-weight:600">${escapeHtml(emp.name)}</div>
        <div style="font-size:7.5pt;color:#555">${escapeHtml(emp.employee_code)} · Neto: $${netWithVac.toFixed(2)}</div>
        <div style="font-size:7pt;color:#999;margin-top:2px">Firma de conformidad</div>
      </div>
    </div>`
  }).join('')

  // Desglose de vacaciones y compensaciones que impactan este corte.
  const vacLines = []
  for (const emp of active) {
    const vac = vacationPayForWeek(emp, (vacByEmp && vacByEmp[emp.id]) || [], weekStart, weekEnd)
    for (const d of vac.details) {
      if (d.type === 'tomadas') {
        vacLines.push(`<tr>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt">${escapeHtml(emp.name)}</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt">Vacaciones</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt;text-align:center">${d.days}d</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:7.5pt;color:#666">${escapeHtml(d.rangeStart)} → ${escapeHtml(d.rangeEnd)}</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt;text-align:right">$${d.normalPay.toFixed(2)}</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt;text-align:right;color:#553c9a">$${d.primaPay.toFixed(2)}<br/><span style="font-size:6.5pt;color:#999">prima ${d.primaPct}%</span></td>
        </tr>`)
      } else if (d.type === 'compensadas') {
        vacLines.push(`<tr>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt">${escapeHtml(emp.name)}</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt">Compensación</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt;text-align:center">${d.days}d</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:7.5pt;color:#666">finalizado ${escapeHtml(d.completedAt)}</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt;text-align:right">—</td>
          <td style="border:1px solid #eee;padding:4px 6px;font-size:8pt;text-align:right;color:#553c9a">$${d.amount.toFixed(2)}<br/><span style="font-size:6.5pt;color:#999">pago doble</span></td>
        </tr>`)
      }
    }
  }

  const vacSection = vacLines.length > 0
    ? `<div style="margin-top:16px">
        <div style="font-size:9pt;font-weight:bold;margin-bottom:4px;color:#553c9a">🏖 Vacaciones y compensaciones</div>
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:#f5f0ff">
            <th style="border:1px solid #ddd;padding:4px 6px;font-size:8pt;text-align:left">Empleado</th>
            <th style="border:1px solid #ddd;padding:4px 6px;font-size:8pt;text-align:left">Tipo</th>
            <th style="border:1px solid #ddd;padding:4px 6px;font-size:8pt">Días</th>
            <th style="border:1px solid #ddd;padding:4px 6px;font-size:8pt;text-align:left">Período</th>
            <th style="border:1px solid #ddd;padding:4px 6px;font-size:8pt;text-align:right">Pago base</th>
            <th style="border:1px solid #ddd;padding:4px 6px;font-size:8pt;text-align:right">Prima / Comp.</th>
          </tr></thead>
          <tbody>${vacLines.join('')}</tbody>
        </table>
        <div style="margin-top:4px;font-size:7.5pt;color:#666">Total vacaciones y compensaciones: <b>$${totalVac.toFixed(2)}</b></div>
       </div>`
    : ''

  return `<!DOCTYPE html><html><head><meta charset="utf-8"/>
    <title>Nómina ${escapeHtml(cut.start_date)}</title>
    <style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 9pt; color: #000; }
      .page { padding: 12mm 14mm; }
      table { width: 100%; border-collapse: collapse; }
      thead tr { background: #f0f0f0; }
      th { border: 1px solid #ccc; padding: 5px 7px; font-size: 8pt; text-align: left; }
      tfoot tr { background: #f9f9f9; font-weight: bold; }
      .sig-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px 20px; margin-top: 20px; }
      @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
    </style>
  </head><body><div class="page">

    <!-- Header -->
    <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
      <div style="display:flex;align-items:flex-start;gap:12px">
        ${logoUrl ? `<img src="${escapeHtml(logoUrl)}" alt="Logo" style="height:44px;width:auto;object-fit:contain;border-radius:4px"/>` : ''}
        <div>
          <div style="font-size:16pt;font-weight:bold">${escapeHtml(branchName || 'Nómina Semanal')}</div>
          <div style="font-size:9pt;color:#555;margin-top:2px">Reporte de Asistencia y Pago</div>
        </div>
      </div>
      <div style="text-align:right;font-size:8pt;color:#666">
        <div><b>Período:</b> ${escapeHtml(cut.start_date)} al ${escapeHtml(cut.end_date)}</div>
        <div><b>Emitido:</b> ${escapeHtml(new Date(cut.created_at).toLocaleDateString('es-MX'))}</div>
        <div><b>Por:</b> ${escapeHtml(cut.closed_by_name)}</div>
        ${cut.notes ? `<div style="color:#888"><i>${escapeHtml(cut.notes)}</i></div>` : ''}
      </div>
    </div>

    <!-- Summary table -->
    <table>
      <thead>
        <tr>
          <th>Empleado</th>
          <th>Dept.</th>
          <th style="text-align:center">Días / Hrs</th>
          <th style="text-align:center">Incid.</th>
          <th style="text-align:right">Bruto</th>
          <th style="text-align:right">Desc.</th>
          <th style="text-align:right">NETO</th>
          <th style="text-align:center">Firma</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
      <tfoot>
        <tr>
          <td colspan="4" style="border:1px solid #ccc;padding:5px 7px;font-size:8.5pt">
            <b>TOTALES</b> · ${active.length} empleado${active.length !== 1 ? 's' : ''}
            ${totalVac > 0 ? `<span style="color:#553c9a;font-size:7.5pt">· incluye $${totalVac.toFixed(2)} de vacaciones/comp.</span>` : ''}
          </td>
          <td style="border:1px solid #ccc;padding:5px 7px;text-align:right;font-size:9pt">$${totalGross.toFixed(2)}</td>
          <td style="border:1px solid #ccc;padding:5px 7px;text-align:right;font-size:9pt;color:#c60">—</td>
          <td style="border:1px solid #ccc;padding:5px 7px;text-align:right;font-size:10pt;color:#1a7f3c"><b>$${totalNet.toFixed(2)}</b></td>
          <td style="border:1px solid #ccc"></td>
        </tr>
      </tfoot>
    </table>

    ${vacSection}

    <!-- Signatures -->
    <div class="sig-grid">${sigCols}</div>

    ${payrollLegend ? `
    <div style="margin-top:14px;padding:8px 10px;border:1px solid #e0e0e0;border-radius:4px;background:#fafafa">
      <div style="font-size:6.5pt;color:#666;line-height:1.4">${escapeHtml(payrollLegend)}</div>
    </div>` : ''}
    <div style="margin-top:8px;font-size:7pt;color:#bbb;border-top:1px solid #eee;padding-top:6px">
      CheckPro · ${escapeHtml(branchName || '')} · Semana ${escapeHtml(cut.start_date)} / ${escapeHtml(cut.end_date)} · Documento interno confidencial
    </div>

  </div></body></html>`
}

// ── Component ────────────────────────────────────────────────────────────────
export default function PayrollPage() {
  const [emps, setEmps] = useState([])
  const [shifts, setShifts] = useState([])
  const [cuts, setCuts] = useState([])
  const [vacPeriods, setVacPeriods] = useState([])
  const [cfg, setCfg] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [cutNote, setCutNote] = useState('')
  const [closing, setClosing] = useState(false)
  const [printHTML, setPrintHTML] = useState(null)
  const [resolvingId, setResolvingId] = useState(null)

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)
    const { data: tenant } = await supabase.from('tenants').select('config,name').eq('id', prof.tenant_id).single()
    setCfg(tenant?.config)
    const [{ data: empData }, { data: shiftData }, { data: cutData }, { data: vacData }] = await Promise.all([
      supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).eq('status', 'active').eq('has_shift', true),
      supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).order('date_str', { ascending: false }),
      supabase.from('week_cuts').select('*').eq('tenant_id', prof.tenant_id).order('created_at', { ascending: false }),
      supabase.from('vacation_periods')
        .select('id,employee_id,tipo,status,start_date,end_date,prima_pct,entitled_days,compensated_days,compensated_amount,completed_at')
        .eq('tenant_id', prof.tenant_id),
    ])
    setEmps(empData || [])
    setShifts(shiftData || [])
    setCuts(cutData || [])
    setVacPeriods(vacData || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const range = cfg ? weekRange(new Date(), cfg.weekClosingDay || 'dom') : weekRange(new Date(), 'dom')
  const weekStartStr = isoDate(range.start)
  const weekEndStr = isoDate(range.end)
  const weekShifts = shifts.filter(s => s.date_str >= weekStartStr && s.date_str <= weekEndStr)
  const incidentShifts = weekShifts.filter(s => s.status === 'incident')
  const hasUnresolved = incidentShifts.length > 0

  // Agrupa vacation_periods por employee_id para lookup rapido
  const vacByEmp = {}
  for (const p of vacPeriods) {
    if (!vacByEmp[p.employee_id]) vacByEmp[p.employee_id] = []
    vacByEmp[p.employee_id].push(p)
  }

  // ── Resolve an incident shift ─────────────────────────────────────────────
  async function resolveIncident(shiftId, action) {
    setResolvingId(shiftId)
    const supabase = createClient()
    const note = action === 'approve' ? 'Aprobado por gerente' : 'Descuento aplicado por gerente'
    await supabase.from('shifts').update({
      status: 'closed',
      incidents: [{ resolved: true, action, note, resolvedAt: new Date().toISOString() }]
    }).eq('id', shiftId)
    toast.success(action === 'approve' ? 'Incidencia aprobada ✓' : 'Descuento aplicado')
    setResolvingId(null)
    await load()
  }

  // ── Close week ────────────────────────────────────────────────────────────
  async function closeWeek() {
    if (hasUnresolved) {
      toast.error(`Resuelve las ${incidentShifts.length} incidencia(s) antes de cerrar la semana`)
      return
    }
    setClosing(true)
    const supabase = createClient()
    const startStr = isoDate(range.start), endStr = isoDate(range.end)
    const uncutShifts = weekShifts.filter(s => !s.week_cut_id)
    const { data: cut, error } = await supabase.from('week_cuts').insert({
      tenant_id: tenantId, start_date: startStr, end_date: endStr,
      closed_by_name: 'Gerente', notes: cutNote, paid: true,
      shift_ids: uncutShifts.map(s => s.id)
    }).select().single()
    if (error) { toast.error('Error al cerrar semana'); setClosing(false); return }
    await supabase.from('shifts').update({ week_cut_id: cut.id }).in('id', uncutShifts.map(s => s.id))
    await supabase.from('audit_log').insert({
      tenant_id: tenantId, action: 'WEEK_CUT', employee_name: 'Gerente',
      detail: `${startStr}→${endStr}`, success: true
    })
    toast.success('Semana cerrada exitosamente')

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
    const { data: fresh } = await supabase.from('week_cuts').select('*').eq('id', cut.id).single()
    setPrintHTML(buildReportHTML(fresh, uncutShifts, emps, cfg?.branchName, cfg?.logoUrl, cfg?.payrollLegend, vacByEmp))
    setClosing(false)
  }

  function openReport(cut) {
    const ws = shifts.filter(s => cut.shift_ids?.includes(s.id))
    setPrintHTML(buildReportHTML(cut, ws, emps, cfg?.branchName, cfg?.logoUrl, cfg?.payrollLegend, vacByEmp))
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Nómina</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">
          SEMANA: {isoDate(range.start)} → {isoDate(range.end)}
        </p>
      </div>

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
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Resumen semanal</p>
      <div className="space-y-2 mb-6">
        {emps.map(emp => {
          const s = empWeekSummary(emp, weekShifts, emps)
          const vac = vacationPayForWeek(emp, vacByEmp[emp.id] || [], weekStartStr, weekEndStr)
          const grossWithVac = s.grossPay + vac.totalVacationPay
          const netWithVac = Math.max(0, grossWithVac - s.retardoDesc - s.incidentDesc)
          return (
            <div key={emp.id} className="card">
              <div className="flex items-start justify-between mb-2">
                <div>
                  <div className="font-bold text-white text-sm">{emp.name}</div>
                  <div className="text-xs text-gray-500">{emp.department} · ${monthlyToHourly(emp).toFixed(2)}/h</div>
                </div>
                <div className="text-right">
                  <div className="text-xl font-extrabold text-brand-400 font-mono">${netWithVac.toFixed(0)}</div>
                  <div className="text-[9px] text-gray-600 font-mono">NETO EST.</div>
                </div>
              </div>
              <div className="flex flex-wrap gap-3 text-xs text-gray-500 font-mono mb-2">
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
                {s.incidents > 0 && <span className="badge-red">{s.incidents} incidencia{s.incidents > 1 ? 's' : ''}</span>}
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
                {s.retardos === 0 && s.incidents === 0 && s.otHours === 0 && vac.daysInRange === 0 && vac.compensationPay === 0 && (
                  <span className="badge-green">Sin incidencias ✓</span>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* ── Corte semanal ─────────────────────────────────────────────────── */}
      <div className={`card mb-4 ${hasUnresolved ? 'opacity-60' : ''}`}>
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Corte semanal</p>
        {hasUnresolved && (
          <div className="px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-semibold">
            🔒 Resuelve todas las incidencias para habilitar el corte
          </div>
        )}
        <div className="mb-3">
          <label className="label">Notas del corte (opcional)</label>
          <input className="input text-sm" placeholder="Observaciones de la semana..."
            value={cutNote} onChange={e => setCutNote(e.target.value)} disabled={hasUnresolved} />
        </div>
        <button onClick={closeWeek} disabled={closing || hasUnresolved}
          className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
          {closing ? '⏳ Cerrando...' : '🖨️ Cerrar semana e imprimir reporte'}
        </button>
      </div>

      {/* ── Cortes anteriores ─────────────────────────────────────────────── */}
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

      {/* ── Print modal ────────────────────────────────────────────────────── */}
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
            <span className="text-xs text-gray-500 font-mono hidden md:block">Todos los empleados en una sola hoja</span>
          </div>
          <iframe srcDoc={printHTML} className="flex-1 border-0 w-full" title="Reporte semanal" />
        </div>
      )}
    </div>
  )
}
