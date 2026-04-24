// src/lib/archive.js
// Generación de paquetes de archivo semanal: XLSX por empleado, XLSX por sucursal, PDF maestro.
import * as XLSX from 'xlsx'
import { PDFDocument, StandardFonts } from 'pdf-lib'
import crypto from 'crypto'
import { formatInTimeZone } from 'date-fns-tz'

const TZ = 'America/Mexico_City'

export function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex')
}

function fmt(d) {
  if (!d) return ''
  return formatInTimeZone(new Date(d), TZ, 'yyyy-MM-dd HH:mm')
}

function weekOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z')
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4))
  const diff = (d - firstThursday) / 86400000
  const week = Math.ceil((diff + firstThursday.getUTCDay() + 1) / 7)
  return { year: d.getUTCFullYear(), week: Math.max(1, week) }
}

export { weekOf }

export function buildEmployeeXlsx(employee, shifts, weekStart, weekEnd) {
  const rows = shifts.map((s) => ({
    Fecha: s.date_str,
    'Entrada': fmt(s.entry_time),
    'Salida': fmt(s.exit_time),
    'Duración (h)': s.duration_hours != null ? Number(s.duration_hours).toFixed(2) : '',
    'Clasificación': s.classification?.label ?? '',
    'Tipo': s.classification?.type ?? '',
    'Día festivo': s.is_holiday ? 'Sí' : 'No',
    'Nombre festivo': s.holiday_name ?? '',
    'Estado': s.status,
    'Incidentes': Array.isArray(s.incidents) ? s.incidents.join('; ') : '',
    'GPS Entrada': s.geo_entry ? `${s.geo_entry.lat},${s.geo_entry.lng}` : '',
    'GPS Salida': s.geo_exit ? `${s.geo_exit.lat},${s.geo_exit.lng}` : '',
  }))

  const header = [
    ['CheckPro — Registro de asistencia'],
    [''],
    ['Empleado:', employee.name],
    ['Código:', employee.employee_code],
    ['Departamento:', employee.department ?? ''],
    ['Puesto:', employee.role_label ?? ''],
    ['Semana:', `${weekStart} a ${weekEnd}`],
    ['Total jornadas:', shifts.length],
    [
      'Total horas:',
      shifts.reduce((s, x) => s + (Number(x.duration_hours) || 0), 0).toFixed(2),
    ],
    ['Generado:', fmt(new Date())],
  ]

  const wb = XLSX.utils.book_new()
  const wsH = XLSX.utils.aoa_to_sheet(header)
  XLSX.utils.book_append_sheet(wb, wsH, 'Encabezado')
  const ws = XLSX.utils.json_to_sheet(rows)
  XLSX.utils.book_append_sheet(wb, ws, 'Jornadas')

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

export function buildBranchXlsx(tenant, employees, shiftsByEmpId, weekStart, weekEnd) {
  const detail = []
  for (const emp of employees) {
    const empShifts = shiftsByEmpId[emp.id] || []
    for (const s of empShifts) {
      detail.push({
        Empleado: emp.name,
        Código: emp.employee_code,
        Departamento: emp.department ?? '',
        Fecha: s.date_str,
        Entrada: fmt(s.entry_time),
        Salida: fmt(s.exit_time),
        'Duración (h)': s.duration_hours != null ? Number(s.duration_hours).toFixed(2) : '',
        Clasificación: s.classification?.label ?? '',
        Tipo: s.classification?.type ?? '',
        Incidentes: Array.isArray(s.incidents) ? s.incidents.join('; ') : '',
      })
    }
  }

  const summary = employees.map((emp) => {
    const empShifts = shiftsByEmpId[emp.id] || []
    const totalHours = empShifts.reduce((s, x) => s + (Number(x.duration_hours) || 0), 0)
    const retardos = empShifts.filter((s) => s.classification?.type === 'retardo').length
    const puntuales = empShifts.filter((s) => s.classification?.type === 'puntual').length
    return {
      Empleado: emp.name,
      Código: emp.employee_code,
      Departamento: emp.department ?? '',
      Jornadas: empShifts.length,
      'Total horas': totalHours.toFixed(2),
      Puntuales: puntuales,
      Retardos: retardos,
    }
  })

  const header = [
    ['CheckPro — Resumen de sucursal'],
    [''],
    ['Empresa:', tenant.name],
    ['Sucursal:', tenant.config?.branchName || 'Principal'],
    ['Semana:', `${weekStart} a ${weekEnd}`],
    ['Total empleados:', employees.length],
    ['Total jornadas:', detail.length],
    ['Generado:', fmt(new Date())],
  ]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(header), 'Encabezado')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summary), 'Resumen')
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(detail), 'Detalle')

  return Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }))
}

export async function buildMasterPdf(tenant, employees, shiftsByEmpId, weekStart, weekEnd, filesList) {
  const pdfDoc = await PDFDocument.create()
  const font = await pdfDoc.embedFont(StandardFonts.Helvetica)
  const bold = await pdfDoc.embedFont(StandardFonts.HelveticaBold)

  const pageSize = [595, 842] // A4 portrait
  let page = pdfDoc.addPage(pageSize)
  let { height } = page.getSize()
  let y = height - 50
  const margin = 50

  const newPageIfNeeded = (minY) => {
    if (y < minY) {
      page = pdfDoc.addPage(pageSize)
      y = page.getSize().height - 50
    }
  }

  page.drawText('CheckPro - Paquete de archivo semanal', { x: margin, y, size: 16, font: bold })
  y -= 28
  page.drawText(`Empresa: ${tenant.name}`, { x: margin, y, size: 11, font })
  y -= 14
  page.drawText(`Sucursal: ${tenant.config?.branchName || 'Principal'}`, { x: margin, y, size: 11, font })
  y -= 14
  page.drawText(`Semana: ${weekStart} a ${weekEnd}`, { x: margin, y, size: 11, font })
  y -= 14
  page.drawText(`Generado: ${fmt(new Date())}`, { x: margin, y, size: 11, font })
  y -= 14
  page.drawText(`Empleados: ${employees.length}`, { x: margin, y, size: 11, font })
  y -= 28

  page.drawText('Archivos del paquete (cadena de custodia SHA-256):', { x: margin, y, size: 12, font: bold })
  y -= 18
  for (const f of filesList) {
    newPageIfNeeded(80)
    page.drawText(`- ${f.name}  (${f.size} bytes)`, { x: margin, y, size: 9, font })
    y -= 11
    page.drawText(`  ${f.sha256}`, { x: margin + 6, y, size: 7, font })
    y -= 14
  }

  y -= 16
  newPageIfNeeded(100)
  page.drawText('Resumen por empleado:', { x: margin, y, size: 12, font: bold })
  y -= 18

  for (const emp of employees) {
    newPageIfNeeded(70)
    const empShifts = shiftsByEmpId[emp.id] || []
    const totalHours = empShifts.reduce((s, x) => s + (Number(x.duration_hours) || 0), 0)
    const retardos = empShifts.filter((s) => s.classification?.type === 'retardo').length
    page.drawText(`${emp.employee_code}  ${emp.name}`, { x: margin, y, size: 10, font: bold })
    y -= 12
    page.drawText(
      `  Jornadas: ${empShifts.length}   Horas: ${totalHours.toFixed(2)}   Retardos: ${retardos}`,
      { x: margin, y, size: 9, font },
    )
    y -= 18
  }

  y -= 10
  newPageIfNeeded(80)
  page.drawText('Declaración:', { x: margin, y, size: 11, font: bold })
  y -= 14
  const lines = [
    'Este documento y los archivos asociados son registros laborales generados por',
    'CheckPro segun la Ley Federal del Trabajo (art. 804) y el Codigo Fiscal de la',
    'Federacion (art. 30). Los hashes SHA-256 listados permiten verificar que los',
    'archivos no han sido alterados despues de su generacion.',
  ]
  for (const ln of lines) {
    page.drawText(ln, { x: margin, y, size: 9, font })
    y -= 11
  }

  const pdfBytes = await pdfDoc.save()
  return Buffer.from(pdfBytes)
}
