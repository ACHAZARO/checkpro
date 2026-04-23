// src/lib/export-xlsx.js
// Exportación a Excel (.xlsx) usando SheetJS para reportes de asistencia y nómina.
// Compatible con la Secretaría del Trabajo — incluye detalle diario + resumen totales.

import * as XLSX from 'xlsx'

// ── Helpers ───────────────────────────────────────────────────────────────────
const fmtT = d => d ? new Date(d).toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' }) : ''
const fmtD = d => d ? new Date(d + 'T12:00:00').toLocaleDateString('es-MX', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric' }) : ''

function classLabel(s) {
  if (s.status === 'absent') return s.classification?.label || 'Falta'
  if (s.status === 'open') return 'Jornada abierta'
  if (s.status === 'incident') return 'Incidencia'
  return s.classification?.label || 'Completa'
}

// Aplica estilo de encabezado a un rango de celdas
function styleHeader(ws, range) {
  // SheetJS CE no soporta estilos inline, pero sí con xlsx-style.
  // Dejamos los datos; el usuario puede dar formato en Excel.
  // Para distinguir los encabezados los ponemos en mayúsculas.
}

function autoWidth(ws, data) {
  if (!data || data.length === 0) return
  const cols = Object.keys(data[0])
  ws['!cols'] = cols.map(key => {
    const max = Math.max(key.length, ...data.map(r => String(r[key] ?? '').length))
    return { wch: Math.min(max + 2, 40) }
  })
}

// ── EXPORTAR ASISTENCIA ───────────────────────────────────────────────────────
// Genera un .xlsx con:
//   Hoja 1 "Registros"  — cada turno con todos sus campos
//   Hoja 2 "Resumen"    — un renglón por empleado con totales del período
//
// Parámetros:
//   shifts   — array de registros de shifts (ya filtrados por período/empleado/sucursal)
//   emps     — array de empleados
//   branches — array de sucursales { id, name }
//   periodFrom, periodTo — strings YYYY-MM-DD
//   companyName — nombre de la empresa/sucursal
export function generateAttendanceXLSX({ shifts, emps, branches, periodFrom, periodTo, companyName }) {
  const wb = XLSX.utils.book_new()

  // ── Mapa rápido empleado ──────────────────────────────────────────────────
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]))
  const branchMap = Object.fromEntries((branches || []).map(b => [b.id, b]))
  function getBranch(emp) {
    const bid = emp?.branch_id || emp?.schedule?.branch?.id
    return bid ? branchMap[bid]?.name || '' : ''
  }

  // ────────────────────────────────────────────────────────────────────────────
  // HOJA 1 — REGISTROS DETALLADOS
  // ────────────────────────────────────────────────────────────────────────────
  const infoRows = [
    ['REPORTE DE ASISTENCIA — ' + (companyName || 'CheckPro')],
    ['Período:', periodFrom + ' al ' + periodTo],
    ['Generado:', new Date().toLocaleString('es-MX')],
    [],
  ]

  const detailHeader = [
    'Fecha', 'Día', 'Empleado', 'Código', 'Departamento', 'Sucursal',
    'Hora Entrada', 'Hora Salida', 'Horas Trabajadas', 'Horas Extra',
    'Estatus', 'Clasificación', 'Retardo', 'Feriado', 'Incidencias', 'Notas'
  ]

  // Ordenar por empleado → fecha
  const sorted = [...shifts].sort((a, b) => {
    const ea = empMap[a.employee_id]?.name || ''
    const eb = empMap[b.employee_id]?.name || ''
    if (ea !== eb) return ea.localeCompare(eb, 'es')
    return a.date_str.localeCompare(b.date_str)
  })

  const detailRows = sorted.map(s => {
    const emp = empMap[s.employee_id] || {}
    const dateObj = new Date(s.date_str + 'T12:00:00')
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    return {
      'Fecha': s.date_str,
      'Día': dayNames[dateObj.getDay()],
      'Empleado': emp.name || s.employee_id,
      'Código': emp.employee_code || '',
      'Departamento': emp.department || '',
      'Sucursal': getBranch(emp),
      'Hora Entrada': fmtT(s.entry_time),
      'Hora Salida': fmtT(s.exit_time),
      'Horas Trabajadas': s.duration_hours || 0,
      'Horas Extra': s.corrections?.overtime?.hours || 0,
      'Estatus': s.status === 'closed' ? 'Cerrada' : s.status === 'open' ? 'Abierta' : s.status === 'incident' ? 'Incidencia' : s.status === 'absent' ? 'Falta' : s.status,
      'Clasificación': classLabel(s),
      'Retardo': s.classification?.type === 'retardo' ? 'SÍ' : 'No',
      'Feriado': s.is_holiday ? 'SÍ' : 'No',
      'Incidencias': (s.incidents || []).map(i => i.type + (i.note ? ': ' + i.note : '')).join(' | '),
      'Notas': (s.corrections || []).map ? (s.corrections || []).map(c => c.note).join(' | ') : ''
    }
  })

  // Construir hoja con filas de encabezado de reporte + datos
  const ws1 = XLSX.utils.aoa_to_sheet(infoRows)
  XLSX.utils.sheet_add_json(ws1, detailRows, { origin: infoRows.length, header: detailHeader })
  autoWidth(ws1, detailRows)
  ws1['!cols'] = ws1['!cols'] || []
  XLSX.utils.book_append_sheet(wb, ws1, 'Registros')

  // ────────────────────────────────────────────────────────────────────────────
  // HOJA 2 — RESUMEN POR EMPLEADO
  // ────────────────────────────────────────────────────────────────────────────
  const empIds = [...new Set(shifts.map(s => s.employee_id))]

  const summaryRows = empIds.map(eid => {
    const emp = empMap[eid] || {}
    const mine = shifts.filter(s => s.employee_id === eid)
    const worked = mine.filter(s => s.status === 'closed' || s.status === 'incident')
    const totalH = worked.reduce((a, s) => a + (s.duration_hours || 0), 0)
    const otH = worked.reduce((a, s) => a + (s.corrections?.overtime?.hours || 0), 0)
    const retardos = worked.filter(s => s.classification?.type === 'retardo').length
    const puntual = worked.filter(s => s.classification?.type === 'puntual').length
    const tolerancia = worked.filter(s => s.classification?.type === 'tolerancia').length
    const faltasInj = mine.filter(s => s.classification?.type === 'falta_injustificada').length
    const faltasJP = mine.filter(s => s.classification?.type === 'falta_justificada_pagada').length
    const faltasJNP = mine.filter(s => s.classification?.type === 'falta_justificada_no_pagada').length
    const incidencias = mine.filter(s => s.status === 'incident').length
    const feriados = worked.filter(s => s.is_holiday).length
    return {
      'Empleado': emp.name || eid,
      'Código': emp.employee_code || '',
      'Departamento': emp.department || '',
      'Sucursal': getBranch(emp),
      'Días Trabajados': worked.length,
      'Total Horas': parseFloat(totalH.toFixed(2)),
      'Horas Extra': parseFloat(otH.toFixed(2)),
      'Entradas Puntuales': puntual,
      'Con Tolerancia': tolerancia,
      'Retardos': retardos,
      'Incidencias': incidencias,
      'Faltas Injustificadas': faltasInj,
      'Faltas Just. Pagadas': faltasJP,
      'Faltas Just. S/Pago': faltasJNP,
      'Días Feriado Trabajado': feriados,
    }
  }).sort((a, b) => a['Empleado'].localeCompare(b['Empleado'], 'es'))

  const summaryInfoRows = [
    ['RESUMEN POR EMPLEADO — ' + (companyName || 'CheckPro')],
    ['Período:', periodFrom + ' al ' + periodTo],
    [],
  ]

  const ws2 = XLSX.utils.aoa_to_sheet(summaryInfoRows)
  XLSX.utils.sheet_add_json(ws2, summaryRows, { origin: summaryInfoRows.length })
  autoWidth(ws2, summaryRows)
  XLSX.utils.book_append_sheet(wb, ws2, 'Resumen')

  // ── Descargar ─────────────────────────────────────────────────────────────
  const filename = `checkpro_asistencia_${periodFrom}_${periodTo}.xlsx`
  XLSX.writeFile(wb, filename)
  return filename
}

// ── EXPORTAR NÓMINA ───────────────────────────────────────────────────────────
// Genera un .xlsx con:
//   Hoja 1 "Resumen Nómina"  — un renglón por empleado con su pago del corte
//   Hoja 2 "Detalle Turnos"  — cada turno del período del corte
//
// Parámetros:
//   cut         — objeto week_cut { start_date, end_date, closed_by_name, notes }
//   weekShifts  — turnos incluidos en el corte
//   emps        — empleados activos del corte
//   branchName  — nombre de la sucursal
//   empWeekSummaryFn  — función empWeekSummary de utils.js (importada en el page)
//   coveragePayMode   — 'covered' | 'own' | 'lower'
export function generatePayrollXLSX({ cut, weekShifts, emps, branchName, empWeekSummaryFn, coveragePayMode }) {
  const wb = XLSX.utils.book_new()

  // ────────────────────────────────────────────────────────────────────────────
  // HOJA 1 — RESUMEN NÓMINA
  // ────────────────────────────────────────────────────────────────────────────
  const infoRows = [
    ['NÓMINA SEMANAL — ' + (branchName || 'CheckPro')],
    ['Período:', cut.start_date + ' al ' + cut.end_date],
    ['Cerrado por:', cut.closed_by_name || ''],
    ['Notas:', cut.notes || ''],
    ['Generado:', new Date().toLocaleString('es-MX')],
    [],
  ]

  let grandGross = 0, grandNet = 0, grandH = 0

  const summaryRows = emps.map(emp => {
    const s = empWeekSummaryFn(emp, weekShifts, emps, coveragePayMode)
    const net = Math.max(0, s.grossPay - s.retardoDesc - s.incidentDesc)
    grandGross += s.grossPay
    grandNet += net
    grandH += s.totalH
    const worked = s.shifts.filter(sh => sh.status === 'closed' || sh.status === 'incident').length
    return {
      'Empleado': emp.name,
      'Código': emp.employee_code || '',
      'Departamento': emp.department || '',
      'Días Trabajados': worked,
      'Horas Totales': s.totalH,
      'Horas Extra': s.otHours,
      'Retardos': s.retardos,
      'Incidencias': s.incidents,
      'Faltas Injust.': s.faltasInjustificadas,
      'Faltas Just.': s.faltasJustificadas,
      'Salario Bruto ($)': parseFloat(s.grossPay.toFixed(2)),
      'Desc. Retardos ($)': parseFloat(s.retardoDesc.toFixed(2)),
      'Desc. Incidencias ($)': parseFloat(s.incidentDesc.toFixed(2)),
      'Neto a Pagar ($)': parseFloat(net.toFixed(2)),
    }
  })

  // Fila de totales al final
  summaryRows.push({
    'Empleado': '--- TOTALES ---',
    'Código': '',
    'Departamento': '',
    'Días Trabajados': '',
    'Horas Totales': parseFloat(grandH.toFixed(2)),
    'Horas Extra': '',
    'Retardos': '',
    'Incidencias': '',
    'Faltas Injust.': '',
    'Faltas Just.': '',
    'Salario Bruto ($)': parseFloat(grandGross.toFixed(2)),
    'Desc. Retardos ($)': '',
    'Desc. Incidencias ($)': '',
    'Neto a Pagar ($)': parseFloat(grandNet.toFixed(2)),
  })

  const ws1 = XLSX.utils.aoa_to_sheet(infoRows)
  XLSX.utils.sheet_add_json(ws1, summaryRows, { origin: infoRows.length })
  autoWidth(ws1, summaryRows)
  XLSX.utils.book_append_sheet(wb, ws1, 'Resumen Nómina')

  // ────────────────────────────────────────────────────────────────────────────
  // HOJA 2 — DETALLE DE TURNOS DEL CORTE
  // ────────────────────────────────────────────────────────────────────────────
  const empMap = Object.fromEntries(emps.map(e => [e.id, e]))

  const sortedShifts = [...weekShifts].sort((a, b) => {
    const ea = empMap[a.employee_id]?.name || ''
    const eb = empMap[b.employee_id]?.name || ''
    if (ea !== eb) return ea.localeCompare(eb, 'es')
    return a.date_str.localeCompare(b.date_str)
  })

  const detailRows = sortedShifts.map(s => {
    const emp = empMap[s.employee_id] || {}
    const dateObj = new Date(s.date_str + 'T12:00:00')
    const dayNames = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb']
    return {
      'Fecha': s.date_str,
      'Día': dayNames[dateObj.getDay()],
      'Empleado': emp.name || s.employee_id,
      'Código': emp.employee_code || '',
      'Departamento': emp.department || '',
      'Hora Entrada': fmtT(s.entry_time),
      'Hora Salida': fmtT(s.exit_time),
      'Horas Trabajadas': s.duration_hours || 0,
      'Horas Extra': s.corrections?.overtime?.hours || 0,
      'Clasificación': classLabel(s),
      'Feriado': s.is_holiday ? 'SÍ' : 'No',
      'Incidencias': (s.incidents || []).map(i => i.type + (i.note ? ': ' + i.note : '')).join(' | '),
    }
  })

  const detailInfoRows = [
    ['DETALLE DE TURNOS — ' + (branchName || '')],
    ['Período:', cut.start_date + ' al ' + cut.end_date],
    [],
  ]

  const ws2 = XLSX.utils.aoa_to_sheet(detailInfoRows)
  XLSX.utils.sheet_add_json(ws2, detailRows, { origin: detailInfoRows.length })
  autoWidth(ws2, detailRows)
  XLSX.utils.book_append_sheet(wb, ws2, 'Detalle Turnos')

  // ── Descargar ─────────────────────────────────────────────────────────────
  const filename = `checkpro_nomina_${cut.start_date}_${cut.end_date}.xlsx`
  XLSX.writeFile(wb, filename)
  return filename
}
