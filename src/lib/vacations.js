// src/lib/vacations.js
// Helpers de calculo del sistema de vacaciones CheckPro.
// Spec: docs/VACATIONS_SPEC.md
//
// IMPORTANTE: Las fechas de ingreso (hire_date) y de aniversario se
// almacenan como DATE (sin TZ) en la BD. Para evitar el bug clasico de
// `new Date("YYYY-MM-DD")` que se interpreta como UTC y puede regresar
// el dia anterior en zona horaria America/Mexico_City, parseamos los
// strings ISO manualmente con split('-') y construimos objetos Date
// locales.

// ---------------------------------------------------------------------
// Tabla LFT 2023 (default)
// ---------------------------------------------------------------------
export const LFT_2023_DEFAULT = [
  { fromYear: 1,  toYear: 1,   days: 12 },
  { fromYear: 2,  toYear: 2,   days: 14 },
  { fromYear: 3,  toYear: 3,   days: 16 },
  { fromYear: 4,  toYear: 4,   days: 18 },
  { fromYear: 5,  toYear: 5,   days: 20 },
  { fromYear: 6,  toYear: 10,  days: 22 },
  { fromYear: 11, toYear: 15,  days: 24 },
  { fromYear: 16, toYear: 20,  days: 26 },
  { fromYear: 21, toYear: 25,  days: 28 },
  { fromYear: 26, toYear: 30,  days: 30 },
  { fromYear: 31, toYear: 999, days: 32 },
]

// ---------------------------------------------------------------------
// Helpers internos de fechas (locales, sin TZ)
// ---------------------------------------------------------------------

/**
 * Parsea "YYYY-MM-DD" como Date en zona local.
 * Acepta tambien Date (lo regresa tal cual normalizado a medianoche).
 */
function parseLocalDate(value) {
  if (value == null) return null
  if (value instanceof Date) {
    return new Date(value.getFullYear(), value.getMonth(), value.getDate())
  }
  const s = String(value).slice(0, 10)
  const parts = s.split('-')
  if (parts.length !== 3) return null
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  if (!y || !m || !d) return null
  return new Date(y, m - 1, d)
}

function toISO(date) {
  if (!date) return null
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function diffDays(a, b) {
  // Dias completos entre dos fechas locales (b - a). Tolerante a DST.
  const MS = 24 * 60 * 60 * 1000
  const ua = Date.UTC(a.getFullYear(), a.getMonth(), a.getDate())
  const ub = Date.UTC(b.getFullYear(), b.getMonth(), b.getDate())
  return Math.round((ub - ua) / MS)
}

function addDays(date, n) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate())
  d.setDate(d.getDate() + n)
  return d
}

function todayLocal(today) {
  const t = today ? parseLocalDate(today) : new Date()
  return new Date(t.getFullYear(), t.getMonth(), t.getDate())
}

// ---------------------------------------------------------------------
// daysForYear
// ---------------------------------------------------------------------

/**
 * Regresa los dias de vacaciones para un anio de antiguedad dado.
 * @param {number} year - anio de antiguedad cumplido (1, 2, 3...)
 * @param {Array<{fromYear:number,toYear:number,days:number}>} table
 */
export function daysForYear(year, table = LFT_2023_DEFAULT) {
  if (!Number.isFinite(year) || year < 1) return 0
  const tbl = Array.isArray(table) && table.length > 0 ? table : LFT_2023_DEFAULT
  for (const row of tbl) {
    if (year >= row.fromYear && year <= row.toYear) return row.days
  }
  // Si la tabla custom no cubre, fallback a LFT default
  for (const row of LFT_2023_DEFAULT) {
    if (year >= row.fromYear && year <= row.toYear) return row.days
  }
  return 12
}

// ---------------------------------------------------------------------
// anniversaryInfo
// ---------------------------------------------------------------------

/**
 * Calcula informacion del proximo aniversario laboral.
 * @param {string|Date} hireDateISO - fecha de ingreso "YYYY-MM-DD" o Date
 * @param {string|Date} [today]
 * @returns {{
 *   yearsWorked: number,
 *   nextYear: number,
 *   nextAnnivDate: string,        // "YYYY-MM-DD"
 *   daysUntilNext: number,
 *   lastAnnivDate: string|null,   // "YYYY-MM-DD" o null si yearsWorked===0
 * }|null}
 */
export function anniversaryInfo(hireDateISO, today = new Date()) {
  const hire = parseLocalDate(hireDateISO)
  if (!hire) return null
  const t = todayLocal(today)

  // yearsWorked = anios completos entre hire y today
  let yearsWorked = t.getFullYear() - hire.getFullYear()
  const annivThisYear = new Date(t.getFullYear(), hire.getMonth(), hire.getDate())
  if (t < annivThisYear) yearsWorked -= 1
  if (yearsWorked < 0) yearsWorked = 0

  const nextYear = yearsWorked + 1
  const nextAnnivDate = new Date(
    hire.getFullYear() + nextYear, hire.getMonth(), hire.getDate()
  )
  const daysUntilNext = diffDays(t, nextAnnivDate)

  let lastAnnivDate = null
  if (yearsWorked > 0) {
    lastAnnivDate = new Date(
      hire.getFullYear() + yearsWorked, hire.getMonth(), hire.getDate()
    )
  }

  return {
    yearsWorked,
    nextYear,
    nextAnnivDate: toISO(nextAnnivDate),
    daysUntilNext,
    lastAnnivDate: lastAnnivDate ? toISO(lastAnnivDate) : null,
  }
}

// ---------------------------------------------------------------------
// upcomingAnniversaries
// ---------------------------------------------------------------------

/**
 * Empleados con aniversario en los proximos N dias (default 30).
 * Ordenados ascendente por fecha de aniversario.
 * @param {Array<{id:string,name:string,hire_date:string,...}>} employees
 * @param {string|Date} [today]
 * @param {number} [daysAhead=30]
 * @returns {Array<{employee:Object, info:Object}>}
 */
export function upcomingAnniversaries(employees, today, daysAhead = 30) {
  if (!Array.isArray(employees)) return []
  const t = todayLocal(today)
  const out = []
  for (const emp of employees) {
    if (!emp || !emp.hire_date) continue
    const info = anniversaryInfo(emp.hire_date, t)
    if (!info) continue
    if (info.daysUntilNext >= 0 && info.daysUntilNext <= daysAhead) {
      out.push({ employee: emp, info })
    }
  }
  out.sort((a, b) => a.info.daysUntilNext - b.info.daysUntilNext)
  return out
}

// ---------------------------------------------------------------------
// isOnVacation
// ---------------------------------------------------------------------

/**
 * Indica si el empleado esta actualmente en un periodo activo.
 * @param {Array<Object>} periodsForEmp - periodos del empleado
 * @param {string|Date} [today]
 * @returns {boolean}
 */
export function isOnVacation(periodsForEmp, today = new Date()) {
  if (!Array.isArray(periodsForEmp)) return false
  const t = todayLocal(today)
  for (const p of periodsForEmp) {
    if (!p || p.status !== 'active') continue
    const start = parseLocalDate(p.start_date)
    const end = parseLocalDate(p.end_date)
    if (!start || !end) continue
    if (t >= start && t <= end) return true
  }
  return false
}

// ---------------------------------------------------------------------
// extendForHolidays
// ---------------------------------------------------------------------

/**
 * Extiende end_date 1 dia por cada festivo que caiga en el rango
 * original [startDate, endDate] inclusive. La extension solo mira el
 * rango original (no acumula festivos sobre la extension), tal como
 * indica el spec: "extiende el periodo 1 dia por cada festivo encontrado
 * en el rango original".
 *
 * @param {string|Date} startDate
 * @param {string|Date} endDate
 * @param {string[]} holidays - array de "YYYY-MM-DD"
 * @returns {string} - nueva end_date en formato "YYYY-MM-DD"
 */
export function extendForHolidays(startDate, endDate, holidays) {
  const start = parseLocalDate(startDate)
  const end = parseLocalDate(endDate)
  if (!start || !end) return toISO(end || start)
  const list = Array.isArray(holidays) ? holidays : []
  const set = new Set(list.map((h) => String(h).slice(0, 10)))

  let extra = 0
  let cursor = new Date(start)
  while (cursor <= end) {
    if (set.has(toISO(cursor))) extra += 1
    cursor = addDays(cursor, 1)
  }
  return toISO(addDays(end, extra))
}

// ---------------------------------------------------------------------
// computeCompensationAmount
// ---------------------------------------------------------------------

/**
 * Calcula el monto a pagar cuando un empleado COMPENSA dias de
 * vacaciones (los trabaja en lugar de descansar). Pago doble.
 *
 * BUG 4: salario diario para vacaciones/LFT = monthly_salary / 30 (regla
 * LFT art. 89). NO dividir entre workDaysPerMonth (22/17/etc), ya que
 * jornadas <5 dias inflan el diario artificialmente.
 *
 * Se preserva workDaysPerMonth en el retorno por compatibilidad con UI/
 * metricas, pero ya no se usa para dailyRate.
 *
 * @param {Object} employee - debe traer monthly_salary y opcionalmente schedule
 * @param {number} days
 * @returns {{
 *   amount: number,
 *   workDaysPerMonth: number,
 *   dailyRate: number,
 *   doubleRate: number,
 * }}
 */
export function computeCompensationAmount(employee, days) {
  if (!employee || !Number.isFinite(days) || days <= 0) {
    return { amount: 0, workDaysPerMonth: 22, dailyRate: 0, doubleRate: 0 }
  }
  const salary = Number(employee.monthly_salary) || 0
  let workDaysPerWeek = 0
  const sched = employee.schedule
  if (sched && typeof sched === 'object') {
    for (const k of Object.keys(sched)) {
      const day = sched[k]
      if (day && day.work) workDaysPerWeek += 1
    }
  }
  const workDaysPerMonth = workDaysPerWeek > 0
    ? Math.round((workDaysPerWeek * 52) / 12)
    : 22
  // LFT art. 89: salario diario = mensual / 30.
  const dailyRate = salary / 30
  const doubleRate = dailyRate * 2
  const amount = doubleRate * days
  return {
    amount: Math.round(amount * 100) / 100,
    workDaysPerMonth,
    dailyRate: Math.round(dailyRate * 100) / 100,
    doubleRate: Math.round(doubleRate * 100) / 100,
  }
}

// ---------------------------------------------------------------------
// checkLFTWarnings
// ---------------------------------------------------------------------

/**
 * Devuelve advertencias visibles cuando el gerente baja por debajo de
 * los minimos de la LFT 2023.
 *
 * @param {{
 *   entitledDays:number,
 *   ltfBaseline:number,
 *   primaPct:number,
 * }} params
 * @returns {Array<{level:'yellow'|'red', code:string, msg:string}>}
 */
export function checkLFTWarnings({ entitledDays, ltfBaseline, primaPct } = {}) {
  const out = []
  if (Number.isFinite(entitledDays) && Number.isFinite(ltfBaseline)) {
    if (entitledDays < ltfBaseline) {
      out.push({
        level: 'yellow',
        code: 'days_below_lft',
        msg: `Otorgando ${entitledDays} dias; LFT 2023 marca ${ltfBaseline}.`,
      })
    }
  }
  if (Number.isFinite(primaPct)) {
    if (primaPct < 25) {
      out.push({
        level: 'yellow',
        code: 'prima_below_lft',
        msg: `Prima vacacional ${primaPct}% es menor al 25% que marca la LFT.`,
      })
    }
    if (primaPct < 0) {
      out.push({
        level: 'red',
        code: 'prima_negative',
        msg: 'La prima vacacional no puede ser negativa.',
      })
    }
  }
  return out
}
