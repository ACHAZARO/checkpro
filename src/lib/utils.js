// src/lib/utils.js
import { clsx } from 'clsx'

export function cn(...inputs) { return clsx(inputs) }

export const DAYS = ['lun','mar','mie','jue','vie','sab','dom']
export const DAY_L = { lun:'Lun',mar:'Mar',mie:'Mié',jue:'Jue',vie:'Vie',sab:'Sáb',dom:'Dom' }
export const DAY_FL = { lun:'Lunes',mar:'Martes',mie:'Miércoles',jue:'Jueves',vie:'Viernes',sab:'Sábado',dom:'Domingo' }

export const fmtTime = d => d ? new Date(d).toLocaleTimeString('es-MX', { hour:'2-digit', minute:'2-digit' }) : '--:--'
export const fmtDate = d => d ? new Date(d).toLocaleDateString('es-MX', { weekday:'short', day:'2-digit', month:'short' }) : ''
export const fmtDateFull = d => d ? new Date(d).toLocaleDateString('es-MX', { day:'2-digit', month:'2-digit', year:'numeric' }) : ''
export const fmtDT = d => d ? `${fmtDate(d)} ${fmtTime(d)}` : ''
export const isoDate = d => new Date(d).toISOString().slice(0,10)
export const diffMin = (a,b) => Math.round((new Date(b)-new Date(a))/60000)
export const diffHrs = (a,b) => (new Date(b)-new Date(a))/3600000
export const dayKey = d => { const i = new Date(d).getDay(); return DAYS[i===0?6:i-1] }

export function hoursInSchedule(schedule, dk) {
  const s = schedule?.[dk]
  if (!s?.work) return 0
  const [h1,m1] = s.start.split(':').map(Number)
  const [h2,m2] = s.end.split(':').map(Number)
  return (h2*60+m2-h1*60-m1)/60
}

export function monthlyToHourly(employee) {
  const wkH = DAYS.reduce((a,d) => a + hoursInSchedule(employee.schedule||{}, d), 0)
  const moH = wkH * 4.33
  return moH > 0 ? employee.monthly_salary / moH : 0
}

export function classifyEntry(schedule, entryTime, toleranceMinutes) {
  const dk = dayKey(entryTime)
  const s = schedule?.[dk]
  if (!s?.work) return { type:'no_laboral', label:'Día no laboral' }
  const [h,m] = s.start.split(':').map(Number)
  const ref = new Date(entryTime)
  ref.setHours(h, m, 0, 0)
  const diff = Math.round((new Date(entryTime) - ref) / 60000)
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

export function weekRange(refDate, closingDay) {
  const d = new Date(refDate)
  const ci = DAYS.indexOf(closingDay)
  const cur = d.getDay()===0 ? 6 : d.getDay()-1
  const end = new Date(d)
  end.setDate(d.getDate() + (ci-cur+7)%7)
  end.setHours(23,59,59,999)
  const start = new Date(end)
  start.setDate(end.getDate()-6)
  start.setHours(0,0,0,0)
  return { start, end }
}

export function calcShiftPay(shift, employee, coveringEmployee) {
  if (!shift.duration_hours) return 0
  const rate = monthlyToHourly(coveringEmployee || employee)
  let pay = shift.duration_hours * rate
  if (shift.is_holiday) pay *= 3
  return pay
}

export function empWeekSummary(employee, weekShifts, allEmployees) {
  const mine = weekShifts.filter(s => s.employee_id === employee.id)
  const closed = mine.filter(s => ['closed','incident'].includes(s.status))
  const totalH = closed.reduce((a,s) => a + (s.duration_hours||0), 0)
  const retardos = closed.filter(s => s.classification?.type === 'retardo').length
  const incidents = mine.filter(s => s.status === 'incident').length
  let grossPay = 0
  closed.forEach(s => {
    const cov = s.covering_employee_id ? allEmployees.find(e=>e.id===s.covering_employee_id) : null
    grossPay += calcShiftPay(s, employee, cov)
  })
  const hr = monthlyToHourly(employee)
  const retardoDesc = retardos * (hr * 0.5)
  const incidentDesc = incidents * (hr * 8)
  return {
    totalH: parseFloat(totalH.toFixed(2)),
    retardos, incidents, grossPay,
    retardoDesc, incidentDesc,
    netPay: Math.max(0, grossPay - retardoDesc - incidentDesc),
    shifts: mine
  }
}

export function generateEmployeeCode(existing) {
  const nums = existing.map(e => parseInt(e.employee_code?.replace(/\D/g,'') || '0')).filter(Boolean)
  const next = nums.length > 0 ? Math.max(...nums) + 1 : 1
  return `EMP${String(next).padStart(3,'0')}`
}

export function slugify(text) {
  return text.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').slice(0,50)
}
