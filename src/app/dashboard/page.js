'use client'
// src/app/dashboard/page.js
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase'
import { fmtTime, weekRange, isoDate, diffMin, DAYS, countGraveIncidents, hasVacationPending, calcVacationDays } from '@/lib/utils'
import Link from 'next/link'

function daysUntilBirthday(iso) {
  if (!iso) return null
  const parts = String(iso).split('T')[0].split('-')
  if (parts.length !== 3) return null
  const m = parseInt(parts[1], 10) - 1
  const d = parseInt(parts[2], 10)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  let next = new Date(today.getFullYear(), m, d)
  if (next < today) next = new Date(today.getFullYear() + 1, m, d)
  const diff = Math.round((next - today) / (1000 * 60 * 60 * 24))
  return diff
}

function StatCard({ label, value, color = 'text-white', sub }) {
  return (
    <div className="card-sm">
      <div className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-1">{label}</div>
      <div className={`text-3xl font-extrabold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

function ShiftBadge({ status, classification }) {
  if (status === 'open') return <span className="badge-blue">Activo</span>
  if (status === 'incident') return <span className="badge-red">Incidencia</span>
  const t = classification?.type
  if (t === 'retardo') return <span className="badge-orange">Retardo</span>
  if (t === 'tolerancia') return <span className="badge-orange">Tolerancia</span>
  if (t === 'no_laboral') return <span className="badge-gray">No laboral</span>
  return <span className="badge-green">Completa</span>
}

export default function DashboardPage() {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  const now = new Date()

  useEffect(() => {
    async function load() {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) return
      const { data: profile } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
      if (!profile?.tenant_id) return
      setTenantId(profile.tenant_id)

      const today = isoDate(now)

      // Employees with shift
      const { data: employees } = await supabase
        .from('employees').select('*').eq('tenant_id', profile.tenant_id).eq('status', 'active').eq('has_shift', true)

      // Today's shifts
      const { data: todayShifts } = await supabase
        .from('shifts').select('*').eq('tenant_id', profile.tenant_id).eq('date_str', today)

      // Open incidents
      const { data: incidents } = await supabase
        .from('shifts').select('id,employee_id').eq('tenant_id', profile.tenant_id).eq('status', 'incident')

      // Grave incidents (last 12 months) for alert
      const cutoff12m = isoDate(new Date(Date.now() - 365 * 24 * 3600 * 1000))
      const { data: graveShifts } = await supabase.from('shifts')
        .select('employee_id,classification')
        .eq('tenant_id', profile.tenant_id)
        .eq('status', 'absent')
        .gte('date_str', cutoff12m)

      // Tenant config for vacation table
      const { data: tenantData } = await supabase.from('tenants').select('config').eq('id', profile.tenant_id).single()
      const vacTable = tenantData?.config?.vacationTable || null

      setData({
        employees: employees || [],
        todayShifts: todayShifts || [],
        incidents: incidents || [],
        graveShifts: graveShifts || [],
        vacTable,
      })
      setLoading(false)
    }
    load()
  }, [])

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>
  if (!data) return null

  const { employees, todayShifts, incidents, graveShifts, vacTable } = data
  const checkedIn = employees.filter(e => todayShifts.some(s => s.employee_id === e.id))

  // Employees with 3+ grave incidents
  const graveAlerts = employees.filter(e => countGraveIncidents(graveShifts, e.id) >= 3)
  // Employees with vacation pending
  const vacationPending = employees.filter(e => hasVacationPending(e))
  // Upcoming birthdays in next 7 days (incluye hoy)
  const upcomingBirthdays = employees
    .filter(e => e.birth_date)
    .map(e => ({ ...e, _bdDays: daysUntilBirthday(e.birth_date) }))
    .filter(e => e._bdDays !== null && e._bdDays >= 0 && e._bdDays <= 7)
    .sort((a, b) => a._bdDays - b._bdDays)
  const notYet = employees.filter(e => !todayShifts.some(s => s.employee_id === e.id))
  const retardos = todayShifts.filter(s => s.classification?.type === 'retardo')
  const activeNow = todayShifts.filter(s => s.status === 'open')
  const getEmpName = id => employees.find(e => e.id === id)?.name || id

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Hoy</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">
          {now.toLocaleDateString('es-MX', { weekday: 'long', day: '2-digit', month: 'long' }).toUpperCase()}
        </p>
      </div>

      {incidents.length > 0 && (
        <Link href="/dashboard/attendance?filter=incident" className="flex items-center gap-3 px-4 py-3 mb-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-400 text-sm font-semibold">
          🚩 {incidents.length} incidencia(s) sin resolver — toca para revisar →
        </Link>
      )}

      {graveAlerts.length > 0 && (
        <div className="px-4 py-3 mb-3 bg-red-600/15 border border-red-600/30 rounded-xl">
          <p className="text-red-400 text-sm font-bold mb-1">
            🚨 ALERTA: {graveAlerts.length} empleado{graveAlerts.length > 1 ? 's' : ''} con 3+ faltas graves
          </p>
          {graveAlerts.map(e => {
            const n = countGraveIncidents(graveShifts, e.id)
            return (
              <div key={e.id} className="text-red-400/80 text-xs font-mono">
                {e.name} — {n} faltas injustificadas (posible causal de despido)
              </div>
            )
          })}
          <Link href="/dashboard/attendance" className="inline-block mt-2 text-red-400 text-xs font-bold underline">
            Ver historial →
          </Link>
        </div>
      )}

      {vacationPending.length > 0 && (
        <div className="px-4 py-3 mb-4 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
          <p className="text-yellow-400 text-sm font-bold mb-1">
            🏖 {vacationPending.length} empleado{vacationPending.length > 1 ? 's' : ''} con vacaciones pendientes
          </p>
          <div className="flex flex-wrap gap-1 mt-1">
            {vacationPending.map(e => (
              <span key={e.id} className="text-[10px] font-mono bg-yellow-500/10 border border-yellow-500/20 px-2 py-0.5 rounded-full text-yellow-400">
                {e.name} · {calcVacationDays(e.schedule?.hireDate, vacTable)}d
              </span>
            ))}
          </div>
          <Link href="/dashboard/employees" className="inline-block mt-2 text-yellow-400 text-xs font-bold underline">
            Gestionar empleados →
          </Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 mb-5">
        <StatCard label="Con entrada" value={checkedIn.length} color="text-brand-400" sub={`de ${employees.length}`} />
        <StatCard label="Sin checar" value={notYet.length} color="text-orange-400" />
        <StatCard label="Retardos" value={retardos.length} color={retardos.length > 0 ? 'text-orange-400' : 'text-white'} />
        <StatCard label="Activos ahora" value={activeNow.length} color="text-blue-400" />
      </div>

      {/* Upcoming birthdays widget */}
      <div className="card mb-4">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-3">🎂 Cumpleaños esta semana</p>
        {upcomingBirthdays.length === 0 ? (
          <p className="text-xs text-gray-600">Sin cumpleaños en los próximos 7 días.</p>
        ) : (
          <div className="space-y-2">
            {upcomingBirthdays.map(e => {
              const d = e._bdDays
              const label = d === 0 ? 'HOY' : d === 1 ? 'MAÑANA' : `en ${d} días`
              const rowClass = d === 0
                ? 'bg-pink-500/10 border-pink-400/30'
                : d === 1
                ? 'bg-yellow-500/10 border-yellow-400/30'
                : 'bg-dark-700 border-dark-border'
              const labelClass = d === 0
                ? 'text-pink-300'
                : d === 1
                ? 'text-yellow-300'
                : 'text-gray-400'
              return (
                <div key={e.id} className={`flex items-center justify-between px-3 py-2 border rounded-lg ${rowClass}`}>
                  <div>
                    <div className="text-sm text-white">{e.name}</div>
                    <div className="text-[10px] text-gray-500 font-mono">{e.department || ''}</div>
                  </div>
                  <div className={`text-[10px] font-mono font-bold ${labelClass}`}>{label}</div>
                </div>
              )
            })}
          </div>
        )}
      </div>

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
                <div className="text-xs text-gray-500 font-mono">{fmtTime(s.entry_time)} · {diffMin(s.entry_time, now.toISOString())} min</div>
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
                <div className="text-xs text-gray-500">{e.department} · desde {e.schedule?.[DAYS[now.getDay()===0?6:now.getDay()-1]]?.start || '—'}</div>
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
                <div className="text-xs text-gray-500 font-mono">
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
        <div className="text-center py-12 text-gray-600">
          <div className="text-4xl mb-3">📋</div>
          <p className="font-mono text-sm">Sin empleados registrados aún.</p>
          <Link href="/dashboard/employees" className="text-brand-400 text-sm font-semibold mt-2 inline-block">+ Agregar empleados →</Link>
        </div>
      )}
    </div>
  )
}
