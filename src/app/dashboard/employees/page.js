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
// R7: reemplazamos window.confirm() (nativo, bloqueante, feo) por ConfirmSheet.
import { ConfirmSheet } from '@/components/ConfirmSheet'
// Carga masiva (feat/bulk-employees-upload): modal de 3 pasos con plantilla + preview
import BulkUploadModal from '@/components/BulkUploadModal'
import { generateAllEmployeesBySheetXLSX } from '@/lib/export-xlsx'
import { Upload, Plus, Download, Users, Building2, Calendar, Pencil, Trash2, AlertTriangle, Shuffle, Unlock, Eye } from 'lucide-react'

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
  // feat/mixed-schedule: leer config.mixedSchedule del tenant para permitir/denegar mixto.
  const [mixedCfg, setMixedCfg] = useState({ enabled: false, maxRotating: null, unlimitedRotating: true })
  const [sheet, setSheet] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [base, setBase] = useState({ ...DEF_BASE })
  // R7: estado del modal de confirmacion (reemplaza window.confirm()).
  // Forma: { title, message, onConfirm, danger, confirmLabel, cancelLabel, loading }
  const [confirmState, setConfirmState] = useState(null)
  // Carga masiva: abre el modal dedicado
  const [bulkOpen, setBulkOpen] = useState(false)
  // Export auditoría de todos los empleados con pestañas
  const [exportAllOpen, setExportAllOpen] = useState(false)
  const [expAllFrom, setExpAllFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [expAllTo, setExpAllTo] = useState(() => new Date().toISOString().slice(0, 10))
  const [exportingAll, setExportingAll] = useState(false)

  async function doExportAll() {
    if (!expAllFrom || !expAllTo) { toast.error('Selecciona el rango'); return }
    if (expAllFrom > expAllTo) { toast.error('Fecha inicial mayor a final'); return }
    if (!tenantId) { toast.error('Sin tenant'); return }
    setExportingAll(true)
    try {
      const supabase = createClient()
      const activeEmps = emps.filter(e => e.status === 'active')
      if (activeEmps.length === 0) { toast.error('No hay empleados activos'); setExportingAll(false); return }
      const [{ data: shifts, error: shErr }, { data: tenant }] = await Promise.all([
        supabase.from('shifts').select('*')
          .eq('tenant_id', tenantId)
          .gte('date_str', expAllFrom)
          .lte('date_str', expAllTo)
          .order('date_str', { ascending: true }),
        supabase.from('tenants').select('name').eq('id', tenantId).single(),
      ])
      if (shErr) { toast.error(`Error: ${shErr.message}`); setExportingAll(false); return }
      generateAllEmployeesBySheetXLSX({
        emps: activeEmps,
        shifts: shifts || [],
        branches: branches || [],
        periodFrom: expAllFrom,
        periodTo: expAllTo,
        companyName: tenant?.name || 'CheckPro',
      })
      toast.success(`Auditoría exportada · ${activeEmps.length} empleados · ${shifts?.length || 0} registros`)
      setExportAllOpen(false)
    } catch (e) {
      toast.error('Error al exportar')
      console.error(e)
    } finally {
      setExportingAll(false)
    }
  }

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
    const [{ data: empData }, { data: tenantData }, { data: branchData }, { data: vpData }] = await Promise.all([
      supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).neq('status', 'deleted').order('employee_code'),
      supabase.from('tenants').select('config').eq('id', prof.tenant_id).single(),
      // FIX: leer sucursales de la tabla canonica (no del JSONB legacy)
      supabase.from('branches').select('id,name,active').eq('tenant_id', prof.tenant_id).eq('active', true).order('created_at'),
      supabase
        .from('vacation_periods')
        .select('employee_id,anniversary_year,status,end_date')
        .eq('tenant_id', prof.tenant_id)
        .in('status', ['pending', 'postponed', 'active', 'completed', 'approved']),
    ])
    setEmps(empData || [])
    // FIX: preferir tabla branches; si vacia fallback al array legacy por si algun tenant viejo no migro
    setBranches((branchData && branchData.length > 0) ? branchData : (tenantData?.config?.branches || []))
    setVacTable(tenantData?.config?.vacationTable || tenantData?.config?.vacation_table || null)
    setVacPeriods(vpData || [])
    // feat/mixed-schedule: leer config de horario mixto
    const ms = tenantData?.config?.mixedSchedule || {}
    setMixedCfg({
      enabled: !!ms.enabled,
      maxRotating: ms.maxRotating ?? null,
      unlimitedRotating: ms.unlimitedRotating || ms.maxRotating == null,
    })
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
      // feat/mixed-schedule: default fijo
      is_mixed: false,
      daily_hours: 8,
      // feat/horario-libre: gerentes con nómina íntegra; checan solo para tracking.
      free_schedule: false,
      free_min_days_week: 5,
      free_min_hours_week: 40,
    })
    setSheet('add')
  }

  async function save() {
    if (!form.name || !form.pin) { toast.error('Nombre y PIN son obligatorios'); return }
    if (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin)) { toast.error('El PIN debe ser exactamente 4 dígitos'); return }
    if (!form.branch_id) { toast.error('Debes seleccionar una sucursal'); return }
    if (!form.hire_date) { toast.error('La fecha de ingreso es obligatoria'); return }

    // feat/mixed-schedule: validaciones específicas para mixto
    if (form.is_mixed) {
      if (!mixedCfg.enabled) { toast.error('Horario mixto no está activado en Configuración'); return }
      const dh = parseFloat(form.daily_hours)
      if (!dh || dh <= 0 || dh > 24) { toast.error('Duración diaria inválida (1-24 hrs)'); return }
      // Verificar límite maxRotating
      if (!mixedCfg.unlimitedRotating && mixedCfg.maxRotating != null) {
        const alreadyMixed = emps.filter(e => e.is_mixed && e.status !== 'deleted' && (sheet !== 'edit' || e.id !== form.id)).length
        if (alreadyMixed >= mixedCfg.maxRotating) {
          toast.error(`Se alcanzó el máximo de ${mixedCfg.maxRotating} empleados rotativos. Aumenta el tope en Configuración.`)
          return
        }
      }
    }

    // feat/horario-libre: solo gerentes; no puede combinarse con mixto
    if (form.free_schedule) {
      if (!form.can_manage) { toast.error('Horario libre solo aplica a gerentes'); return }
      if (form.is_mixed) { toast.error('Horario libre y mixto son excluyentes'); return }
      const md = parseInt(form.free_min_days_week || 0)
      const mh = parseFloat(form.free_min_hours_week || 0)
      if (md < 0 || md > 7) { toast.error('Mínimo de días por semana inválido (0-7)'); return }
      if (mh < 0 || mh > 168) { toast.error('Mínimo de horas por semana inválido (0-168)'); return }
    }

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
      // feat/mixed-schedule
      is_mixed: !!form.is_mixed,
      daily_hours: form.is_mixed ? (parseFloat(form.daily_hours) || null) : null,
      // feat/horario-libre
      free_schedule: !!form.free_schedule,
      free_min_days_week: form.free_schedule ? (parseInt(form.free_min_days_week) || 5) : null,
      free_min_hours_week: form.free_schedule ? (parseFloat(form.free_min_hours_week) || 40) : null,
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
            { duration: 10000, style: { background: '#422', color: '#fc0', maxWidth: 500 } }
          )
        }
      } else {
        // FIX: antes se swallowed el error silently y el toast decia "actualizado"
        // aunque la update fallara por RLS o constraint.
        const { error: upErr } = await supabase.from('employees').update({ ...payload, status: form.status || 'active' }).eq('id', form.id)
        if (upErr) {
          console.error('[employees] update error:', upErr)
          toast.error(`No se pudo actualizar: ${upErr.message}`)
          setSaving(false)
          return
        }
        toast.success('Empleado actualizado')
      }
      await load()
      setSheet(null)
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  // R7: ya no usamos window.confirm(). Abrimos ConfirmSheet y ejecutamos la
  // baja en onConfirm. Mantenemos `loading` para evitar double-clicks.
  function deactivate(emp) {
    setConfirmState({
      title: 'Dar de baja empleado',
      message: `¿Dar de baja a ${emp.name}? Sus registros se conservan, pero no podrá checar.`,
      confirmLabel: 'Dar de baja',
      cancelLabel: 'Cancelar',
      danger: true,
      onConfirm: async () => {
        setConfirmState(s => (s ? { ...s, loading: true } : s))
        try {
          const supabase = createClient()
          const { error } = await supabase
            .from('employees')
            .update({ status: 'deleted' })
            .eq('id', emp.id)
          if (error) {
            toast.error(error.message || 'No se pudo dar de baja')
          } else {
            toast.success('Baja registrada')
            await load()
          }
        } finally {
          setConfirmState(null)
        }
      },
    })
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
      // feat/mixed-schedule
      is_mixed: !!emp.is_mixed,
      daily_hours: emp.daily_hours || 8,
      // feat/horario-libre
      free_schedule: !!emp.free_schedule,
      free_min_days_week: emp.free_min_days_week ?? 5,
      free_min_hours_week: emp.free_min_hours_week ?? 40,
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
    <div className="p-5 md:p-6 max-w-2xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3 mb-5">
        <div>
          <h1 className="page-title">Empleados</h1>
          <p className="text-gray-500 text-xs font-mono mt-0.5">GESTIÓN DE PERSONAL</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <button onClick={() => setExportAllOpen(true)} disabled={emps.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-dark-700 border border-dark-border text-gray-300 text-sm font-semibold rounded-xl active:bg-dark-600 disabled:opacity-40"
            title="Exportar auditoría de asistencia — todos los empleados con pestañas">
            <Download size={14} /> Auditoría
          </button>
          <button onClick={() => setBulkOpen(true)} disabled={!hasBranches}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-dark-700 border border-dark-border text-gray-300 text-sm font-semibold rounded-xl active:bg-dark-600 disabled:opacity-40 disabled:cursor-not-allowed"
            title="Importar empleados desde Excel/CSV">
            <Upload size={14} /> Archivo
          </button>
          <button onClick={openAdd}
            className="inline-flex items-center gap-1.5 px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90">
            <Plus size={14} /> Agregar
          </button>
        </div>
      </div>

      {!hasBranches && (
        <div className="px-4 py-3 mb-4 bg-orange-500/10 border border-orange-500/20 rounded-xl text-orange-400 text-sm">
          <span className="inline-flex items-center gap-1.5"><AlertTriangle size={14} /> No hay sucursales configuradas. Ve a <span className="font-bold">Configuración → Sucursales</span> para agregar al menos una antes de crear empleados.</span>
        </div>
      )}

      {loading ? <p className="text-gray-500 font-mono text-sm">Cargando...</p> : (
        <div className="space-y-3">
          {emps.length === 0 && (
            <div className="card text-center py-10">
              <div className="flex justify-center mb-3 text-gray-500"><Users size={40} /></div>
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
                      <span className="font-bold text-sm text-white break-words">{emp.name}</span>
                      <span className="text-xs font-mono text-gray-400">{emp.employee_code}</span>
                      {emp.can_manage && <span className="badge-orange text-[9px]">Gerente</span>}
                      {emp.is_mixed && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-purple-500/15 border border-purple-400/30 text-purple-300 whitespace-nowrap flex items-center gap-1"><Shuffle size={10} /> Mixto</span>}
                      {emp.free_schedule && <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-orange-500/15 border border-orange-400/30 text-orange-300 whitespace-nowrap flex items-center gap-1"><Unlock size={10} /> Libre</span>}
                      {emp.status === 'inactive' && <span className="badge-gray text-[9px]">Inactivo</span>}
                    </div>
                    <div className="text-xs text-gray-400 mt-0.5">
                      {emp.department && `${emp.department} · `}
                      {branchName && <span className="text-brand-400 inline-flex items-center gap-1"><Building2 size={10} /> {branchName} · </span>}
                      ${(emp.monthly_salary || 0).toLocaleString()}/mes · ${monthlyToHourly(emp).toFixed(2)}/h
                    </div>
                    <div className="text-xs text-gray-400 font-mono mt-0.5">
                      {emp.is_mixed
                        ? `${emp.daily_hours || '?'} hrs/día · agendado semanalmente`
                        : DAYS.filter(d => emp.schedule?.[d]?.work).map(d => DAY_L[d]).join(' ')}
                    </div>
                    {/* Antigüedad + vacaciones */}
                    {hireDate && (
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <span className="text-[10px] font-mono text-gray-500">
                          <Calendar size={10} className="inline" /> {new Date(hireDate + 'T12:00:00').toLocaleDateString('es-MX', { day:'2-digit', month:'short', year:'numeric' })}
                          {years > 0 && ` · ${years} año${years !== 1 ? 's' : ''}`}
                        </span>
                        {years >= 1 && (
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${
                            vacPending
                              ? 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400'
                              : 'bg-dark-700 border-dark-border text-gray-400'
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
                      title="Ver detalle"><Eye size={12} /></Link>
                    <button onClick={() => openEdit(emp)}
                      className="p-2 bg-dark-700 border border-dark-border rounded-lg text-gray-400 active:bg-dark-600 text-xs"><Pencil size={12} /></button>
                    <button onClick={() => deactivate(emp)}
                      className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400 active:bg-red-500/20 text-xs"><Trash2 size={12} /></button>
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
        <div className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end">
          <div className="bg-dark-800 rounded-t-2xl overflow-y-auto overscroll-contain no-scrollbar"
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
                      <span className="inline-flex items-center gap-1.5"><AlertTriangle size={12} /> Configura sucursales primero en Configuración</span>
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
                  <p className="text-[10px] text-gray-400 font-mono mt-1 leading-snug">
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
                  <p className="text-[10px] text-gray-400 font-mono mt-1">Aparecerá en los recibos firmados. Los cambios solo afectan nuevos pagos.</p>
                </div>

                <div>
                  <label className="label" htmlFor="emp-birth-date">Fecha de nacimiento <span className="text-gray-600 font-normal">(opcional)</span></label>
                  {/* BUG Q: birth_date no puede ser futura */}
                  <input id="emp-birth-date" className="input" type="date"
                    max={todayISO()}
                    value={form.birth_date || ''} onChange={e => F('birth_date', e.target.value)} />
                  <p className="text-[10px] text-gray-400 font-mono mt-1">Se usa para felicitarlo el día de su cumpleaños.</p>
                </div>

                <div>
                  <label className="label" htmlFor="emp-role-label">Etiqueta de rol</label>
                  <input id="emp-role-label" className="input" value={form.role_label || ''} onChange={e => F('role_label', e.target.value)} placeholder="Empleado, Cajero, Chef..." />
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Gerente / Puede gestionar</p>
                    <p className="text-xs text-gray-400">Acceso al panel de administración</p>
                  </div>
                  <button onClick={() => F('can_manage', !form.can_manage)}
                    className={`w-10 h-6 rounded-full relative transition-colors ${form.can_manage ? 'bg-brand-400' : 'bg-dark-600'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.can_manage ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>

                <div className="flex items-center justify-between py-2">
                  <div>
                    <p className="text-sm font-semibold text-white">Turno de piso</p>
                    <p className="text-xs text-gray-400">Aparece en checada y nómina</p>
                  </div>
                  <button onClick={() => F('has_shift', !form.has_shift)}
                    className={`w-10 h-6 rounded-full relative transition-colors ${form.has_shift ? 'bg-brand-400' : 'bg-dark-600'}`}>
                    <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.has_shift ? 'left-5' : 'left-1'}`} />
                  </button>
                </div>

                {/* feat/mixed-schedule: toggle horario mixto (solo si está habilitado en config) */}
                {mixedCfg.enabled && !form.free_schedule && (
                  <div className="flex items-center justify-between py-2 border-t border-dark-border pt-3">
                    <div>
                      <p className="text-sm font-semibold text-white">Horario mixto <span className="text-[10px] font-mono text-gray-500 ml-1">ROTATIVO</span></p>
                      <p className="text-xs text-gray-400">El gerente agenda su horario cada semana</p>
                    </div>
                    <button onClick={() => F('is_mixed', !form.is_mixed)}
                      className={`w-10 h-6 rounded-full relative transition-colors ${form.is_mixed ? 'bg-brand-400' : 'bg-dark-600'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.is_mixed ? 'left-5' : 'left-1'}`} />
                    </button>
                  </div>
                )}

                {/* feat/horario-libre: solo visible si es gerente; excluye mixto */}
                {form.can_manage && !form.is_mixed && (
                  <div className="border-t border-dark-border pt-3">
                    <div className="flex items-center justify-between py-1">
                      <div>
                        <p className="text-sm font-semibold text-white">Horario libre <span className="text-[10px] font-mono text-orange-400 ml-1">GERENTE</span></p>
                        <p className="text-xs text-gray-400 leading-snug">Nómina íntegra. Checa solo para tracking. Alertas si incumple mínimos.</p>
                      </div>
                      <button onClick={() => F('free_schedule', !form.free_schedule)}
                        className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${form.free_schedule ? 'bg-orange-400' : 'bg-dark-600'}`}>
                        <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${form.free_schedule ? 'left-5' : 'left-1'}`} />
                      </button>
                    </div>
                    {form.free_schedule && (
                      <div className="mt-3 space-y-2 p-3 bg-orange-500/5 border border-orange-400/20 rounded-xl">
                        <p className="text-[11px] font-mono uppercase tracking-wider text-orange-300/80">Alertas de seguimiento</p>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="label text-[10px]">Mín. días/semana</label>
                            <input className="input py-1.5 text-sm" type="number" min="0" max="7"
                              value={form.free_min_days_week ?? 5}
                              onChange={e => F('free_min_days_week', e.target.value)} />
                          </div>
                          <div>
                            <label className="label text-[10px]">Mín. horas/semana</label>
                            <input className="input py-1.5 text-sm" type="number" min="0" max="168" step="0.5"
                              value={form.free_min_hours_week ?? 40}
                              onChange={e => F('free_min_hours_week', e.target.value)} />
                          </div>
                        </div>
                        <p className="text-[10px] text-gray-400 leading-snug">
                          Si checa menos de estos umbrales en la semana, aparece una alerta en Dashboard y tarjeta del empleado.
                        </p>
                      </div>
                    )}
                  </div>
                )}

                {sheet === 'edit' && (
                  <div>
                    <label className="label" htmlFor="emp-status">Estatus</label>
                    <select id="emp-status" className="input" value={form.status || 'active'} onChange={e => F('status', e.target.value)}>
                      <option value="active">Activo</option>
                      <option value="inactive">Inactivo</option>
                    </select>
                  </div>
                )}

                {/* feat/mixed-schedule: cuando es mixto, no hay horario semanal; solo duración diaria. */}
                {form.is_mixed ? (
                  <div className="border-t border-dark-border pt-3">
                    <label className="label" htmlFor="emp-daily-hours">Duración de jornada (horas/día)</label>
                    <input id="emp-daily-hours" className="input" type="number" inputMode="decimal" min="1" max="24" step="0.5"
                      value={form.daily_hours ?? ''}
                      onChange={e => F('daily_hours', e.target.value)}
                      placeholder="8" />
                    <p className="text-[10px] text-gray-400 font-mono mt-1 leading-snug">
                      El empleado trabajará esta cantidad de horas cada día que el gerente lo agende en el <strong>Planificador</strong>. No se define día/hora fija aquí.
                    </p>
                  </div>
                ) : form.free_schedule ? (
                  <div className="border-t border-dark-border pt-3">
                    <div className="p-3 bg-dark-800 border border-dark-border rounded-xl">
                      <p className="text-xs text-gray-400 leading-snug">
                        🔓 <strong>Horario libre</strong> — Este gerente no tiene horario semanal fijo. Checa cuando llega y sale para que CheckPro lleve el registro de horas trabajadas, pero no hay retardos ni clasificaciones.
                      </p>
                    </div>
                  </div>
                ) : (
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
                        <div className="flex flex-wrap items-center gap-2">
                          <button onClick={() => toggleDay(day)}
                            className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${s.work ? 'bg-brand-400' : 'bg-dark-600'}`}>
                            <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all ${s.work ? 'left-5' : 'left-0.5'}`} />
                          </button>
                          <span className={`font-mono text-xs min-w-[2.5rem] font-bold ${s.work ? 'text-white' : 'text-gray-600'}`}>{DAY_L[day]}</span>

                          {s.work ? (
                            <>
                              {s.custom ? (
                                <>
                                  <input type="time" className="input py-1 px-2 text-xs flex-1 font-mono min-w-[90px]"
                                    value={s.start} onChange={e => setDayTime(day, 'start', e.target.value)} />
                                  <span className="text-gray-600 text-[10px]">–</span>
                                  <input type="time" className="input py-1 px-2 text-xs flex-1 font-mono min-w-[90px]"
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
                )}

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

      {/* R7: Modal de confirmacion dark (reemplaza window.confirm()) */}
      <ConfirmSheet state={confirmState} onCancel={() => setConfirmState(null)} />

      {/* Carga masiva — modal de 3 pasos.
          onImported refresca la lista pero NO cierra el modal, para que el
          usuario vea la pantalla de éxito (paso 3) y cierre manualmente. */}
      {bulkOpen && (
        <BulkUploadModal
          branches={branches}
          onClose={() => setBulkOpen(false)}
          onImported={() => load()}
        />
      )}

      {/* Modal exportar auditoría — todos los empleados con pestaña por empleado */}
      {exportAllOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-dark-800 border border-dark-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
               style={{ maxHeight: '90dvh' }}>
            <div className="px-5 pt-4 pb-2 shrink-0">
              <h3 className="text-lg font-bold text-white inline-flex items-center gap-2">
                <Users size={18} /> Auditoría de asistencia
              </h3>
              <p className="text-xs text-gray-400 mt-0.5">Archivo con una pestaña por empleado activo + resumen general.</p>
            </div>
            <div className="px-5 pb-4 min-h-0 overflow-y-auto flex-1" style={{ touchAction: 'pan-y' }}>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="label">Desde</label>
                  <input type="date" className="input text-sm" value={expAllFrom}
                    onChange={e => setExpAllFrom(e.target.value)} />
                </div>
                <div>
                  <label className="label">Hasta</label>
                  <input type="date" className="input text-sm" value={expAllTo}
                    onChange={e => setExpAllTo(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {[
                  { label: '7 días', days: 7 },
                  { label: '30 días', days: 30 },
                  { label: '90 días', days: 90 },
                  { label: '1 año', days: 365 },
                ].map(p => (
                  <button key={p.days} type="button"
                    onClick={() => {
                      const to = new Date()
                      const from = new Date(); from.setDate(from.getDate() - p.days)
                      setExpAllFrom(from.toISOString().slice(0, 10))
                      setExpAllTo(to.toISOString().slice(0, 10))
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-dark-700 border border-dark-border text-gray-400 hover:text-white">
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Empleados activos: <span className="text-white font-semibold">{emps.filter(e => e.status === 'active').length}</span>
              </p>
            </div>
            <div className="px-5 pb-5 pt-2 border-t border-dark-border shrink-0 flex gap-2">
              <button onClick={doExportAll} disabled={exportingAll}
                className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90 disabled:opacity-50">
                {exportingAll ? 'Generando...' : 'Descargar'}
              </button>
              <button onClick={() => setExportAllOpen(false)} disabled={exportingAll}
                className="px-3 py-2.5 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
