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
  if (!s?.work || !s.start || !s.end) return 0
  const [h1,m1] = s.start.split(':').map(Number)
  const [h2,m2] = s.end.split(':').map(Number)
  if (![h1,m1,h2,m2].every(Number.isFinite)) return 0
  // FIX: soportar turnos que cruzan medianoche y evitar horas negativas.
  let minutes = (h2 * 60 + m2) - (h1 * 60 + m1)
  if (minutes < 0) minutes += 24 * 60
  return Math.max(0, minutes / 60)
}

// NUEVO — semanas equivalentes para empleados mixtos
// Mixto no tiene schedule fijo; usa daily_hours * días_por_semana_estimados (default 6).
// Para el cálculo de hourly rate usamos 6 días/semana como referencia razonable.
export const MIXED_DEFAULT_DAYS_PER_WEEK = 6

export function monthlyToHourly(employee) {
  const period = employee?.schedule?.salary_period || 'monthly'
  const salary = Math.max(0, Number(employee?.monthly_salary || 0))
  if (employee?.is_mixed) {
    const daily = Number(employee?.daily_hours || 0)
    const wkH = daily * MIXED_DEFAULT_DAYS_PER_WEEK
    if (wkH <= 0) return 0
    // FIX: normalizar salario para no propagar NaN a nómina.
    if (period === 'weekly') return salary / wkH
    return salary / (wkH * 4.33)
  }
  const wkH = DAYS.reduce((a,d) => a + hoursInSchedule(employee?.schedule||{}, d), 0)
  if (wkH <= 0) return 0
  // FIX: normalizar salario para no propagar NaN a nómina.
  if (period === 'weekly') return salary / wkH
  return salary / (wkH * 4.33)
}

export function salaryPeriodLabel(employee) {
  return employee.schedule?.salary_period === 'weekly' ? 'sem' : 'mes'
}

export function toMonthlySalary(employee) {
  const salary = Math.max(0, Number(employee?.monthly_salary || 0)) // FIX: evitar NaN en conversion de salario.
  if (employee?.schedule?.salary_period === 'weekly') return salary * 4.33
  return salary
}

// CAMBIO — classifyEntry compara en la TZ del tenant
export function classifyEntry(schedule, entryTime, toleranceMinutes, absenceMinutes = 60, tz = DEFAULT_TZ) {
  const dk = dayKey(entryTime, tz)
  const s = schedule?.[dk]
  if (s?.work && (!s.start || !/^\d{2}:\d{2}$/.test(String(s.start)))) return { type:'no_laboral', label:'Horario invalido' } // FIX: evitar Date invalida con horario incompleto.
  if (!s?.work) return { type:'no_laboral', label:'Día no laboral' }
  const dateStr = isoDate(entryTime, tz)
  const refUtc = fromZonedTime(`${dateStr}T${s.start}:00`, tz)
  const diff = Math.round((new Date(entryTime) - refUtc) / 60000)
  const tolerance = Math.max(0, Number(toleranceMinutes) || 0) // FIX: tolerancia invalida no debe volver NaN la clasificacion.
  const absence = Math.max(1, Number(absenceMinutes) || 60) // FIX: umbral falta configurable
  if (diff <= 0) return { type:'puntual', label:'Puntual' }
  if (diff <= tolerance) return { type:'tolerancia', label:`Tolerancia (${diff} min)` }
  if (diff <= absence) return { type:'retardo', label:`Retardo (${diff} min)` }
  return { type:'falta', label:`Falta (${diff} min tarde)` }
}

// NUEVO — gerentes con horario libre: siempre "libre", nunca retardo/no_laboral.
// Sólo registra checada para tracking; no penaliza ni descuenta.
export function classifyEntryFree() {
  return { type:'libre', label:'Horario libre' }
}

// NUEVO — clasificación para mixtos contra su shift_plan del día.
// plan = { entry_time_str: "HH:MM", duration_hours: N } del planificador.
// Si no hay plan → tipo "no_planificado" (se registra pero queda pendiente de revisión).
export function classifyEntryMixed(plan, entryTime, toleranceMinutes, tz = DEFAULT_TZ) {
  if (!plan || !plan.entry_time_str) {
    return { type:'no_planificado', label:'No estaba agendado' }
  }
  if (!/^\d{2}:\d{2}$/.test(String(plan.entry_time_str))) return { type:'no_planificado', label:'Plan invalido' } // FIX: evitar Date invalida con plan corrupto.
  const dateStr = isoDate(entryTime, tz)
  const refUtc = fromZonedTime(`${dateStr}T${plan.entry_time_str}:00`, tz)
  const diff = Math.round((new Date(entryTime) - refUtc) / 60000)
  const tolerance = Math.max(0, Number(toleranceMinutes) || 0) // FIX: tolerancia invalida no debe volver NaN la clasificacion.
  if (diff <= 0) return { type:'puntual', label:'Puntual' }
  if (diff <= tolerance) return { type:'tolerancia', label:`Tolerancia (${diff} min)` }
  return { type:'retardo', label:`Retardo (${diff} min)` }
}

// NUEVO — suma "HH:MM" + horas decimales → "HH:MM"
export function addHoursToTimeStr(timeStr, hours) {
  if (!timeStr) return null
  const [h, m] = String(timeStr).split(':').map(Number)
  const totalMin = (h * 60 + m) + Math.round(Number(hours || 0) * 60)
  const normalized = ((totalMin % (24 * 60)) + (24 * 60)) % (24 * 60)
  const hh = String(Math.floor(normalized / 60)).padStart(2, '0')
  const mm = String(normalized % 60).padStart(2, '0')
  return `${hh}:${mm}`
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

// Horas programadas para un día concreto. Mixto → plan.duration_hours; fijo → schedule[dk].
export function scheduledDayHours(employee, dateStr, tz = DEFAULT_TZ, plan = null) {
  if (employee?.is_mixed) return Math.max(0, Number(plan?.duration_hours || 0))
  const dk = dayKey(`${dateStr}T12:00:00Z`, tz)
  return hoursInSchedule(employee?.schedule || {}, dk)
}

// CAMBIO — scheduledExitDate usa TZ. Para mixtos usamos el shift_plan del día si existe.
export function scheduledExitDate(dateStr, employee, tz = DEFAULT_TZ, plan = null) {
  if (employee?.is_mixed) {
    const duration = Number(plan?.duration_hours || 0)
    if (!plan || !plan.entry_time_str || duration <= 0) return null
    const entryUtc = fromZonedTime(`${dateStr}T${plan.entry_time_str}:00`, tz)
    return new Date(entryUtc.getTime() + Math.round(duration * 60) * 60000) // FIX: soportar planes mixtos que cruzan medianoche.
  }
  const dk = dayKey(`${dateStr}T12:00:00Z`, tz)
  const s = employee.schedule?.[dk]
  if (!s?.work || !s.end) return null
  let exitDate = dateStr
  if (s.start && s.end <= s.start) {
    const d = new Date(`${dateStr}T00:00:00`)
    d.setDate(d.getDate() + 1)
    exitDate = formatInTimeZone(d, tz, 'yyyy-MM-dd') // FIX: salida de turno fijo nocturno cae al dia siguiente.
  }
  return fromZonedTime(`${exitDate}T${s.end}:00`, tz)
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

// Calculo de salario diario para PAGO DE VACACIONES.
// LFT art. 89 dicta salario diario = monthly_salary / 30.
export function computeDailyRate(employee) {
  if (!employee) return 0
  const salary = Number(employee.monthly_salary) || 0
  return salary / 30
}

function daysIntersect(aStart, aEnd, bStart, bEnd) {
  if (!aStart || !aEnd || !bStart || !bEnd) return 0
  const s = aStart > bStart ? aStart : bStart
  const e = aEnd < bEnd ? aEnd : bEnd
  if (s > e) return 0
  const d1 = new Date(s + 'T12:00:00')
  const d2 = new Date(e + 'T12:00:00')
  return Math.round((d2 - d1) / (24 * 3600 * 1000)) + 1
}

export function vacationPayForWeek(employee, periodsForEmp, weekStart, weekEnd) {
  const dailyRate = computeDailyRate(employee)
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

// CAMBIO — calcShiftPay contempla empleados mixtos:
//   - pago por horas REALES trabajadas (duration_hours)
//   - si trabajó > daily_hours → el exceso se paga como overtime (2x, LFT art. 67)
//   - festivo x3, día de descanso trabajado x2 (LFT art. 73)
//   - OT corrections pagadas a 2x; empWeekSummary escala a 3x para OT >9h/semana
export function calcShiftPay(shift, employee, coveringEmployee, coveragePayMode) {
  // FIX: faltas auto descuentan en nomina
  const ctype = shift.classification?.type
  if (ctype === 'falta_injustificada' || ctype === 'falta' || ctype === 'falta_justificada_no_pagada') return 0
  // Falta justificada con goce de sueldo: pagar horas programadas a tarifa base, sin OT ni multiplicadores.
  if (ctype === 'falta_justificada_pagada') {
    const hours = Math.max(0, Number(shift?.duration_hours || 0))
    const rate = Math.max(0, Number(monthlyToHourly(employee)) || 0)
    return hours * rate
  }
  const worked = Math.max(0, Number(shift?.duration_hours || 0)) // FIX: evitar nomina negativa/NaN por duration_hours invalido.
  if (!worked) return 0
  const payEmp = resolvePayEmployee(employee, coveringEmployee, coveragePayMode)
  const rate = Math.max(0, Number(monthlyToHourly(payEmp)) || 0) // FIX: evitar propagar NaN si salario/horario estan incompletos.
  const otCorrection = Math.max(0, Number(shift.corrections?.overtime?.hours || 0)) // FIX: OT manual nunca debe restar pago.
  if (shift.is_holiday) return worked * rate * 3
  if (shift.is_rest_day) return worked * rate * 2
  if (payEmp?.is_mixed) { // FIX: soportar empleado de pago ausente sin romper nomina.
    const daily = Number(payEmp?.daily_hours || 0)
    const extraAuto = daily > 0 ? Math.max(0, worked - daily) : 0
    const base = Math.min(worked, daily || worked)
    // Usar Math.max para evitar doble conteo cuando otCorrection refleja las mismas HE que extraAuto
    const otHours = Math.max(extraAuto, otCorrection)
    return base * rate + otHours * rate * 2
  }
  // duration_hours ya incluye las HE a 1x; otCorrection agrega solo la prima adicional (total 2x)
  return worked * rate + otCorrection * rate
}

export function empWeekSummary(employee, weekShifts, allEmployees, coveragePayMode) {
  const mine = (weekShifts || []).filter(s => s.employee_id === employee.id)
  const closed = mine.filter(s => ['closed','incident'].includes(s.status))
  // FIX nomina: faltas justificadas con goce de sueldo se pagan aunque queden con status='absent'.
  const paidAbsences = mine.filter(s =>
    s.status === 'absent' && s.classification?.type === 'falta_justificada_pagada'
  )
  const totalH = closed.reduce((a,s) => a + Math.max(0, Number(s.duration_hours || 0)), 0) // FIX: evitar total de horas negativo o NaN.
  const otHours = closed.reduce((a,s) => {
    const manual = Math.max(0, Number(s.corrections?.overtime?.hours || 0)) // FIX: OT manual invalida no debe contaminar acumuladores.
    // Mixto: el exceso sobre daily_hours también cuenta visualmente como OT.
    if (employee.is_mixed && employee.daily_hours) {
      const auto = Math.max(0, Number(s.duration_hours||0) - Number(employee.daily_hours))
      return a + Math.max(auto, manual)
    }
    return a + manual
  }, 0)
  const retardos = closed.filter(s => s.classification?.type === 'retardo').length
  const incidents = mine.filter(s => s.status === 'incident').length
  // FIX: faltas auto descuentan en nomina
  const faltasInjustificadas = mine.filter(s =>
    s.classification?.type === 'falta_injustificada' ||
    s.classification?.type === 'falta'
  ).length
  const faltasJustificadas = mine.filter(s =>
    s.classification?.type === 'falta_justificada_pagada' ||
    s.classification?.type === 'falta_justificada_no_pagada'
  ).length

  // feat/gerente-libre: nómina íntegra, sin descuentos por retardo/incidentes.
  if (employee.free_schedule) {
    const weeklyGross = Math.max(0, Number(toMonthlySalary(employee)) || 0) / 4.33 // FIX: evitar NaN en gerentes con salario vacio.
    return {
      totalH: parseFloat(totalH.toFixed(2)),
      otHours: 0,
      retardos: 0,
      incidents: 0,
      faltasInjustificadas: 0,
      faltasJustificadas: 0,
      grossPay: weeklyGross,
      retardoDesc: 0,
      incidentDesc: 0,
      netPay: weeklyGross,
      shifts: mine,
      free_schedule: true,
    }
  }

  const empMap = new Map((allEmployees || []).map(e => [e.id, e])) // FIX: soportar llamadas sin lista completa de empleados.
  let grossPay = 0
  closed.forEach(s => {
    const cov = s.covering_employee_id ? empMap.get(s.covering_employee_id) : null
    grossPay += calcShiftPay(s, employee, cov, coveragePayMode)
  })
  paidAbsences.forEach(s => {
    grossPay += calcShiftPay(s, employee, null, coveragePayMode)
  })
  const hr = Math.max(0, Number(monthlyToHourly(employee)) || 0) // FIX: descuentos no deben ser NaN.
  // LFT art. 68: OT >9h/semana se paga a 3x. calcShiftPay ya pagó 2x; agregamos el 1x extra.
  const otOver9 = Math.max(0, otHours - 9)
  if (otOver9 > 0) grossPay += otOver9 * hr
  const retardoDesc = retardos * (hr * 0.5)
  const incidentDesc = incidents * (hr * 8)
  return {
    totalH: parseFloat(totalH.toFixed(2)), otHours: parseFloat(otHours.toFixed(2)),
    retardos, incidents, faltasInjustificadas, faltasJustificadas, grossPay: Math.max(0, grossPay),
    retardoDesc, incidentDesc,
    netPay: Math.max(0, grossPay - retardoDesc - incidentDesc),
    shifts: mine
  }
}

// NUEVO — alertas de gerente con horario libre.
// Retorna lista de alertas { level: 'warn'|'error', code, message }.
// - días_trabajados_sem: # de días distintos con alguna checada en la semana
// - horas_trabajadas_sem: suma de duration_hours de shifts cerrados en la semana
export function managerFreeScheduleAlerts(employee, weekShifts) {
  if (!employee?.free_schedule) return []
  const mine = (weekShifts || []).filter(s => s.employee_id === employee.id)
  const closed = mine.filter(s => ['closed','incident'].includes(s.status))
  const daysSet = new Set(closed.map(s => s.date_str).filter(Boolean))
  const daysWorked = daysSet.size
  const hoursWorked = closed.reduce((a, s) => a + Number(s.duration_hours || 0), 0)
  const alerts = []
  const minDays = Number(employee.free_min_days_week ?? 0)
  const minHours = Number(employee.free_min_hours_week ?? 0)
  if (minDays > 0 && daysWorked < minDays) {
    alerts.push({
      level: daysWorked === 0 ? 'error' : 'warn',
      code: 'free_days_below',
      message: `Sólo checó ${daysWorked} día(s) esta semana (mínimo ${minDays}).`,
    })
  }
  if (minHours > 0 && hoursWorked < minHours) {
    alerts.push({
      level: hoursWorked === 0 ? 'error' : 'warn',
      code: 'free_hours_below',
      message: `Trabajó ${hoursWorked.toFixed(1)}h esta semana (mínimo ${minHours}h).`,
    })
  }
  // Alerta implícita si no hay checada de salida en un día con entrada.
  const openShifts = mine.filter(s => s.status === 'open').length
  if (openShifts > 0) {
    alerts.push({
      level: 'warn',
      code: 'free_open_shifts',
      message: `${openShifts} jornada(s) quedaron sin cierre (sin salida).`,
    })
  }
  return alerts
}

export function countGraveIncidents(allShifts, employeeId) {
  return allShifts.filter(s =>
    s.employee_id === employeeId &&
    // FIX: faltas auto descuentan en nomina
    (s.classification?.type === 'falta_injustificada' || s.classification?.type === 'falta')
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
