'use client'
// src/app/dashboard/planning/page.js
// feat/mixed-schedule — Planificador semanal para empleados con horario mixto.
// Acceso: owner / manager / super_admin (controlado también desde layout).
import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { useTheme } from '@/lib/ThemeContext'
import { DAYS, DAY_L, addHoursToTimeStr } from '@/lib/utils'
import toast from 'react-hot-toast'
import BranchFilter from '@/components/BranchFilter'

function localDateISO(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function mondayOf(dateIso) {
  const [y, m, d] = dateIso.split('-').map(Number)
  const dt = new Date(y, m - 1, d)
  const dow = (dt.getDay() + 6) % 7 // Mon=0
  dt.setDate(dt.getDate() - dow)
  return localDateISO(dt)
}

function weekDates(mondayIso) {
  const [y, m, d] = mondayIso.split('-').map(Number)
  const base = new Date(y, m - 1, d)
  const out = []
  for (let i = 0; i < 7; i++) {
    const t = new Date(base); t.setDate(base.getDate() + i)
    out.push(localDateISO(t))
  }
  return out
}

function addDaysIso(iso, n) {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(y, m - 1, d); dt.setDate(dt.getDate() + n)
  return localDateISO(dt)
}

const MESES_CORTOS = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic']
function prettyRange(startIso, endIso) {
  const [,sm,sd] = startIso.split('-').map(Number)
  const [,em,ed] = endIso.split('-').map(Number)
  return `${sd} ${MESES_CORTOS[sm-1]} - ${ed} ${MESES_CORTOS[em-1]}`
}

export default function PlanningPage() {
  const router = useRouter()
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [loading, setLoading] = useState(true)
  const [tenant, setTenant] = useState(null)
  const [mixedEmps, setMixedEmps] = useState([])
  const [weekStart, setWeekStart] = useState(mondayOf(localDateISO(new Date())))
  // plans: key `${empId}|${dateStr}` → { entry_time_str, duration_hours, exit_time_str }
  const [plans, setPlans] = useState({})
  const [saving, setSaving] = useState(false)
  const [savedMeta, setSavedMeta] = useState(null) // weekly_plans row para la semana actual
  const [profile, setProfile] = useState(null)
  const [branches, setBranches] = useState([])
  const [selectedBranchId, setSelectedBranchId] = useState('all')

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (!prof) { router.push('/onboarding'); return }
    if (!['owner','manager','super_admin'].includes(prof.role)) {
      toast.error('No tienes permiso para acceder al planificador')
      router.push('/dashboard')
      return
    }
    setProfile(prof)
    const [{ data: ten }, { data: branchData }] = await Promise.all([
      supabase.from('tenants').select('*').eq('id', prof.tenant_id).single(),
      supabase.from('branches').select('id,name,config').eq('tenant_id', prof.tenant_id).order('created_at'),
    ])
    // FIX: mixedSchedule por sucursal
    const visibleBranches = prof.role === 'manager' && prof.branch_id
      ? (branchData || []).filter(b => b.id === prof.branch_id)
      : (branchData || [])
    setBranches(visibleBranches)
    setSelectedBranchId(cur => {
      if (prof.role === 'manager' && prof.branch_id) return prof.branch_id
      if (cur !== 'all' && visibleBranches.some(b => b.id === cur)) return cur
      return 'all'
    })
    const mixedEnabled = visibleBranches.length > 0
      ? visibleBranches.some(b => (b.config?.mixedSchedule || ten?.config?.mixedSchedule)?.enabled === true)
      : ten?.config?.mixedSchedule?.enabled === true
    if (!mixedEnabled) {
      toast.error('Activa "Horario mixto" en Configuración primero')
      router.push('/dashboard/settings')
      return
    }
    setTenant(ten)

    // Cargar metadata de "planificación guardada" (weekly_plans) para esta semana
    const wkEnd = addDaysIso(weekStart, 6)
    // FIX: branch isolation server-side
    let wpQuery = supabase
      .from('weekly_plans')
      .select('id, start_date, end_date, title, saved_by_name, saved_at, notes')
      .eq('tenant_id', prof.tenant_id)
      .eq('start_date', weekStart)
    if (prof.role === 'manager' && prof.branch_id) wpQuery = wpQuery.eq('branch_id', prof.branch_id)
    else if (selectedBranchId !== 'all') wpQuery = wpQuery.eq('branch_id', selectedBranchId)
    else wpQuery = wpQuery.is('branch_id', null)
    const { data: wp } = await wpQuery.maybeSingle()
    setSavedMeta(wp || null)
    let empQuery = supabase
      .from('employees')
      .select('id, name, department, employee_code, daily_hours, is_mixed, status, branch_id')
      .eq('tenant_id', prof.tenant_id)
      .eq('status', 'active')
      .eq('is_mixed', true)
      .order('name')
    if (prof.role === 'manager' && prof.branch_id) empQuery = empQuery.eq('branch_id', prof.branch_id)
    else if (selectedBranchId !== 'all') empQuery = empQuery.eq('branch_id', selectedBranchId)
    const { data: emps } = await empQuery
    setMixedEmps(emps || [])

    const dates = weekDates(weekStart)
    const res = await fetch(`/api/shift-plans?start=${dates[0]}&end=${dates[6]}`)
    const body = await res.json().catch(() => ({}))
    const map = {}
    ;(body.plans || []).forEach(p => {
      map[`${p.employee_id}|${p.date_str}`] = {
        entry_time_str: p.entry_time_str,
        duration_hours: Number(p.duration_hours),
        exit_time_str: p.exit_time_str,
      }
    })
    setPlans(map)
    setLoading(false)
  }, [router, weekStart, selectedBranchId])

  useEffect(() => { load() }, [load])

  function setCell(empId, dateStr, entry) {
    const emp = mixedEmps.find(e => e.id === empId)
    if (!emp) return
    const key = `${empId}|${dateStr}`
    setPlans(p => {
      const copy = { ...p }
      if (!entry) { delete copy[key]; return copy }
      const duration = Number(emp.daily_hours || 8)
      copy[key] = {
        entry_time_str: entry,
        duration_hours: duration,
        exit_time_str: addHoursToTimeStr(entry, duration),
      }
      return copy
    })
  }

  async function save() {
    setSaving(true)
    const dates = weekDates(weekStart)
    const payload = []
    for (const emp of mixedEmps) {
      for (const d of dates) {
        const key = `${emp.id}|${d}`
        const cell = plans[key]
        if (cell?.entry_time_str) {
          payload.push({ employee_id: emp.id, date_str: d, entry_time_str: cell.entry_time_str, duration_hours: cell.duration_hours })
        } else {
          payload.push({ employee_id: emp.id, date_str: d, entry_time_str: null })
        }
      }
    }
    const res = await fetch('/api/shift-plans', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plans: payload }),
    })
    const body = await res.json().catch(() => ({}))
    if (!res.ok) { setSaving(false); toast.error(body.error || 'Error al guardar'); return }

    // feat/candado: marcar la planificación como "guardada" en weekly_plans
    // (aunque la semana esté vacía — el guardado explícito es lo que habilita el corte).
    try {
      const supabase = createClient()
      const endIso = addDaysIso(weekStart, 6)
      const title = `Planificación semanal ${prettyRange(weekStart, endIso)}`
      const { data: up, error: upErr } = await supabase
        .from('weekly_plans')
        .upsert({
          tenant_id: profile?.tenant_id,
          // FIX: guardar metadata de plan por sucursal seleccionada del perfil.
          branch_id: (profile?.role === 'manager' ? profile?.branch_id : (selectedBranchId !== 'all' ? selectedBranchId : null)) || null,
          start_date: weekStart,
          end_date: endIso,
          title,
          saved_by: profile?.id || null,
          saved_by_name: profile?.name || null,
          saved_at: new Date().toISOString(),
        }, { onConflict: 'tenant_id,branch_id,start_date' })
        .select('id, start_date, end_date, title, saved_by_name, saved_at, notes')
        .single()
      if (!upErr) setSavedMeta(up)
    } catch (e) {
      console.warn('[planning] no se pudo registrar weekly_plans:', e?.message)
    }

    setSaving(false)
    toast.success(`Plan guardado · ${body.saved || 0} entradas, ${body.deleted || 0} eliminadas`)
  }

  async function copyPrevWeek() {
    const prev = addDaysIso(weekStart, -7)
    const prevDates = weekDates(prev)
    const res = await fetch(`/api/shift-plans?start=${prevDates[0]}&end=${prevDates[6]}`)
    const body = await res.json().catch(() => ({}))
    const prevMap = {}
    ;(body.plans || []).forEach(p => { prevMap[`${p.employee_id}|${p.date_str}`] = p })
    const thisDates = weekDates(weekStart)
    const next = {}
    mixedEmps.forEach(emp => {
      for (let i = 0; i < 7; i++) {
        const p = prevMap[`${emp.id}|${prevDates[i]}`]
        if (p?.entry_time_str) {
          next[`${emp.id}|${thisDates[i]}`] = {
            entry_time_str: p.entry_time_str,
            duration_hours: Number(p.duration_hours),
            exit_time_str: p.exit_time_str,
          }
        }
      }
    })
    setPlans(next)
    toast.success('Plan copiado. Revisa y presiona Guardar.')
  }

  async function exportPdf() {
    const { default: jsPDF } = await import('jspdf')
    await import('jspdf-autotable')
    const doc = new jsPDF({ orientation: 'landscape' })
    const dates = weekDates(weekStart)
    doc.setFontSize(14)
    doc.text(`Planificación semanal · ${tenant?.name || ''}`, 14, 15)
    doc.setFontSize(10)
    doc.text(`Semana del ${dates[0]} al ${dates[6]}`, 14, 22)
    const head = [['Empleado', ...dates.map((d, i) => `${DAY_L[DAYS[i]]} ${d.slice(5)}`)]]
    const body = mixedEmps.map(emp => {
      const row = [emp.name]
      dates.forEach(d => {
        const cell = plans[`${emp.id}|${d}`]
        row.push(cell?.entry_time_str ? `${cell.entry_time_str} – ${cell.exit_time_str}` : '—')
      })
      return row
    })
    doc.autoTable({
      head, body, startY: 28,
      styles: { fontSize: 8, halign: 'center' },
      headStyles: { fillColor: [40, 40, 40], textColor: [220, 220, 220] },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold' } },
    })
    doc.save(`planificacion_${dates[0]}.pdf`)
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando planificador...</div>

  const dates = weekDates(weekStart)
  const isManagerBranch = profile?.role === 'manager' && !!profile?.branch_id

  return (
    <div className="p-5 md:p-6 max-w-6xl mx-auto">
      <div className="flex items-end justify-between mb-5 flex-wrap gap-3">
        <div>
          <h1 className="page-title">Planificador semanal</h1>
          <p className="text-gray-400 text-xs font-mono mt-0.5">EMPLEADOS MIXTOS · {mixedEmps.length} persona{mixedEmps.length !== 1 ? 's' : ''}</p>
          {savedMeta ? (
            <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-brand-400/15 border border-brand-400/30 text-brand-300 text-[11px] font-mono">
              ✓ {savedMeta.title || `Semana ${savedMeta.start_date}`} · guardada{savedMeta.saved_by_name ? ` por ${savedMeta.saved_by_name}` : ''}
            </div>
          ) : (
            <div className="mt-1 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-amber-500/15 border border-amber-400/30 text-amber-300 text-[11px] font-mono">
              ⚠ Esta semana aún no está guardada (bloquea el corte)
            </div>
          )}
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {branches.length > 0 && !isManagerBranch && (
            <>
              {/* FIX: unificar selector de sucursal con Equipo/Hoy. */}
              <BranchFilter branches={branches} value={selectedBranchId} onChange={setSelectedBranchId} />
            </>
          )}
          <button onClick={() => setWeekStart(w => addDaysIso(w, -7))} className="px-3 py-2 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-xs active:bg-dark-600">← Anterior</button>
          <input type="date" className="input py-1.5 text-xs" value={weekStart} onChange={e => setWeekStart(mondayOf(e.target.value))} />
          <button onClick={() => setWeekStart(w => addDaysIso(w, 7))} className="px-3 py-2 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-xs active:bg-dark-600">Siguiente →</button>
        </div>
      </div>

      {mixedEmps.length === 0 ? (
        <div className="card text-center py-10">
          <div className="text-4xl mb-3">🔀</div>
          <p className="text-gray-200 text-sm font-semibold">No hay empleados mixtos registrados.</p>
          <p className="text-gray-400 text-xs mt-2">Ve a <strong>Personal</strong> y marca "Horario mixto" al crear o editar un empleado.</p>
        </div>
      ) : (
        <>
          <div className="flex gap-2 mb-4 flex-wrap">
            <button onClick={save} disabled={saving} className="px-4 py-2 bg-brand-400 text-black font-bold rounded-xl text-sm active:brightness-90 disabled:opacity-50">
              {saving ? 'Guardando...' : '💾 Guardar plan'}
            </button>
            <button onClick={copyPrevWeek} className="px-4 py-2 bg-dark-700 border border-dark-border rounded-xl text-gray-300 text-sm active:bg-dark-600">
              ↺ Copiar semana anterior
            </button>
            <button onClick={exportPdf} className="px-4 py-2 bg-dark-700 border border-dark-border rounded-xl text-gray-300 text-sm active:bg-dark-600">
              📄 Exportar PDF
            </button>
          </div>

          <div className="card overflow-x-auto isolate bg-[#fff] dark:bg-[#101318]">
            {/* FIX: stacking aislado y fondos opacos evitan que los dias se vean bajo la columna sticky. */}
            <table className="min-w-full text-xs border-separate border-spacing-0 bg-[#fff] dark:bg-[#101318]">
              <thead>
                <tr>
                  <th className={`text-left p-2 font-mono border-b sticky left-0 z-30 min-w-[150px] ${
                    isDark
                      ? 'text-gray-500 border-dark-border bg-[#101318]'
                      : 'text-gray-600 border-gray-200 bg-[#fff]'
                  }`}
                    style={!isDark ? { boxShadow: '6px 0 8px -4px rgba(0,0,0,0.08)' } : { boxShadow: '6px 0 8px -4px rgba(0,0,0,0.4)' }}>Empleado</th>
                  {dates.map((d, i) => (
                    <th key={d} className={`text-center p-2 font-mono border-b min-w-[90px] z-10 ${
                      isDark ? 'text-gray-500 border-dark-border bg-[#101318]' : 'text-gray-600 border-gray-200 bg-[#fff]'
                    }`}>
                      <div className="text-brand-400">{DAY_L[DAYS[i]]}</div>
                      <div className={`text-[10px] font-normal ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{d.slice(5)}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {mixedEmps.map(emp => (
                  <tr key={emp.id} className={`border-b ${
                    isDark ? 'border-dark-border/50 hover:bg-dark-700/40' : 'border-gray-100 hover:bg-gray-50'
                  }`}>
                    <td className={`p-2 align-top sticky left-0 z-20 min-w-[150px] ${
                      isDark ? 'bg-[#101318]' : 'bg-[#fff]'
                    }`}
                      style={!isDark
                        ? { boxShadow: '6px 0 8px -4px rgba(0,0,0,0.08)' }
                        : { boxShadow: '6px 0 8px -4px rgba(0,0,0,0.4)' }}>
                      <div className={`font-semibold text-xs whitespace-nowrap max-w-[160px] truncate ${isDark ? 'text-white' : 'text-gray-900'}`} title={emp.name}>{emp.name}</div>
                      <div className={`text-[10px] font-mono ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>{emp.daily_hours || '?'} h/día · {emp.employee_code}</div>
                    </td>
                    {dates.map(d => {
                      const cell = plans[`${emp.id}|${d}`]
                      const entry = cell?.entry_time_str || ''
                      return (
                        <td key={d} className={`p-1.5 align-top ${isDark ? 'bg-[#101318]' : 'bg-[#fff]'}`}>
                          <input
                            type="time"
                            className={`w-full border rounded-md px-1.5 py-1 text-xs text-center font-mono ${
                              isDark
                                ? 'bg-dark-700 border-dark-border text-white'
                                : 'bg-white border-gray-300 text-gray-900'
                            }`}
                            value={entry}
                            onChange={e => setCell(emp.id, d, e.target.value)}
                          />
                          {entry ? (
                            <div className="text-[9px] text-brand-400/80 mt-1 text-center font-mono">
                              sale {cell.exit_time_str}
                            </div>
                          ) : (
                            <div className={`text-[9px] mt-1 text-center font-mono ${isDark ? 'text-gray-700' : 'text-gray-300'}`}>—</div>
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 text-[11px] text-gray-500 leading-relaxed">
            💡 Marca la hora de entrada en los días que el empleado trabaja. La hora de salida se calcula automáticamente según sus horas diarias. Los días que no viene, déjalos vacíos. No olvides <strong>Guardar plan</strong> antes de salir.
          </div>
        </>
      )}
    </div>
  )
}
