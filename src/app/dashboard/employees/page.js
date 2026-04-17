'use client'
// src/app/dashboard/employees/page.js
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import {
  DAYS, DAY_L, monthlyToHourly,
  calcYearsWorked, calcVacationDays, hasVacationPending
} from '@/lib/utils'
import toast from 'react-hot-toast'

const DEF_BASE = { start: '09:00', end: '18:00' }

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

function buildSchedule(base, overrides = {}) {
  return DAYS.reduce((a, d) => ({
    ...a, [d]: {
      work: overrides[d]?.work ?? !['sab', 'dom'].includes(d),
      start: overrides[d]?.custom ? overrides[d].start : base.start,
      end: overrides[d]?.custom ? overrides[d].end : base.end,
      custom: overrides[d]?.custom || false,
    }
  }), {})
}

function deriveBase(schedule) {
  const firstWork = DAYS.find(d => schedule?.[d]?.work)
  return firstWork
    ? { start: schedule[firstWork].start || '09:00', end: schedule[firstWork].end || '18:00' }
    : { ...DEF_BASE }
}

const DEF_SCHED = buildSchedule(DEF_BASE)

export default function EmployeesPage() {
  const [emps, setEmps] = useState([])
  const [branches, setBranches] = useState([])
  const [vacTable, setVacTable] = useState(null) // custom vacation table from config
  // FIX 8: periodos vivos por empleado, usados por hasVacationPending().
  const [vacPeriods, setVacPeriods] = useState([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [base, setBase] = useState({ ...DEF_BASE })

  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  function applyBase(newBase) {
    setBase(newBase)
    setForm(f => ({
      ...f,
      schedule: DAYS.reduce((a, d) => ({
        ...a, [d]: {
          ...f.schedule?.[d],
          start: f.schedule?.[d]?.custom ? f.schedule[d].start : newBase.start,
          end:   f.schedule?.[d]?.custom ? f.schedule[d].end   : newBase.end,
        }
      }), { ...f.schedule })
    }))
  }

  function toggleDay(day) {
    setForm(f => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule?.[day], work: !f.schedule?.[day]?.work } } }))
  }

  function toggleCustom(day) {
    setForm(f => {
      const wasCustom = f.schedule?.[day]?.custom
      return {
        ...f,
        schedule: {
          ...f.schedule,
          [day]: {
            ...f.schedule?.[day],
            custom: !wasCustom,
            start: wasCustom ? base.start : f.schedule?.[day]?.start || base.start,
            end:   wasCustom ? base.end   : f.schedule?.[day]?.end   || base.end,
          }
        }
      }
    })
  }

  function setDayTime(day, field, val) {
    setForm(f => ({ ...f, schedule: { ...f.schedule, [day]: { ...f.schedule?.[day], [field]: val, custom: true } } }))
  }

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)
    // FIX 8: cargar también vacation_periods vivos para poder evaluar
    // hasVacationPending contra la tabla real (no contra el array legacy).
    const [{ data: empData }, { data: tenantData }, { data: vpData }] = await Promise.all([
      supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).neq('status', 'deleted').order('employee_code'),
      supabase.from('tenants').select('config').eq('id', prof.tenant_id).single(),
      supabase
        .from('vacation_periods')
        .select('employee_id,anniversary_year,status,end_date')
        .eq('tenant_id', prof.tenant_id)
        .in('status', ['pending', 'postponed', 'active', 'completed', 'approved']),
    ])
    setEmps(empData || [])
    setBranches(tenantData?.config?.branches || [])
    setVacTable(tenantData?.config?.vacationTable || tenantData?.config?.vacation_table || null)
    setVacPeriods(vpData || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  function openAdd() {
    const b = { ...DEF_BASE }
    setBase(b)
    setForm({
      schedule: buildSchedule(b),
      has_shift: true,
      can_manage: false,
      role_label: 'Empleado',
      payment_type: 'efectivo',
      birth_date: '',
      hire_date: todayISO(),
    })
    setSheet('add')
  }

  async function save() {
    if (!form.name || !form.pin) { toast.error('Nombre y PIN son obligatorios'); return }
    if (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin)) { toast.error('El PIN debe ser exactamente 4 dígitos'); return }
    if (!form.branch_id) { toast.error('Debes seleccionar una sucursal'); return }
    if (!form.hire_date) { toast.error('La fecha de ingreso es obligatoria'); return }

    setSaving(true)
    const supabase = createClient()

    const branchObj = branches.find(b => b.id === form.branch_id)
    // Preserve existing schedule extras (hireDate legacy, vacationYearsTaken, etc.) + branch
    const schedule = {
      ...(form.schedule || DEF_SCHED),
      branch: branchObj || { id: form.branch_id, name: '' },
      // Sync legacy schedule.hireDate with the real column for backward compat
      hireDate: form.hire_date || form.schedule?.hireDate || null,
      vacationYearsTaken: form.schedule?.vacationYearsTaken || [],
    }

    const payload = {
      name: form.name,
      department: form.department || '',
      pin: form.pin,
      role_label: form.role_label || 'Empleado',
      can_manage: form.can_manage || false,
      has_shift: form.has_shift !== false,
      monthly_salary: parseFloat(form.monthly_salary) || 0,
      payment_type: form.payment_type || 'efectivo',
      birth_date: form.birth_date || null,
      hire_date: form.hire_date,
      schedule,
    }
    try {
      if (sheet === 'add') {
        // Use API endpoint so service role can backfill historical vacation_periods
        const res = await fetch('/api/employees/create', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...payload, branch_id: form.branch_id }),
        })
        const body = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(body.error || 'Error al guardar')
          setSaving(false)
          return
        }
        toast.success(`Empleado ${body.employee?.employee_code || ''} creado`)
        // FIX R6: si el backend detectó años previos no capturados, avisar al gerente.
        if (body.backfill_warning) {
          toast(
            body.backfill_warning,
            { icon: '⚠️', duration: 10000, style: { background: '#422', color: '#fc0', maxWidth: 500 } }
          )
        }
      } else {
        await supabase.from('employees').update({ ...payload, status: form.status || 'active' }).eq('id', form.id)
        toast.success('Empleado actualizado')
      }
      await load()
      setSheet(null)
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  async function deactivate(emp) {
    if (!confirm(`¿Dar de baja a ${emp.name}? Sus registros se conservan.`)) return
    const supabase = createClient()
    await supabase.from('employees').update({ status: 'deleted' }).eq('id', emp.id)
    toast.success('Baja registrada')
    await load()
  }

  function openEdit(emp) {
    const b = deriveBase(emp.schedule)
    setBase(b)
    const schedule = DAYS.reduce((a, d) => {
      const s = emp.schedule?.[d] || { work: false, start: b.start, end: b.end }
      const custom = s.work && (s.start !== b.start || s.end !== b.end)
      return { ...a, [d]: { ...s, custom } }
    }, {})
    setForm({
      ...emp,
      schedule,
      branch_id: emp.schedule?.branch?.id || emp.branch_id || '',
      // Prefer real column, fallback to legacy schedule.hireDate
      hire_date: (emp.hire_date && String(emp.hire_date).slice(0, 10)) || emp.schedule?.hireDate || '',
      payment_type: emp.payment_type || 'efectivo',
      birth_date: emp.birth_date || '',
    })
    setSheet('edit')
  }

  // BUG F: markVacationTaken eliminado. La gestion correcta de vacaciones
  // ocurre en /dashboard/employees/[id] (crea vacation_periods reales con
  // status 'completed'). El array legacy schedule.vacationYearsTaken ya no
  // se actualiza desde aqui para evitar desincronizacion con la tabla
  // vacation_periods.

  const hasBranches = branches.length > 0

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Empleados</h1>
          <p className="text-gray-500 text-xs font-mono mt-0.5">GESTIÓN DE PERSONAL</p>
        </div>
        <button onClick={openAdd}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90">
          + Agregar
        </button>
      </div>

      {!hasBranches && (
        <div className="px-4 py-3 mb-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 text-sm">
          ⚠️ No hay sucursales configuradas. Ve a <span className="font-bold">Configuración → Sucursales</span> para agregar al menos una antes de crear empleados.
        </div>
      )}

      {loading ? <p className="text-gray-500 font-mono text-sm">Cargando...</p> : (
        <div className="space-y-3">
          {emps.length === 0 && (
            <div className="card text-center py-10">
              <div className="text-4xl mb-3">👥</div>
              <p className="text-gray-500 text-sm">No hay empleados registrados.</p>
              <button onClick={openAdd} className="mt-3 text-brand-400 text-sm font-semibold">+ Agregar el primero →</button>
            </div>
          )}
          {emps.map(emp => {
            const branchName = emp.schedule?.branch?.name || ''
            const hireDate = (emp.hire_date && String(emp.hire_date).slice(0, 10)) || emp.schedule?.hireDate
            const years = calcYearsWorked(hireDate)
            const vacDays = calcVacationDays(hireDate, vacTable)
            const vacPending = hasVacationPending(emp, vacPeriods)
            // FIX R6: "tomadas ✓" solo si existe un periodo del año actual
            // en estado `completed` (o `approved` con end_date < hoy). Antes
            // lo marcaba por el simple hecho de que vacPending=false, lo que
            // incluia periodos `active`/`approved` aun no terminados.
            const todayStr = todayISO()
            const currentYear = years
            const tomadasOk = (vacPeriods || []).some(p => {
              if (p.employee_id !== emp.id) return false
              if (p.anniversary_year !== currentYear) return false
              if (p.status === 'completed') return true
              if (p.status === 'approved' && p.end_date && String(p.end_date).slice(0,10) < todayStr) return true
              return false
            })

            return (
              <div key={emp.id} className="card">
                <div className="flex items-start gap-3">
                  <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold font-mono shrink-0
                    ${emp.can_manage ? 'bg-orange-500/10 text-orange-400 border border-orange-400/20' : 'bg-brand-400/10 text-brand-400 border border-brand-400/20'}`}>
                    {emp.name.split(' ').slice(0, 2).map(w => w[0]).join('')}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-sm text-white">{emp.name}</span>
                      <span className="text-xs font-mono text-gray-600">{emp.employee_code}</span>
                      {emp.can_manage && <span className="badge-orange text-[9px]">Gerente</span>}
                      {emp.status === 'inactive' && <span className="badge-gray text-[9px]">Inactivo</span>}
                    </div>
                    <div className="text-xs text-gray-500 mt-0.5">
                      {emp.department && `${emp.department} · `}
                      {branchName && <span className="text-brand-400/80">🏢 {branchName} · </span>}
                      ${(emp.monthly_salary || 0).toLocaleString()}/mes · ${monthlyToHourly(emp).toFixed(2)}/h
                    </div>
                    <div className="text-xs text-gray-600 font-mono mt-0.5">
                      {DAYS.filter(d => emp.schedule?.[d]?.work).map(d => DAY_L[d]).join(' ')}
                    </div>
                    {/* Antigüedad + vacaciones */}
                    {hireDate && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono text-gray-500">
                          📅 {new Date(hireDate + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })}
                          {years > 0 && ` · ${years} año${years !== 1 ? 's' : ''}`}
                        </span>
                        {years >= 1 && (
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            vacPending
                              ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                              : 'bg-dark-700 border-dark-border text-gray-600'
                          }`}>
                            🏖 {vacDays}d vacaciones{vacPending ? ' pendientes' : (tomadasOk ? ' tomadas ✓' : '')}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5 shrink-0">
                    <Link href={`/dashboard/employees/${emp.id}`}
                      className="p-2 bg-brand-400/10 border border-brand-400/30 rounded-lg text-brand-400 active:bg-brand-400/20 text-xs text-center"
                      title="Ver detalle">👁</Link>
                    <button onClick={() => openEdit(emp)}
                      className="p-2 bg-dark-700 border border-dark-border rounded-lg text-gray-400 active:bg-dark-600 text-xs">✏️</button>
                    <button onClick={() => deactivate(emp)}
                      className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 active:bg-red-500/20 text-xs">🗑</button>
                  </div>
                </div>

                {/* BUG F: boton "Tomadas" eliminado (escribia al array legacy y no
                    creaba vacation_periods reales). Gestion en "Ver detalle". */}
                {vacPending && (
                  <div className="mt-3 flex items-center justify-between gap-3 px-3 py-2.5 bg-yellow-500/10 border border-yellow-500/20 rounded-xl">
                    <div>
                      <p className="text-yellow-400 text-xs font-bold">🏖 Vacaciones pendientes</p>
                      <p className="text-yellow-400/70 text-[10px] mt-0.5">
                        Corresponden {vacDays} días por {years} año{years !== 1 ? 's' : ''} de antigüedad (LFT 2023)
                      </p>
                    </div>
                    <Link
                      href={`/dashboard/employees/${emp.id}`}
                      className="shrink-0 px-3 py-1.5 bg-yellow-500/20 border border-yellow-500/40 rounded-lg text-yellow-400 text-xs font-bold active:bg-yellow-500/30 whitespace-nowrap">
                      Gestionar →
                    </Link>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* ── Bottom Sheet ────────────────────────────────────────────────────── */}
      {sheet && (
        <div className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end" style={{ touchAction: 'none' }}>
          <div className="bg-dark-800 rounded-t-2xl overflow-y-scroll no-scrollbar"
            style={{ height: '90vh', touchAction: 'pan-y' }}>
            <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-4" />
            <div className="px-5 pb-10">
              <h3 className="text-lg font-bold text-white mb-4">
                {sheet === 'add' ? 'Nuevo Empleado' : 'Editar Empleado'}
              </h3>
              <div className="space-y-3">

                {/* Sucursal (requerida) */}
                <div>
                  <label className="label" htmlFor="emp-branch">
                    Sucursal <span className="text-red-400">*</span>
                  </label>
                  {hasBranches ? (
                    <select id="emp-branch" className="input" value={form.branch_id || ''} onChange={e => F('branch_id', e.target.value)}>
                      <option value="">— Selecciona una sucursal —</option>
                      {branches.map(b => (
                        <option key={b.id} value={b.id}>{b.name}</option>
                      ))}
                    </select>
                  ) : (
                    <div className="input bg-dark-700 text-orange-400 text-xs">
                      ⚠️ Configura sucursales primero en Configuración
                    </div>
                  )}
                </div>

                <div>
                  <label className="label" htmlFor="emp-name">Nombre completo</label>
                  <input id="emp-name" className="input" value={form.name || ''} onChange={e => F('name', e.target.value)} placeholder="Juan Pérez" />
                </div>

                <div>
                  <label className="label" htmlFor="emp-department">Departamento</label>
                  <input id="emp-department" className="input" value={form.department || ''} onChange={e => F('department', e.target.value)} placeholder="Cocina, Caja..." />
                </div>

                {/* Fecha de ingreso (obligatoria) */}
                <div>
                  <label className="label" htmlFor="emp-hire-date">
                    Fecha de ingreso <span className="text-red-400">*</span>
                  </label>
                  {/* BUG Q: no aceptar fechas futuras para hire_date */}
                  <input id="emp-hire-date" className="input" type="date" required
                    max={todayISO()}
                    value={form.hire_date || ''}
                    onChange={e => F('hire_date', e.target.value)} />
                  <p className="text-[10px] text-gray-600 font-mono mt-1 leading-snug">
                    Si el empleado tiene antigüedad previa, el sistema asume que ya tomó las vacaciones de años anteriores. Solo contará a partir del próximo aniversario.
                  </p>
                </div>

                <div>
                  <label className="label" htmlFor="emp-pin">PIN (4 dígitos)</label>
                  <input id="emp-pin" className="input" inputMode="numeric" maxLength={4} value={form.pin || ''} onChange={e => F('pin', e.target.value)} placeholder="1234" />
                </div>

                <div>
                  <label className="label" htmlFor="emp-salary">Salario mensual ($)</label>
                  <input id="emp-salary" className="input" type="number" inputMode="decimal" value={form.monthly_salary || ''} onChange={e => F('monthly_salary', e.target.value)} placeholder="15000" />
                </div>

                <div>
                  <label className="label" htmlFor="emp-payment-type">Tipo de pago</label>
                  <select id="emp-payment-type" className="input" value={form.payment_type || 'efectivo'} onChange={e => F('payment_type', e.target.value)}>
                    <option value="efectivo">Efectivo</option>
                    <option value="transferencia">Transferencia</option>
                  </select>
                  <p className="text-[10px] text-gray-600 font-mono mt-1">Aparecerá en los recibos firmados. Los cambios solo afectan nuevos pagos.</p>
                </div>

                <div>
                  <label className="label" htmlFor="emp-birth-date">Fecha de nacimiento <span className="text-gray-600 font-normal">(opcional)</span></label>
                  {/* BUG Q: birth_date no puede ser futura */}
                  <input id="emp-birth-date" className="input" type="date"
                    max={todayISO()}
                    value={form.birth_date || ''} onChange={e => F('birth_date', e.target.value)} />
                  <p className="text-[10px] text-gray-600 font-mono mt-1">Se usa para felicitarlo el día de su cumpleaños.</p>
                </div>

                <div>
                  <label className="label" htmlFor="emp-role-label">Etiqueta de rol</label>
                  <input id="emp-role-label" className="input" value={form.role_label || ''} onChange={e => F('role_label', e.target.value)} placeholder="Empleado, Cajero, Chef..." />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Gerente / Puede gestionar</p>
                    <p className="text-xs text-gray-500">Acceso al panel de administración</p>
                  </div>
                  <button onClick={() => F('can_manage', !form.can_manage)}
                    className={`w-10 h-6 rounded-full relative transition-colors ${form.can_manage ? 'bg-brand-400' : 'bg-dark-600'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.can_manage ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Turno de piso</p>
                    <p className="text-xs text-gray-500">Aparece en checada y nómina</p>
                  </div>
                  <button onClick={() => F('has_shift', !form.has_shift)}
                    className={`w-10 h-6 rounded-full relative transition-colors ${form.has_shift ? 'bg-brand-400' : 'bg-dark-600'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.has_shift ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>

                {sheet === 'edit' && (
                  <div>
                    <label className="label" htmlFor="emp-status">Estatus</label>
                    <select id="emp-status" className="input" value={form.status || 'active'} onChange={e => F('status', e.target.value)}>
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                )}

                {/* Horario semanal — base + excepciones */}
                <div className="border-t border-dark-border pt-3">
                  <p className="label mb-2">Horario semanal</p>

                  {/* Base schedule row */}
                  <div className="p-3 bg-dark-700 border border-dark-border rounded-xl mb-3">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs text-gray-400 font-semibold flex-1">Horario base (aplica a todos)</span>
                      <button
                        onClick={() => applyBase(base)}
                        className="px-2.5 py-1 bg-brand-400/15 border border-brand-400/30 rounded-lg text-brand-400 text-[10px] font-bold active:bg-brand-400/25">
                        ↻ Aplicar a todos
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <label className="text-[10px] text-gray-500 w-12">Entrada</label>
                      <input type="time" className="input py-1.5 px-2 text-sm flex-1 font-mono"
                        value={base.start}
                        onChange={e => setBase(b => ({ ...b, start: e.target.value }))} />
                      <span className="text-gray-600 text-xs">–</span>
                      <label className="text-[10px] text-gray-500 w-10">Salida</label>
                      <input type="time" className="input py-1.5 px-2 text-sm flex-1 font-mono"
                        value={base.end}
                        onChange={e => setBase(b => ({ ...b, end: e.target.value }))} />
                    </div>
                  </div>

                  {/* Per-day rows */}
                  {DAYS.map(day => {
                    const s = form.schedule?.[day] || { work: false, start: base.start, end: base.end, custom: false }
                    return (
                      <div key={day} className="mb-2">
                        <div className="flex items-center gap-2">
                          <button onClick={() => toggleDay(day)}
                            className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${s.work ? 'bg-brand-400' : 'bg-dark-600'}`}>
                            <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all ${s.work ? 'left-5' : 'left-0.5'}`} />
                          </button>
                          <span className={`font-mono text-xs w-7 font-bold ${s.work ? 'text-white' : 'text-gray-600'}`}>{DAY_L[day]}</span>

                          {s.work ? (
                            <>
                              {s.custom ? (
                                <>
                                  <input type="time" className="input py-1 px-2 text-xs flex-1 font-mono"
                                    value={s.start} onChange={e => setDayTime(day, 'start', e.target.value)} />
                                  <span className="text-gray-600 text-[10px]">–</span>
                                  <input type="time" className="input py-1 px-2 text-xs flex-1 font-mono"
                                    value={s.end} onChange={e => setDayTime(day, 'end', e.target.value)} />
                                </>
                              ) : (
                                <span className="text-[11px] text-gray-500 font-mono flex-1">
                                  {base.start} – {base.end}
                                </span>
                              )}
                              <label className="flex items-center gap-1 shrink-0 cursor-pointer">
                                <input type="checkbox" className="accent-brand-400 w-3.5 h-3.5"
                                  checked={s.custom || false}
                                  onChange={() => toggleCustom(day)} />
                                <span className="text-[10px] text-gray-500">Diferente</span>
                              </label>
                            </>
                          ) : (
                            <span className="text-xs text-gray-600 font-mono flex-1">Descanso</span>
                          )}
                        </div>
                      </div>
                    )
                  })}
                </div>

                <div className="flex gap-2 pt-2">
                  <button onClick={save} disabled={saving || !hasBranches} className="btn-primary">
                    {saving ? 'Guardando...' : 'Guardar'}
                  </button>
                  <button onClick={() => setSheet(null)} className="btn-ghost">Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
