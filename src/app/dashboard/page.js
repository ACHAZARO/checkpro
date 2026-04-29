'use client'
// src/app/dashboard/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { fmtTime, weekRange, isoDate, diffMin, DAYS, countGraveIncidents, hasVacationPending, calcVacationDays, managerFreeScheduleAlerts } from '@/lib/utils'
import Link from 'next/link'
import toast from 'react-hot-toast'
import BottomSheet from '@/components/BottomSheet'
import { Unlock, Palmtree, Cake, Award, AlertTriangle, Clock, ClipboardList, X, Info, Trophy } from 'lucide-react'

function daysUntilBirthday(iso) {
  if (!iso) return null
  const parts = String(iso).split('T')[0].split('-')
  if (parts.length !== 3) return null
  const m = parseInt(parts[1], 10) - 1
  const d = parseInt(parts[2], 10)
  if (!Number.isFinite(m) || !Number.isFinite(d)) return null
  const today = new Date()
  today.setHours(0, 0, 0, 0)

  // BUG 10: Feb 29 en anio no bisiesto -> JS hace overflow a 1-marzo.
  // Para 29/02 bajamos a 28/02 en anios no bisiestos. Tambien validamos
  // que el dia resultante en el mes objetivo coincida (si no, reajustar).
  function buildBirthdayIn(year) {
    const candidate = new Date(year, m, d)
    // Si JS hizo overflow (ej: 29/feb en no-bisiesto -> 1/mar),
    // regresamos el ultimo dia del mes objetivo.
    if (candidate.getMonth() !== m) {
      return new Date(year, m + 1, 0) // ultimo dia del mes m
    }
    return candidate
  }

  let next = buildBirthdayIn(today.getFullYear())
  if (next < today) next = buildBirthdayIn(today.getFullYear() + 1)
  const diff = Math.round((next - today) / (1000 * 60 * 60 * 24))
  return diff
}

function formatDDMM(iso) {
  if (!iso) return '—'
  const s = String(iso).slice(0, 10).split('-')
  if (s.length !== 3) return '—'
  return `${s[2]}/${s[1]}`
}

function StatCard({ label, value, color = 'text-white', sub, onClick }) {
  const Comp = onClick ? 'button' : 'div'
  return (
    <Comp
      {...(onClick ? { type: 'button', onClick } : {})}
      className={`stat-premium ${color} ${onClick ? 'w-full text-left cursor-pointer hover:bg-dark-card/50 transition' : ''}`}>
      <div className="stat-label" style={{ color: 'var(--cp-text-muted)' }}>{label}</div>
      <div className={`stat-value ${color}`}>{value}</div>
      {sub && <div className="stat-sub">{sub}</div>}
    </Comp>
  )
}

function ShiftBadge({ status, classification }) {
  if (status === 'open') return <span className="badge-blue">Activo</span>
  if (status === 'incident') return <span className="badge-red">Incidencia</span>
  const t = classification?.type
  if (t === 'falta') return <span className="badge-red">Falta</span>
  if (t === 'retardo') return <span className="badge-orange">Retardo</span>
  if (t === 'tolerancia') return <span className="badge-orange">Tolerancia</span>
  if (t === 'no_laboral') return <span className="badge-gray">No laboral</span>
  return <span className="badge-green">Completa</span>
}

function WidgetSkeleton({ title }) {
  return (
    <div className="card">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">{title}</p>
      <div className="space-y-2">
        <div className="h-10 bg-dark-700 rounded-lg animate-pulse" />
        <div className="h-10 bg-dark-700 rounded-lg animate-pulse" />
        <div className="h-10 bg-dark-700 rounded-lg animate-pulse" />
      </div>
    </div>
  )
}

function WidgetError({ title, onRetry }) {
  return (
    <div className="card">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">{title}</p>
      <div className="px-3 py-3 bg-red-500/10 border border-red-500/20 rounded-lg flex items-center justify-between">
        <span className="text-xs text-red-400 font-mono">No se pudo cargar</span>
        <button
          onClick={onRetry}
          className="text-xs font-bold text-red-400 underline">
          Reintentar
        </button>
      </div>
    </div>
  )
}

// Banner con botón X que persiste el "descartado" en localStorage.
// Si la firma del banner cambia (ej. sube el conteo de incidencias), se vuelve
// a mostrar porque la alertKey cambia.
function DismissibleBanner({ alertKey, className, children }) {
  const [dismissed, setDismissed] = useState(null) // null = pre-hydrate
  useEffect(() => {
    if (typeof window === 'undefined') return
    try {
      setDismissed(localStorage.getItem(`cp-dismissed:${alertKey}`) === '1')
    } catch {
      setDismissed(false)
    }
  }, [alertKey])
  if (dismissed === null) return null
  if (dismissed) return null
  return (
    <div className={`relative ${className || ''}`}>
      {children}
      <button
        onClick={() => {
          try { localStorage.setItem(`cp-dismissed:${alertKey}`, '1') } catch {}
          setDismissed(true)
        }}
        aria-label="Descartar alerta"
        title="Descartar"
        className="absolute top-2 right-2 p-1 rounded-md text-gray-400/80 hover:text-white hover:bg-white/10 transition-colors">
        <X size={14} />
      </button>
    </div>
  )
}

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  // FIX R6: vacation_periods vivos para poder evaluar hasVacationPending
  // con la tabla real (no contra el array legacy schedule.vacationYearsTaken).
  const [vacPeriods, setVacPeriods] = useState([])

  // Vacation widgets state
  const [vacUpcoming, setVacUpcoming] = useState({ loading: true, items: [], error: null })
  const [vacActive, setVacActive] = useState({ loading: true, items: [], error: null })
  const [vacExpired, setVacExpired] = useState({ loading: true, items: [], error: null })
  const [reactivating, setReactivating] = useState(null)
  const [ranking, setRanking] = useState({ loading: true, items: [], error: null })
  const [kpiSheet, setKpiSheet] = useState({ open: false, title: '', items: [], renderItem: null }) // FIX: KPIs clickeables

  const now = new Date()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { setLoading(false); return }
      const { data: profile } = await supabase.from('profiles').select('tenant_id,role,branch_id').eq('id', session.user.id).single()
      if (!profile?.tenant_id) { setLoading(false); return }
      setTenantId(profile.tenant_id)

      const today = isoDate(now)

      // FIX: branch isolation server-side
      const isManagerBranch = profile.role === 'manager' && !!profile.branch_id

      // Employees with shift
      let empQuery = supabase
        .from('employees').select('*').eq('tenant_id', profile.tenant_id).eq('status', 'active').eq('has_shift', true)
      if (isManagerBranch) empQuery = empQuery.eq('branch_id', profile.branch_id)
      const { data: employees } = await empQuery
      const myEmpIds = (employees || []).map(e => e.id)

      // Today's shifts
      let todayShiftsQuery = supabase
        .from('shifts').select('*').eq('tenant_id', profile.tenant_id).eq('date_str', today)
      if (isManagerBranch) todayShiftsQuery = myEmpIds.length ? todayShiftsQuery.in('employee_id', myEmpIds) : null
      const { data: todayShifts } = todayShiftsQuery ? await todayShiftsQuery : { data: [] }

      // Open incidents
      let incidentsQuery = supabase
        .from('shifts').select('id,employee_id').eq('tenant_id', profile.tenant_id).eq('status', 'incident')
      if (isManagerBranch) incidentsQuery = myEmpIds.length ? incidentsQuery.in('employee_id', myEmpIds) : null
      const { data: incidents } = incidentsQuery ? await incidentsQuery : { data: [] }

      // Grave incidents (last 12 months) for alert
      const cutoff12m = isoDate(new Date(Date.now() - 365 * 24 * 3600 * 1000))
      let graveShiftsQuery = supabase.from('shifts')
        .select('employee_id,classification')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'absent')
        .gte('date_str', cutoff12m)
      if (isManagerBranch) graveShiftsQuery = myEmpIds.length ? graveShiftsQuery.in('employee_id', myEmpIds) : null
      const { data: graveShifts } = graveShiftsQuery ? await graveShiftsQuery : { data: [] }

      // Tenant config for vacation table
      const { data: tenantData } = await supabase.from('tenants').select('config').eq('id', profile.tenant_id).single()
      const vacTable = tenantData?.config?.vacationTable || null

      // feat/gerente-libre — turnos de la semana actual para alertas de gerentes libres.
      const closingDayKey = tenantData?.config?.weekClosingDay || 'dom'
      const rangeWeek = weekRange(new Date(), closingDayKey)
      const weekStartStr = isoDate(rangeWeek.start)
      const weekEndStr = isoDate(rangeWeek.end)
      let weekShiftsQuery = supabase
        .from('shifts')
        .select('id, employee_id, date_str, duration_hours, status, classification')
        .eq('tenant_id', profile.tenant_id)
        .gte('date_str', weekStartStr)
        .lte('date_str', weekEndStr)
      if (isManagerBranch) weekShiftsQuery = myEmpIds.length ? weekShiftsQuery.in('employee_id', myEmpIds) : null
      const { data: weekShiftsData } = weekShiftsQuery ? await weekShiftsQuery : { data: [] }

      // FIX R6: cargar vacation_periods vivos (pending/postponed/active/completed)
      // para pasarlos a hasVacationPending(emp, periods).
      let vpQuery = supabase
        .from('vacation_periods')
        .select('employee_id,anniversary_year,status')
        .eq('tenant_id', profile.tenant_id)
        .in('status', ['pending', 'postponed', 'active', 'completed'])
      if (isManagerBranch) vpQuery = myEmpIds.length ? vpQuery.in('employee_id', myEmpIds) : null
      const { data: vpData } = vpQuery ? await vpQuery : { data: [] }
      setVacPeriods(vpData || [])

      setData({
        employees: employees || [],
        todayShifts: todayShifts || [],
        incidents: incidents || [],
        graveShifts: graveShifts || [],
        weekShifts: weekShiftsData || [],
        vacTable,
      })
      setLoading(false)
    }
    load()
  }, [])

  // ---- Vacation widgets: paralelo via API endpoints ----
  const fetchUpcoming = useCallback(async () => {
    setVacUpcoming(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch('/api/vacations/upcoming?days=30', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setVacUpcoming({ loading: false, items: j.items || [], error: null })
    } catch (e) {
      setVacUpcoming({ loading: false, items: [], error: e.message || 'error' })
    }
  }, [])

  const fetchActive = useCallback(async () => {
    setVacActive(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch('/api/vacations/active', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setVacActive({ loading: false, items: j.items || [], error: null })
    } catch (e) {
      setVacActive({ loading: false, items: [], error: e.message || 'error' })
    }
  }, [])

  const fetchExpired = useCallback(async () => {
    setVacExpired(s => ({ ...s, loading: true, error: null }))
    try {
      const r = await fetch('/api/vacations/expired', { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setVacExpired({ loading: false, items: j.items || [], error: null })
    } catch (e) {
      setVacExpired({ loading: false, items: [], error: e.message || 'error' })
    }
  }, [])

  const fetchRanking = useCallback(async () => {
    setRanking(s => ({ ...s, loading: true, error: null }))
    try {
      const now = new Date()
      const month = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
      const r = await fetch('/api/employees/ranking?month=' + month, { cache: 'no-store' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || 'HTTP ' + r.status)
      setRanking({ loading: false, items: j.items || j.ranking || [], error: null })
    } catch (e) {
      setRanking({ loading: false, items: [], error: e.message || 'error' })
    }
  }, [])

  useEffect(() => {
    Promise.all([fetchUpcoming(), fetchActive(), fetchExpired(), fetchRanking()])
  }, [fetchUpcoming, fetchActive, fetchExpired, fetchRanking])

  async function reactivatePeriod(id) {
    setReactivating(id)
    try {
      const r = await fetch(`/api/vacations/${id}/reactivate`, { method: 'POST' })
      const j = await r.json()
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`)
      toast.success('Periodo reactivado')
      await fetchExpired()
    } catch (e) {
      toast.error(e.message || 'No se pudo reactivar')
    } finally {
      setReactivating(null)
    }
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>
  if (!data) return null

  const { employees, todayShifts, incidents, graveShifts, vacTable, weekShifts = [] } = data
  const todayDayKey = DAYS[now.getDay() === 0 ? 6 : now.getDay() - 1]
  const todayScheduleStart = e => e.schedule?.[todayDayKey]?.start || null

  // feat/gerente-libre — alertas para gerentes con horario libre.
  const freeManagers = employees.filter(e => e.free_schedule)
  const freeAlerts = freeManagers.flatMap(emp => {
    const list = managerFreeScheduleAlerts(emp, weekShifts)
    return list.map(a => ({ ...a, employee: emp }))
  })
  const checkedIn = employees.filter(e => todayShifts.some(s => s.employee_id === e.id))

  // Employees with 3+ grave incidents
  const graveAlerts = employees.filter(e => countGraveIncidents(graveShifts, e.id) >= 3)
  // Employees with vacation pending
  // FIX R6: pasar vacPeriods como 2º arg (nueva signatura de hasVacationPending)
  const vacationPending = employees.filter(e => hasVacationPending(e, vacPeriods))
  // Upcoming birthdays in next 7 days (incluye hoy)
  const upcomingBirthdays = employees
    .filter(e => e.birth_date)
    .map(e => ({ ...e, _bdDays: daysUntilBirthday(e.birth_date) }))
    .filter(e => e._bdDays !== null && e._bdDays >= 0 && e._bdDays <= 7)
    .sort((a, b) => a._bdDays - b._bdDays)
  const notYet = employees.filter(e => { // FIX: gerentes horario libre
    const isManager = e.can_manage === true || e.role === 'manager'
    const hasNoStartToday = !todayScheduleStart(e)
    if (isManager && (e.schedule_free === true || e.free_schedule === true || hasNoStartToday)) return false
    return !todayShifts.some(s => s.employee_id === e.id)
  })
  const retardos = todayShifts.filter(s => s.classification?.type === 'retardo')
  const activeNow = todayShifts.filter(s => s.status === 'open')
  const getEmpName = id => employees.find(e => e.id === id)?.name || id
  const getShiftEmployee = shift => employees.find(e => e.id === shift.employee_id)
  const openKpiSheet = (title, items, renderItem) => { // FIX: KPIs clickeables
    setKpiSheet({ open: true, title, items, renderItem })
  }

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto">
      <div className="mb-6">
        <div className="page-eyebrow mb-2">Panel · {now.toLocaleDateString('es-MX', { weekday: 'long' })}</div>
        <h1 className="page-title">Hoy</h1>
        <p className="text-[13px] font-mono mt-1.5" style={{ color: 'var(--cp-text-muted)' }}>
          {now.toLocaleDateString('es-MX', { day: '2-digit', month: 'long', year: 'numeric' })} · {employees.length} empleado{employees.length !== 1 ? 's' : ''} activo{employees.length !== 1 ? 's' : ''}
        </p>
      </div>

      {incidents.length > 0 && (
        <DismissibleBanner alertKey={`${tenantId}:incidents:${incidents.length}`} className="mb-3">
          <Link href="/dashboard/incidencias?status=open" className="flex items-center gap-3 pl-4 pr-10 py-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-semibold">
            <AlertTriangle size={16} /> {incidents.length} incidencia{incidents.length !== 1 ? 's' : ''} sin resolver — toca para revisar →
          </Link>
        </DismissibleBanner>
      )}

      {graveAlerts.length > 0 && (
        <DismissibleBanner
          alertKey={`${tenantId}:grave:${graveAlerts.map(e => `${e.id}:${countGraveIncidents(graveShifts, e.id)}`).sort().join(',')}`}
          className="mb-3">
          <div className="pl-4 pr-10 py-3 bg-red-600/15 border border-red-600/30 rounded-xl">
            <p className="text-red-400 text-sm font-bold mb-1 flex items-center gap-1.5">
              <AlertTriangle size={14} /> ALERTA: {graveAlerts.length} empleado{graveAlerts.length > 1 ? 's' : ''} con 3+ faltas graves
            </p>
            {graveAlerts.map(e => {
              const n = countGraveIncidents(graveShifts, e.id)
              return (
                <div key={e.id} className="text-red-400/80 text-xs font-mono">
                  <Link href={`/dashboard/employees/${e.id}`} className="underline font-bold">
                    {e.name}
                  </Link> — {n} faltas injustificadas (posible causal de despido)
                </div>
              )
            })}
            <Link href="/dashboard/incidencias" className="inline-block mt-2 text-red-400 text-xs font-bold underline">
              Ver incidencias →
            </Link>
          </div>
        </DismissibleBanner>
      )}

      {freeAlerts.length > 0 && (
        <DismissibleBanner
          alertKey={`${tenantId}:free:${freeAlerts.map(a => `${a.employee.id}:${a.code}:${a.level}`).sort().join(',')}`}
          className="mb-3">
          <div className="pl-4 pr-10 py-3 bg-orange-500/10 border border-orange-500/30 rounded-xl">
            <p className="text-orange-300 text-sm font-bold mb-1 flex items-center gap-1.5">
              <Unlock size={14} /> Gerentes con horario libre — {freeAlerts.length} alerta{freeAlerts.length !== 1 ? 's' : ''} esta semana
            </p>
            <div className="space-y-1 mt-1">
              {freeAlerts.map((a, i) => (
                <div key={`${a.employee.id}_${a.code}_${i}`} className={`text-xs font-mono ${a.level === 'error' ? 'text-red-400' : 'text-orange-300/90'}`}>
                  {a.level === 'error' ? <X size={12} className="inline" /> : <AlertTriangle size={12} className="inline" />} {a.employee.name} — {a.message}
                </div>
              ))}
            </div>
            <Link href="/dashboard/employees" className="inline-block mt-2 text-orange-300 text-xs font-bold underline">
              Ver panel de gerentes →
            </Link>
          </div>
        </DismissibleBanner>
      )}

      {vacationPending.length > 0 && (
        <DismissibleBanner
          alertKey={`${tenantId}:vac:${vacationPending.map(e => e.id).sort().join(',')}`}
          className="mb-4">
          <div className="pl-4 pr-10 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
            <p className="text-yellow-400 text-sm font-bold mb-1 flex items-center gap-1.5">
              <Palmtree size={14} /> {vacationPending.length} empleado{vacationPending.length > 1 ? 's' : ''} con vacaciones pendientes
            </p>
            <div className="flex flex-wrap gap-1 mt-1">
              {vacationPending.map(e => (
                <span key={e.id} className="text-[10px] font-mono bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full text-yellow-400">
                  {e.name} · {calcVacationDays(e.hire_date || e.schedule?.hireDate, vacTable)}d
                </span>
              ))}
            </div>
            <Link href="/dashboard/employees" className="inline-block mt-2 text-yellow-400 text-xs font-bold underline">
              Gestionar empleados →
            </Link>
          </div>
        </DismissibleBanner>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Con entrada" value={checkedIn.length} color="text-brand-400" sub={`de ${employees.length}`} onClick={() => openKpiSheet('Con entrada', checkedIn, e => {
          const shift = todayShifts.find(s => s.employee_id === e.id)
          return `${e.name} · ${fmtTime(shift?.entry_time)}`
        })} />
        <StatCard label="Sin checar" value={notYet.length} color="text-orange-400" onClick={() => openKpiSheet('Sin checar', notYet, e => `${e.name} · ${e.department || 'Sin departamento'}`)} />
        <StatCard label="Retardos" value={retardos.length} color={retardos.length > 0 ? 'text-orange-400' : 'text-white'} onClick={() => openKpiSheet('Retardos', retardos, s => {
          const emp = getShiftEmployee(s)
          const labelMinutes = String(s.classification?.label || '').match(/(\d+)\s*min/i)?.[1]
          return `${emp?.name || s.employee_id} · ${labelMinutes || 0} min retardo`
        })} />
        <StatCard label="Activos ahora" value={activeNow.length} color="text-blue-400" onClick={() => openKpiSheet('Activos ahora', activeNow, s => `${getEmpName(s.employee_id)} · ${fmtTime(s.entry_time)} · ${diffMin(s.entry_time, now.toISOString())} min`)} />
      </div>

      {/* ---------- VACATIONS WIDGETS GRID ---------- */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-5">

        {/* A. Cumpleaños esta semana */}
        <div className="card">
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Cake size={12} /> Cumpleaños esta semana</p>
          {upcomingBirthdays.length === 0 ? (
            <p className="text-xs text-gray-400">No hay cumpleaños en los próximos 7 días.</p>
          ) : (
            <div className="space-y-2">
              {upcomingBirthdays.map(e => {
                const d = e._bdDays
                const rowClass = d === 0
                  ? 'bg-green-500/15 border-green-400/30'
                  : d === 1
                  ? 'bg-yellow-500/15 border-yellow-400/30'
                  : 'bg-dark-700 border-dark-border'
                const labelClass = d === 0
                  ? 'text-green-300'
                  : d === 1
                  ? 'text-yellow-300'
                  : 'text-gray-400'
                const text = d === 0
                  ? `Hoy cumple ${e.name}`
                  : d === 1
                  ? `Mañana cumple ${e.name}`
                  : `${e.name} en ${d} días`
                return (
                  <div key={e.id} className={`flex items-center justify-between px-3 py-2 border rounded-lg ${rowClass}`}>
                    <div className="text-sm text-white">{text}</div>
                    <div className={`text-[10px] font-mono font-bold ${labelClass}`}>
                      {formatDDMM(e.birth_date)}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* B. Aniversarios próximos (30 días) */}
        {vacUpcoming.loading ? (
          <WidgetSkeleton title="Aniversarios próximos" />
        ) : vacUpcoming.error ? (
          <WidgetError title="Aniversarios próximos" onRetry={fetchUpcoming} />
        ) : (
          <div className="card">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Award size={12} /> Aniversarios próximos (30d)</p>
            {vacUpcoming.items.length === 0 ? (
              <p className="text-xs text-gray-400">Sin aniversarios en los próximos 30 días.</p>
            ) : (
              <div className="space-y-2">
                {vacUpcoming.items.map(({ employee, info, entitled_days_next }) => {
                  const urgent = info.daysUntilNext < 7
                  const rowClass = urgent
                    ? 'bg-yellow-500/15 border-yellow-400/40'
                    : 'bg-dark-700 border-dark-border'
                  const IconC = urgent ? Clock : Award
                  return (
                    <div key={employee.id} className={`px-3 py-2 border rounded-lg ${rowClass}`}>
                      <div className="text-sm text-white flex items-center gap-2">
                        <IconC size={14} className={urgent ? 'text-yellow-300' : 'text-gray-400'} />
                        <span className="font-semibold">{employee.name}</span>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                        cumple {info.nextYear} año{info.nextYear === 1 ? '' : 's'} el {formatDDMM(info.nextAnnivDate)}
                        {' · '}{entitled_days_next} días vac.
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* C. En vacaciones hoy */}
        {vacActive.loading ? (
          <WidgetSkeleton title="En vacaciones hoy" />
        ) : vacActive.error ? (
          <WidgetError title="En vacaciones hoy" onRetry={fetchActive} />
        ) : (
          <div className="card">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Palmtree size={12} /> En vacaciones hoy</p>
            {vacActive.items.length === 0 ? (
              <p className="text-xs text-gray-400">Nadie de vacaciones hoy.</p>
            ) : (
              <div className="space-y-2">
                {vacActive.items.map(({ period, employee, coverage }) => {
                  const coverageName = Array.isArray(coverage) && coverage.length > 0
                    ? (coverage[0].name || coverage[0].employee_name || null)
                    : null
                  return (
                    <div key={period.id} className="px-3 py-2 border rounded-lg bg-purple-500/10 border-purple-400/30">
                      <div className="flex items-center justify-between gap-2">
                        <div className="text-sm text-white font-semibold">{employee?.name || 'Empleado'}</div>
                        <div className="text-[10px] font-mono text-purple-300">
                          hasta {formatDDMM(period.end_date)}
                        </div>
                      </div>
                      <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                        {employee?.department || 'sucursal'}
                        {coverageName && <> · cubre: {coverageName}</>}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* D. Prescripciones (expired) */}
        {vacExpired.loading ? (
          <WidgetSkeleton title="Vacaciones por vencer" />
        ) : vacExpired.error ? (
          <WidgetError title="Vacaciones por vencer" onRetry={fetchExpired} />
        ) : (
          <div className="card">
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
              <AlertTriangle size={12} /> Vacaciones por vencer
              <Info size={14} title="La LFT 2023 establece que los dias de vacaciones prescriben a los 18 meses sin uso. Aqui ves empleados con dias en riesgo." />
              {/* FIX: rename prescripciones */}
            </p>
            {vacExpired.items.length === 0 ? (
              <p className="text-xs text-gray-400">Sin periodos prescritos.</p>
            ) : (
              <div className="space-y-2">
                {vacExpired.items.map(({ period, employee }) => (
                  <div key={period.id} className="px-3 py-2 border rounded-lg bg-red-500/10 border-red-500/20">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm text-white">
                        <span className="font-semibold">{employee?.name || 'Empleado'}</span>
                        {' '}tiene <span className="font-bold text-red-300">{period.entitled_days || 0}</span> días prescritos
                      </div>
                      <button
                        onClick={() => reactivatePeriod(period.id)}
                        disabled={reactivating === period.id}
                        className="text-[10px] font-bold text-red-300 hover:text-red-200 underline disabled:opacity-50">
                        {reactivating === period.id ? '...' : 'Reactivar'}
                      </button>
                    </div>
                    <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                      {/* FIX R6: period.expiration_date no existe en el schema.
                          Mostramos solo el año de aniversario (el backend ya
                          filtra los expirados por prescripción 18m LFT). */}
                      {period.anniversary_year ? `año ${period.anniversary_year}` : 'prescrito'}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      </div>
      {/* ---------- /VACATIONS WIDGETS ---------- */}

      {ranking.loading ? (
        <div className="mb-5">
          <WidgetSkeleton title="Ranking del mes" />
        </div>
      ) : ranking.error ? (
        <div className="mb-5">
          <WidgetError title="Ranking del mes" onRetry={fetchRanking} />
        </div>
      ) : (
        <div className="card mb-5">
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5"><Award size={12} /> Ranking del mes</p>
          {ranking.items.length === 0 ? (
            <div className="text-center py-8">
              <div className="flex justify-center mb-2"><Trophy size={28} className="text-gray-500" /></div>
              <p className="text-sm text-gray-300 font-semibold">Aun no hay datos suficientes para el ranking de este mes</p>
              <p className="text-[11px] text-gray-500 font-mono mt-1">Las incidencias graves descalifican del ranking</p>
            </div>
          ) : (
            <div className="space-y-2">
              {ranking.items.map((item, index) => {
                const medalClass = index === 0
                  ? 'text-yellow-400'
                  : index === 1
                  ? 'text-gray-300'
                  : index === 2
                  ? 'text-orange-400'
                  : 'text-gray-500'
                return (
                  <div key={item.employee_id || item.name} className="flex items-center justify-between gap-3 px-3 py-2 border rounded-lg bg-dark-700 border-dark-border">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`text-lg font-extrabold font-mono w-6 text-center shrink-0 ${medalClass}`}>{index + 1}</div>
                      <div className="min-w-0">
                        {index === 0 && <div className="inline-block bg-yellow-500/20 text-yellow-300 border border-yellow-500/40 px-2 py-0.5 rounded text-[10px] font-mono uppercase tracking-wider mb-1">Empleado del mes</div>}
                        <div className="text-sm text-white font-semibold truncate">{item.name}</div>
                        <div className="text-[11px] text-gray-400 font-mono mt-0.5">
                          {item.puntual || 0}p / {item.tolerancia || 0}t / {item.retardo || 0}r / {item.dias_trabajados || 0}d
                        </div>
                      </div>
                    </div>
                    <div className="text-sm font-extrabold text-brand-400 font-mono">{item.score || 0}</div>
                  </div>
                )
              })}
            </div>
          )}
          {/* FIX: ranking siempre visible top 3 */}
        </div>
      )}

      {/* Active shifts */}
      {activeNow.length > 0 && (
        <div className="card mb-4">
          <div className="flex items-center gap-2 mb-3">
            <span className="w-2 h-2 rounded-full bg-brand-400 animate-pulse" />
            <span className="text-xs font-mono text-gray-500 uppercase tracking-wider">Jornadas activas</span>
          </div>
          {activeNow.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0">
              <div>
                <div className="font-semibold text-sm text-white">{getEmpName(s.employee_id)}</div>
                <div className="text-xs text-gray-400 font-mono">{fmtTime(s.entry_time)} · {diffMin(s.entry_time, now.toISOString())} min</div>
              </div>
              <span className="badge-blue">Activo</span>
            </div>
          ))}
        </div>
      )}

      {/* Not checked in */}
      {notYet.length > 0 && (
        <div className="card mb-4">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Sin registro hoy</div>
          {notYet.map(e => (
            <div key={e.id} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0">
              <div>
                <div className="font-semibold text-sm text-white">{e.name}</div>
                <div className="text-xs text-gray-400">
                  {e.department} · {todayScheduleStart(e) ? `desde ${todayScheduleStart(e)}` : 'Horario libre'}
                  {/* FIX: gerentes horario libre */}
                </div>
              </div>
              <span className="badge-gray">Sin registro</span>
            </div>
          ))}
        </div>
      )}

      {/* All today */}
      {todayShifts.length > 0 && (
        <div className="card">
          <div className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">Todos los registros de hoy</div>
          {todayShifts.map(s => (
            <div key={s.id} className="flex items-center justify-between py-2.5 border-b border-dark-border last:border-0">
              <div>
                <div className="font-semibold text-sm text-white">{getEmpName(s.employee_id)}</div>
                <div className="text-xs text-gray-400 font-mono">
                  {fmtTime(s.entry_time)} – {s.exit_time ? fmtTime(s.exit_time) : '—'}
                  {s.duration_hours ? ` · ${s.duration_hours}h` : ''}
                </div>
                {s.covering_employee_id && (
                  <div className="text-xs text-blue-400 font-mono">Cubriendo: {getEmpName(s.covering_employee_id)}</div>
                )}
              </div>
              <ShiftBadge status={s.status} classification={s.classification} />
            </div>
          ))}
        </div>
      )}

      {checkedIn.length === 0 && notYet.length === 0 && (
        <div className="text-center py-12 text-gray-400">
          <div className="flex justify-center mb-3"><ClipboardList size={40} /></div>
          <p className="font-mono text-sm">Sin empleados registrados aún.</p>
          <Link href="/dashboard/employees" className="text-brand-400 text-sm font-semibold mt-2 inline-block">+ Agregar empleados →</Link>
        </div>
      )}

      <BottomSheet
        open={kpiSheet.open}
        title={kpiSheet.title}
        onClose={() => setKpiSheet(s => ({ ...s, open: false }))}>
        {/* FIX: KPIs clickeables */}
        {kpiSheet.items.length === 0 ? (
          <p className="text-xs text-gray-400 font-mono">Sin empleados en este grupo</p>
        ) : (
          <div className="space-y-2">
            {kpiSheet.items.map((item, index) => (
              <div key={item.id || item.employee_id || index} className="px-3 py-2 bg-dark-700 border border-dark-border rounded-lg text-sm text-white">
                {kpiSheet.renderItem ? kpiSheet.renderItem(item) : String(item?.name || item?.employee_id || item)}
              </div>
            ))}
          </div>
        )}
      </BottomSheet>
    </div>
  )
}
