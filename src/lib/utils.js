// src/lib/utils.js
import { clsx } from 'clsx'
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz'

export function cn(...inputs) { return clsx(inputs) }

export const DAYS = ['lun','mar','mie','jue','vie','sab','dom']
export const DAY_L = { lun:'Lun',mar:'Mar',mie:'Mié',jue:'Jue',vie:'Vie',sab:'Sáb',dom:'Dom' }
export const DAY_FL = { lun:'Lunes',mar:'Martes',mie:'Miércoles',jue:'Jueves',vie:'Viernes',sab:'Sábado',dom:'Domingo' }

const DEFAULT_TZ = 'America/Mexico_City'

export const fmtTime = d => d ? new Date(d).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit', timeZone: DEFAULT_TZ }) : '--:--'
export const fmtDate = d => d ? new Date(d).toLocaleDateString('es-MX', { weekday:'short', day:'2-digit', month:'short', timeZone: DEFAULT_TZ }) : ''
export const fmtDateFull = d => d ? new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric', timeZone: DEFAULT_TZ }) : ''
export const fmtDT = d => d ? `${fmtDate(d)} ${fmtTime(d)}` : ''

// CAMBIO — isoDate usa TZ (no UTC); clave para México-5/-6
export const isoDate = (d, tz = DEFAULT_TZ) => formatInTimeZone(new Date(d), tz, 'yyyy-MM-dd')

// Fecha HOY en TZ America/Mexico_City como 'YYYY-MM-DD'.
// Vercel corre UTC; usar este helper en cualquier comparacion de fechas-dia.
export function todayISOMX(tz = DEFAULT_TZ) {
  return formatInTimeZone(new Date(), tz, 'yyyy-MM-dd')
}

export const diffMin = (a,b) => Math.round((new Date(b)-new Date(a))/60000)
export const diffHrs = (a,b) => (new Date(b)-new Date(a))/3600000

// CAMBIO — dayKey usa TZ
export const dayKey = (d, tz = DEFAULT_TZ) => {
  const wd = formatInTimeZone(new Date(d), tz, 'EEE').toLowerCase()
  const map = { mon:'lun', tue:'mar', wed:'mie', thu:'jue', fri:'vie', sat:'sab', sun:'dom' }
  return map[wd] || 'lun'
}

export function hoursInSchedule(schedule, dk) {
  const s = schedule?.[dk]
  if (!s?.work) return 0
  const [h1,m1] = s.start.split(':').map(Number)
  const [h2,m2] = s.end.split(':').map(Number)
  return (h2*60+m2-h1*60-m1)/60
}

export function monthlyToHourly(employee) {
  const period = employee.schedule?.salary_period || 'monthly'
  const wkH = DAYS.reduce((a,d) => a + hoursInSchedule(employee.schedule||{}, d), 0)
  if (wkH <= 0) return 0
  if (period === 'weekly') return employee.monthly_salary / wkH
  return employee.monthly_salary / (wkH * 4.33)
}

export function salaryPeriodLabel(employee) {
  return employee.schedule?.salary_period === 'weekly' ? 'sem' : 'mes'
}

export function toMonthlySalary(employee) {
  if (employee.schedule?.salary_period === 'weekly') return employee.monthly_salary * 4.33
  return employee.monthly_salary
}

// CAMBIO — classifyEntry compara en la TZ del tenant
export function classifyEntry(schedule, entryTime, toleranceMinutes, tz = DEFAULT_TZ) {
  const dk = dayKey(entryTime, tz)
  const s = schedule?.[dk]
  if (!s?.work) return { type:'no_laboral', label:'Día no laboral' }
  const dateStr = isoDate(entryTime, tz)
  const refUtc = fromZonedTime(`${dateStr}T${s.start}:00`, tz)
  const diff = Math.round((new Date(entryTime) - refUtc) / 60000)
  if (diff <= 0) return { type:'puntual', label:'Puntual' }
  if (diff <= toleranceMinutes) return { type:'tolerancia', label:`Tolerancia (${diff} min)` }
  return { type:'retardo', label:`Retardo (${diff} min)` }
}

export function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const dL = (lat2-lat1)*Math.PI/180
  const dG = (lng2-lng1)*Math.PI/180
  const a = Math.sin(dL/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dG/2)**2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a))
}

// CAMBIO — weekRange usa TZ
export function weekRange(refDate, closingDay, tz = DEFAULT_TZ) {
  const dk = dayKey(refDate, tz)
  const ci = DAYS.indexOf(closingDay)
  const cur = DAYS.indexOf(dk)
  const daysForward = (ci - cur + 7) % 7
  const refIso = isoDate(refDate, tz)
  const endLocal = new Date(`${refIso}T00:00:00`)
  endLocal.setDate(endLocal.getDate() + daysForward)
  const endIso = formatInTimeZone(endLocal, tz, 'yyyy-MM-dd')
  const end = fromZonedTime(`${endIso}T23:59:59.999`, tz)
  const startLocal = new Date(endLocal); startLocal.setDate(startLocal.getDate() - 6)
  const startIso = formatInTimeZone(startLocal, tz, 'yyyy-MM-dd')
  const start = fromZonedTime(`${startIso}T00:00:00`, tz)
  return { start, end }
}

export function calcOvertimeHours(minutesOver) {
  if (minutesOver <= 30) return 0
  return Math.ceil((minutesOver - 30) / 60)
}

// CAMBIO — scheduledExitDate usa TZ
export function scheduledExitDate(dateStr, employee, tz = DEFAULT_TZ) {
  const dk = dayKey(`${dateStr}T12:00:00Z`, tz)
  const s = employee.schedule?.[dk]
  if (!s?.work || !s.end) return null
  return fromZonedTime(`${dateStr}T${s.end}:00`, tz)
}

// ── Vacaciones (LFT 2023) ─────────────────────────────────────────────────────
export const LFT_VACATION_TABLE = [
  { fromYear: 1, toYear: 1, days: 12 },
  { fromYear: 2, toYear: 2, days: 14 },
  { fromYear: 3, toYear: 3, days: 16 },
  { fromYear: 4, toYear: 4, days: 18 },
  { fromYear: 5, toYear: 9, days: 20 },
  { fromYear: 10, toYear: 14, days: 22 },
  { fromYear: 15, toYear: 19, days: 24 },
  { fromYear: 20, toYear: 24, days: 26 },
  { fromYear: 25, toYear: 999, days: 28 },
]

// FIX 7: parseLocalDate TZ-safe para evitar drift en hire_date "YYYY-MM-DD".
// new Date("2024-03-15") lo interpreta como UTC y en Vercel (UTC) vs navegador
// (America/Mexico_City, -6h) puede caer al día anterior.
function parseLocalDate(isoStr) {
  // "YYYY-MM-DD" → Date local midnight
  if (!isoStr) return null;
  const [y, m, d] = String(isoStr).slice(0, 10).split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

export function calcYearsWorked(hireDate) {
  const d = parseLocalDate(hireDate);
  if (!d) return 0;
  const now = new Date();
  let years = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) years--;
  return Math.max(0, years);
}

export function calcVacationDays(hireDate, customTable = null) {
  const table = customTable || LFT_VACATION_TABLE
  const years = calcYearsWorked(hireDate)
  if (years < 1) return 0
  const entry = table.find(r => years >= r.fromYear && years <= r.toYear)
  return entry?.days || 28
}

export function currentAnniversaryYear(hireDate) {
  if (!hireDate) return null
  const hire = new Date(hireDate); const now = new Date()
  const thisYearAnniv = new Date(now.getFullYear(), hire.getMonth(), hire.getDate())
  return thisYearAnniv <= now ? now.getFullYear() : now.getFullYear() - 1
}

// FIX 8: ya no leemos schedule.vacationYearsTaken (legacy). Ahora recibimos
// los vacation_periods reales del empleado y computamos "pending" como
// "no existe un periodo vivo para el año de aniversario actual".
// `periods` debe ser un array con al menos { employee_id, anniversary_year, status }.
// Retrocompatible: si no viene `periods` no podemos determinarlo, devolvemos false
// (preferible a reportar mal; la UI debería pasarlos explícitos).
export function hasVacationPending(employee, periods = []) {
  const hireDate = employee?.hire_date || employee?.schedule?.hireDate
  if (!hireDate) return false
  const years = calcYearsWorked(hireDate)
  if (years < 1) return false
  // currentAnniversaryYear devuelve el año calendario del último aniversario;
  // como anniversary_year en la tabla representa el ordinal (1,2,3...),
  // usamos el ordinal actual (=years) como año de aniversario pendiente.
  const currentYear = years
  if (currentYear <= 0) return false
  const alive = (periods || []).filter(
    p => p.employee_id === employee.id && !['cancelled', 'expired'].includes(p.status)
  )
  return !alive.some(p => p.anniversary_year === currentYear)
}

function resolvePayEmployee(employee, coveringEmployee, coveragePayMode) {
  if (!coveringEmployee) return employee
  const mode = coveragePayMode || 'covered'
  if (mode === 'own') return employee
  if (mode === 'covered') return coveringEmployee
  if (mode === 'lower') {
    const salA = toMonthlySalary(employee); const salB = toMonthlySalary(coveringEmployee)
    return salA <= salB ? employee : coveringEmployee
  }
  return coveringEmployee
}

export function calcShiftPay(shift, employee, coveringEmployee, coveragePayMode) {
  if (shift.classification?.type === 'falta_injustificada') return 0
  if (!shift.duration_hours) return 0
  const payEmp = resolvePayEmployee(employee, coveringEmployee, coveragePayMode)
  const rate = monthlyToHourly(payEmp)
  const otHours = shift.corrections?.overtime?.hours || 0
  if (shift.is_holiday) return shift.duration_hours * rate * 3
  return shift.duration_hours * rate + otHours * rate
}

export function empWeekSummary(employee, weekShifts, allEmployees, coveragePayMode) {
  const mine = weekShifts.filter(s => s.employee_id === employee.id)
  const closed = mine.filter(s => ['closed','incident'].includes(s.status))
  const totalH = closed.reduce((a,s) => a + (s.duration_hours||0), 0)
  const otHours = closed.reduce((a,s) => a + (s.corrections?.overtime?.hours || 0), 0)
  const retardos = closed.filter(s => s.classification?.type === 'retardo').length
  const incidents = mine.filter(s => s.status === 'incident').length
  const faltasInjustificadas = mine.filter(s => s.classification?.type === 'falta_injustificada').length
  const faltasJustificadas = mine.filter(s =>
    s.classification?.type === 'falta_justificada_pagada' ||
    s.classification?.type === 'falta_justificada_no_pagada'
  ).length
  const empMap = new Map(allEmployees.map(e => [e.id, e]))
  let grossPay = 0
  closed.forEach(s => {
    const cov = s.covering_employee_id ? empMap.get(s.covering_employee_id) : null
    grossPay += calcShiftPay(s, employee, cov, coveragePayMode)
  })
  const hr = monthlyToHourly(employee)
  const retardoDesc = retardos * (hr * 0.5)
  const incidentDesc = incidents * (hr * 8)
  return {
    totalH: parseFloat(totalH.toFixed(2)), otHours: parseFloat(otHours.toFixed(2)),
    retardos, incidents, faltasInjustificadas, faltasJustificadas, grossPay,
    retardoDesc, incidentDesc,
    netPay: Math.max(0, grossPay - retardoDesc - incidentDesc),
    shifts: mine
  }
}

export function countGraveIncidents(allShifts, employeeId) {
  return allShifts.filter(s =>
    s.employee_id === employeeId &&
    s.classification?.type === 'falta_injustificada'
  ).length
}

export function generateEmployeeCode(existing) {
  const nums = existing.map(e => parseInt(e.employee_code?.replace(/\D/g,'') || '0')).filter(Boolean)
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `EMP${String(next).padStart(3,'0')}`
}

export function slugify(text) {
  return text.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,50)
}
