'use client'
// src/app/dashboard/payroll/page.js
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { isoDate, weekRange, empWeekSummary, monthlyToHourly, fmtTime, fmtDate, dayKey, DAY_FL } from '@/lib/utils'
import toast from 'react-hot-toast'

// Default legend si el usuario no guardo uno custom (espejo de settings/DEFAULT_LEYENDA)
const DEFAULT_PAYROLL_LEGEND = 'Al firmar el presente comprobante de nómina, el trabajador acepta que los montos, horas trabajadas e incidencias registradas son correctos y conformes a su contrato laboral. Cualquier aclaración deberá presentarse por escrito en un plazo máximo de 5 días hábiles. Documento confidencial de uso interno.'

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
function buildReportHTML(cut, weekShifts, employees, branchName, logoUrl, payrollLegend, vacByEmp, coveragePayMode) {
  const active = employees.filter(e => e.has_shift)
  let totalNet = 0
  let totalGross = 0
  let totalVac = 0

  const weekStart = cut.start_date
  const weekEnd = cut.end_date

  const rows = active.map(emp => {
    const s = empWeekSummary(emp, weekShifts, employees, coveragePayMode)
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
    const s = empWeekSummary(emp, weekShifts, employees, coveragePayMode)
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
  const router = useRouter()
  // Raw data (no filtering yet)
  const [allEmps, setAllEmps] = useState([])
  const [shifts, setShifts] = useState([])
  const [cuts, setCuts] = useState([])
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
  // feat/candados — estado para los candados del corte:
  //   - nextWeekPlan: weekly_plans row para la semana siguiente (null = no planificada → bloquea)
  //   - openIncidencias: incidencias status='open' de mi sucursal (>0 → bloquea)
  const [nextWeekPlan, setNextWeekPlan] = useState(null)
  const [openIncidencias, setOpenIncidencias] = useState([])

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
    const { data: branchData } = await supabase
      .from('branches')
      .select('id,name,config,active')
      .eq('tenant_id', prof.tenant_id)
      .eq('active', true)
      .order('created_at')
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
    const [{ data: empData }, { data: shiftData }, { data: cutData }, { data: vacData }] = await Promise.all([
      supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).eq('status', 'active').eq('has_shift', true),
      supabase.from('shifts').select('*').eq('tenant_id', prof.tenant_id).order('date_str', { ascending: false }),
      supabase.from('week_cuts').select('*').eq('tenant_id', prof.tenant_id).order('created_at', { ascending: false }),
      supabase.from('vacation_periods')
        .select('id,employee_id,tipo,status,start_date,end_date,prima_pct,entitled_days,compensated_days,compensated_amount,completed_at')
        .eq('tenant_id', prof.tenant_id),
    ])
    setAllEmps(empData || [])
    setShifts(shiftData || [])
    setCuts(cutData || [])
    setVacPeriods(vacData || [])

    // feat/candados — weekly_plans para la semana que empieza al día siguiente del corte actual.
    // weekRange devuelve hasta el día de cierre (`dom` por defecto) → la próxima semana arranca en +1.
    // Si ya existe una fila en weekly_plans para ese lunes/día de arranque, el candado se libera.
    try {
      // Calcular fecha de próximo inicio en base al tenant config (closingDay)
      const closingDayKey = (tenant?.config?.weekClosingDay) || 'dom'
      const rangeNow = weekRange(new Date(), closingDayKey)
      const nextStart = new Date(rangeNow.end)
      nextStart.setDate(nextStart.getDate() + 1) // día siguiente al cierre
      const nextStartIso = isoDate(nextStart)
      const { data: wp } = await supabase
        .from('weekly_plans')
        .select('id, start_date, end_date, title, saved_by_name, saved_at')
        .eq('tenant_id', prof.tenant_id)
        .eq('start_date', nextStartIso)
        .maybeSingle()
      setNextWeekPlan(wp || null)
    } catch (e) {
      // Si la tabla no existe aún (migración pendiente), no bloqueamos.
      setNextWeekPlan({ _stub: true })
    }

    // feat/candados — incidencias abiertas del tenant (de MI sucursal).
    try {
      const { data: incs } = await supabase
        .from('incidencias')
        .select('id, branch_id, date_str, kind, status, employee_name')
        .eq('tenant_id', prof.tenant_id)
        .eq('status', 'open')
      setOpenIncidencias(incs || [])
    } catch (e) {
      setOpenIncidencias([])
    }

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
  const range = weekRange(new Date(), closingDay)
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
  const incidentShifts = weekShifts.filter(s => s.status === 'incident')
  const hasUnresolved = incidentShifts.length > 0

  // feat/mixed-schedule: flag del tenant. El Paso 3 del wizard (planificar
  // próxima semana) solo aplica si la empresa activó horarios mixtos en
  // Configuración. Si no, el flujo se queda en 2 pasos (incidencias → corte).
  const mixedEnabled = !!(tenantData?.config?.mixedSchedule?.enabled)
  const hasMixedEmps = emps.some(e => e.is_mixed)
  // Paso actual del wizard:
  //   1 = revisión de incidencias (hay pendientes)
  //   2 = generar corte (ya sin incidencias, aún no se imprime)
  //   3 = planificar próxima semana (ya se generó/imprimió el corte)
  const wizardStep = hasUnresolved ? 1 : (printHTML ? 3 : 2)

  // FIX BUG: solo se permite cerrar el día configurado por la sucursal.
  // dayKey() usa hora local (no UTC) — el gerente cierra cuando es ese día
  // en su zona horaria.
  const todayKey = dayKey(new Date())
  const canCloseToday = todayKey === closingDay

  // Cortes anteriores: filtrar a los que tocan turnos de MI sucursal.
  const cutsForBranch = myBranchId
    ? cuts.filter(c => {
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
    if (hasUnresolved) {
      toast.error(`Resuelve las ${incidentShifts.length} incidencia(s) antes de cerrar la semana`)
      return
    }
    // feat/candado-incidencias: no permitir corte si hay incidencias abiertas en la pestaña dedicada.
    const myIncs = openIncidencias.filter(i => !i.branch_id || i.branch_id === myBranchId)
    if (myIncs.length > 0) {
      toast.error(`Revisa y resuelve ${myIncs.length} incidencia(s) en la pestaña Incidencias antes de cortar`)
      return
    }
    // feat/candado-planificacion: no permitir corte si la próxima semana no está guardada.
    if (!nextWeekPlan || nextWeekPlan._stub) {
      if (!nextWeekPlan) {
        toast.error('Primero planifica la próxima semana (Panel → Planificador → Guardar).')
        return
      }
      // _stub = tabla weekly_plans no migrada aún; no bloqueamos para no romper prod.
    }
    // FIX BUG: bloquear cierre si hoy no es el dia de corte de la sucursal.
    if (!canCloseToday) {
      toast.error(`El corte de esta sucursal solo se puede cerrar los ${DAY_FL[closingDay]}. Hoy es ${DAY_FL[todayKey]}.`)
      return
    }
    if (!myBranchId) {
      toast.error('No se detectó tu sucursal. Revisa tu perfil en Configuración.')
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
    setPrintHTML(buildReportHTML(fresh, uncutShifts, emps, cfg?.branchName, cfg?.logoUrl, cfg?.payrollLegend, vacByEmp, cfg?.coveragePayMode ?? 'covered'))
    setClosing(false)
  }

  function openReport(cut) {
    const ws = shifts.filter(s => cut.shift_ids?.includes(s.id))
    setPrintHTML(buildReportHTML(cut, ws, emps, cfg?.branchName, cfg?.logoUrl, cfg?.payrollLegend, vacByEmp, cfg?.coveragePayMode ?? 'covered'))
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  // Aviso si no hay ninguna sucursal configurada para este tenant.
  if (allBranches.length === 0) {
    return (
      <div className="p-5 md:p-6 max-w-2xl mx-auto">
        <h1 className="text-2xl font-extrabold text-white mb-2">Nómina</h1>
        <div className="card text-center py-10">
          <div className="text-4xl mb-3">🏢</div>
          <p className="text-gray-400 text-sm mb-2">No hay sucursales configuradas.</p>
          <p className="text-gray-600 text-xs">Ve a <span className="text-brand-400">Configuración → Sucursales</span> para crear al menos una antes de generar cortes de nómina.</p>
        </div>
      </div>
    )
  }

  return (
    <div className="p-5 md:p-6 max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Nómina</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">
          SEMANA: {isoDate(range.start)} → {isoDate(range.end)}
        </p>
        <p className="text-brand-400/80 text-xs font-mono mt-0.5">
          🏢 {myBranchName || 'Sucursal sin nombre'} · CORTE: {DAY_FL[closingDay]}
        </p>
      </div>

      {/* ── Wizard de corte semanal (3 pasos, solo si hay mixtos activos) ──── */}
      {/* feat/mixed-schedule: Cuando hay horarios mixtos, el corte se vuelve un
          flujo de 3 pasos en lugar de una acción suelta. Así el gerente no
          olvida planificar la próxima semana después de cerrar el corte, que
          es el error más común reportado en la fase de diseño. */}
      {mixedEnabled && hasMixedEmps && (
        <div className="card mb-4 bg-brand-400/5 border border-brand-400/20">
          <p className="text-[10px] font-mono text-brand-400/70 uppercase tracking-wider mb-2">
            📋 Flujo del corte semanal
          </p>
          <div className="grid grid-cols-3 gap-2">
            {[
              { n: 1, label: 'Revisar incidencias', icon: '🚩' },
              { n: 2, label: 'Generar corte', icon: '💰' },
              { n: 3, label: 'Planificar semana', icon: '📅' },
            ].map(step => {
              const isCurrent = step.n === wizardStep
              const isDone = step.n < wizardStep
              return (
                <div
                  key={step.n}
                  className={
                    'rounded-lg px-2 py-2 text-center transition ' +
                    (isCurrent
                      ? 'bg-brand-400/20 border border-brand-400/50'
                      : isDone
                        ? 'bg-green-500/10 border border-green-500/30'
                        : 'bg-dark-700/40 border border-dark-border')
                  }
                >
                  <div className="text-lg leading-tight">
                    {isDone ? '✅' : step.icon}
                  </div>
                  <div className={
                    'text-[9px] font-mono uppercase tracking-wider mt-0.5 ' +
                    (isCurrent
                      ? 'text-brand-400'
                      : isDone
                        ? 'text-green-400'
                        : 'text-gray-500')
                  }>
                    Paso {step.n}
                  </div>
                  <div className={
                    'text-[10px] mt-0.5 ' +
                    (isCurrent
                      ? 'text-white font-bold'
                      : isDone
                        ? 'text-gray-400'
                        : 'text-gray-600')
                  }>
                    {step.label}
                  </div>
                </div>
              )
            })}
          </div>
          <p className="text-[10px] text-gray-500 font-mono mt-2 leading-relaxed">
            {wizardStep === 1 && '⚠ Resuelve las incidencias antes de generar el corte.'}
            {wizardStep === 2 && '✓ Incidencias resueltas. Ya puedes generar el corte semanal.'}
            {wizardStep === 3 && '✓ Corte generado. Ahora planifica los horarios de la próxima semana para los empleados con horario mixto.'}
          </p>
        </div>
      )}

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
              <option key={b.id} value={b.id}>🏢 {b.name}</option>
            ))}
          </select>
          <p className="text-[10px] text-gray-600 font-mono mt-1.5">
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
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Resumen semanal</p>
      <div className="space-y-2 mb-6">
        {emps.map(emp => {
          // FIX R6: pasar coveragePayMode del tenant (antes se usaba default)
          const s = empWeekSummary(emp, weekShifts, emps, cfg?.coveragePayMode ?? 'covered')
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
      {(() => {
        const myIncsCount = openIncidencias.filter(i => !i.branch_id || i.branch_id === myBranchId).length
        const planningMissing = !nextWeekPlan || nextWeekPlan._stub === true ? !nextWeekPlan : false
        const blockedByPlan = !nextWeekPlan && nextWeekPlan !== null // planningMissing solamente si la tabla existe y no hay row
        const planBlocks = nextWeekPlan === null // true cuando no hay row (pero la tabla existe)
        const disabledByCandados = hasUnresolved || !canCloseToday || myIncsCount > 0 || planBlocks
        return (
          <div className={`card mb-4 ${disabledByCandados ? 'opacity-60' : ''}`}>
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Corte semanal</p>
            {hasUnresolved && (
              <div className="px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-semibold">
                🔒 Resuelve todas las incidencias del listado arriba para habilitar el corte
              </div>
            )}
            {myIncsCount > 0 && (
              <div className="px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 text-xs font-semibold">
                📋 Hay {myIncsCount} incidencia(s) abierta(s) en la pestaña <a href="/dashboard/incidencias" className="underline">Incidencias</a>. Resuélvelas antes de cortar.
              </div>
            )}
            {planBlocks && (
              <div className="px-3 py-2 mb-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-amber-300 text-xs font-semibold">
                🗓 Primero planifica la próxima semana en <a href="/dashboard/planning" className="underline">Planificador</a> y presiona <span className="text-white">Guardar plan</span>.
              </div>
            )}
            {!canCloseToday && !hasUnresolved && (
              <div className="px-3 py-2 mb-3 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400 text-xs font-semibold">
                🗓 El corte de <span className="text-white">{myBranchName || 'esta sucursal'}</span> solo se genera los {DAY_FL[closingDay]}. Hoy es {DAY_FL[todayKey]}.
              </div>
            )}
            {nextWeekPlan && !nextWeekPlan._stub && (
              <div className="px-3 py-2 mb-3 bg-brand-400/10 border border-brand-400/30 rounded-lg text-brand-300 text-xs font-semibold">
                ✓ Próxima semana planificada: {nextWeekPlan.title || nextWeekPlan.start_date}
              </div>
            )}
            <div className="mb-3">
              <label className="label">Notas del corte (opcional)</label>
              <input className="input text-sm" placeholder="Observaciones de la semana..."
                value={cutNote} onChange={e => setCutNote(e.target.value)} disabled={disabledByCandados} />
            </div>
            <button onClick={closeWeek} disabled={closing || disabledByCandados}
              className="btn-primary disabled:opacity-40 disabled:cursor-not-allowed">
              {closing ? '⏳ Cerrando...' : !canCloseToday ? `🔒 Disponible los ${DAY_FL[closingDay]}` : '🖨️ Cerrar semana e imprimir reporte'}
            </button>
          </div>
        )
      })()}

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
            {/* feat/mixed-schedule: Paso 3 del wizard. Tras imprimir el corte,
                el gerente se va directo a planificar la semana siguiente. Solo
                aparece si la empresa tiene el modo mixto activado y al menos
                un empleado mixto en esta sucursal. */}
            {mixedEnabled && hasMixedEmps && (
              <button onClick={() => router.push('/dashboard/planning')}
                className="flex items-center gap-2 px-4 py-2 bg-brand-500/20 border border-brand-400/50 text-brand-400 text-sm font-bold rounded-xl active:bg-brand-500/30">
                📅 Paso 3: Planificar próxima semana →
              </button>
            )}
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
