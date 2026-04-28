'use client'
// src/app/dashboard/employees/[id]/page.js
// Detalle de empleado + gestión de vacaciones (Etapa 4, Fase 2).
// Consume GET /api/vacations/employee/[id] y expone 3 acciones:
// Tomar, Posponer, Compensar (via POST /api/vacations/create).
// También permite cancelar, reanudar, reincorporación temprana, reactivar.
import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Download, Building2, Calendar, Clock, Cake, Palmtree, DollarSign, AlertTriangle, Umbrella, Play, CornerUpLeft } from 'lucide-react'
// R7: componentes compartidos extraidos a src/components/
import { BottomSheet } from '@/components/BottomSheet'
import { ConfirmSheet } from '@/components/ConfirmSheet'
import { createClient } from '@/lib/supabase'
import { generateEmployeeAttendanceXLSX } from '@/lib/export-xlsx'

// ── helpers de formato ───────────────────────────────────────────────────────
function fmtLongDate(iso) {
  if (!iso) return '—'
  const s = String(iso).slice(0, 10)
  const parts = s.split('-')
  if (parts.length !== 3) return s
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', year: 'numeric' })
}

function fmtShortDate(iso) {
  if (!iso) return '—'
  const s = String(iso).slice(0, 10)
  const parts = s.split('-')
  if (parts.length !== 3) return s
  const d = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]))
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: '2-digit' })
}

function fmtMoney(n) {
  const v = Number(n) || 0
  return v.toLocaleString('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 2 })
}

function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Suma N días naturales a YYYY-MM-DD (local) y devuelve YYYY-MM-DD.
function addDaysISO(iso, n) {
  if (!iso || !n) return iso
  const s = String(iso).slice(0, 10).split('-')
  const d = new Date(parseInt(s[0]), parseInt(s[1]) - 1, parseInt(s[2]))
  d.setDate(d.getDate() + Number(n))
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${dd}`
}

// Años completos entre hire_date y hoy, + meses residuales.
function antiguedad(hireISO) {
  if (!hireISO) return { years: 0, months: 0 }
  const s = String(hireISO).slice(0, 10).split('-')
  const hire = new Date(parseInt(s[0]), parseInt(s[1]) - 1, parseInt(s[2]))
  const now = new Date()
  let years = now.getFullYear() - hire.getFullYear()
  let months = now.getMonth() - hire.getMonth()
  if (now.getDate() < hire.getDate()) months -= 1
  if (months < 0) { years -= 1; months += 12 }
  if (years < 0) return { years: 0, months: 0 }
  return { years, months }
}

// Salario diario simple: mensual / 30.
function dailySalary(employee) {
  if (!employee) return 0
  const period = employee.schedule?.salary_period || 'monthly'
  const salary = Number(employee.monthly_salary) || 0
  if (period === 'weekly') return salary / 7
  return salary / 30
}

// ── badges por status/tipo ───────────────────────────────────────────────────
const STATUS_LABEL = {
  pending: 'Pendiente',
  active: 'En curso',
  completed: 'Completada',
  postponed: 'Pospuesta',
  expired: 'Prescrita',
  cancelled: 'Cancelada',
}
const STATUS_CLASS = {
  pending: 'badge-blue',
  active: 'badge-green',
  completed: 'badge-gray',
  postponed: 'badge-orange',
  expired: 'badge-red',
  cancelled: 'badge-gray',
}
const TIPO_ICON = { tomadas: <Umbrella size={14} />, pospuestas: <Calendar size={14} />, compensadas: <DollarSign size={14} /> }
const TIPO_LABEL = { tomadas: 'Tomadas', pospuestas: 'Pospuestas', compensadas: 'Compensadas' }

// R7: BottomSheet / ConfirmSheet / useEscapeKey viven ahora en
// @/components/* y @/hooks/useEscapeKey. Este archivo solo los consume.

export default function EmployeeDetailPage() {
  const params = useParams()
  const router = useRouter()
  const employeeId = params?.id

  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)
  const [data, setData] = useState(null) // { employee, anniversaryInfo, balance, periods }

  const [sheet, setSheet] = useState(null) // 'tomar'|'posponer'|'compensar'|'resume'|'early'
  const [sheetCtx, setSheetCtx] = useState({}) // contexto: period seleccionado
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [confirmState, setConfirmState] = useState(null) // BUG P: reemplaza confirm()
  // Export de asistencia individual
  const [exportOpen, setExportOpen] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [expFrom, setExpFrom] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 30)
    return d.toISOString().slice(0, 10)
  })
  const [expTo, setExpTo] = useState(() => new Date().toISOString().slice(0, 10))
  // BUG 14: si el usuario edita end_date manualmente, el auto-cálculo
  // (que dispara al cambiar start_date o entitled_days) ya no debe pisar
  // su valor. Se resetea a false al abrir cada modal.
  const [endDateDirty, setEndDateDirty] = useState(false)

  const F = (k, v) => setForm(f => ({ ...f, [k]: v }))

  // ── carga ──────────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!employeeId) return
    setErr(null)
    try {
      const res = await fetch(`/api/vacations/employee/${employeeId}`, { cache: 'no-store' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) {
        setErr(body.error || `Error ${res.status}`)
        setData(null)
      } else {
        setData(body)
      }
    } catch (e) {
      setErr('No se pudo cargar el detalle')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [employeeId])

  useEffect(() => { load() }, [load])

  async function doExport(mode = 'range') {
    const isFull = mode === 'full'
    if (!isFull) {
      if (!expFrom || !expTo) { toast.error('Selecciona el rango de fechas'); return }
      if (expFrom > expTo) { toast.error('La fecha inicial debe ser menor o igual a la final'); return }
    }
    setExporting(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      if (!session) { toast.error('Sesión expirada'); setExporting(false); return }
      const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
      if (!prof?.tenant_id) { toast.error('Sin tenant'); setExporting(false); return }

      let shiftsQuery = supabase.from('shifts').select('*')
        .eq('tenant_id', prof.tenant_id)
        .eq('employee_id', employeeId)
        .order('date_str', { ascending: true })
      if (!isFull) {
        shiftsQuery = shiftsQuery.gte('date_str', expFrom).lte('date_str', expTo)
      }

      const [{ data: shifts, error: shErr }, { data: tenant }, { data: branches }, { data: allEmps }] = await Promise.all([
        shiftsQuery,
        supabase.from('tenants').select('name, config').eq('id', prof.tenant_id).single(),
        supabase.from('branches').select('id, name').eq('tenant_id', prof.tenant_id),
        supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).eq('status', 'active'),
      ])
      if (shErr) { toast.error(`Error: ${shErr.message}`); setExporting(false); return }

      // Para historial completo, el periodo real va de hire_date/fecha del primer
      // registro hasta hoy (o la fecha del último registro).
      let periodFrom = expFrom
      let periodTo = expTo
      if (isFull) {
        const first = (shifts && shifts[0]?.date_str) || employee?.hire_date?.slice(0, 10) || '2020-01-01'
        const last = (shifts && shifts.length > 0) ? shifts[shifts.length - 1].date_str : new Date().toISOString().slice(0, 10)
        periodFrom = first
        periodTo = last
      }

      generateEmployeeAttendanceXLSX({
        employee: employee,
        shifts: shifts || [],
        branches: branches || [],
        periodFrom,
        periodTo,
        companyName: tenant?.name || 'CheckPro',
        allEmployees: allEmps || [employee],
      })
      toast.success(isFull
        ? `Historial completo · ${shifts?.length || 0} registros`
        : `Exportado · ${shifts?.length || 0} registros`)
      setExportOpen(false)
    } catch (e) {
      toast.error('Error al exportar')
      console.error(e)
    } finally {
      setExporting(false)
    }
  }

  // BUG 9/14: auto-calcular end_date cuando cambian start_date o entitled_days
  // en el modal "Tomar". Si el usuario ya editó manualmente end_date
  // (endDateDirty=true) no sobreescribimos su valor.
  useEffect(() => {
    if (sheet !== 'tomar') return
    if (endDateDirty) return
    const sd = form.start_date
    const ed = Number(form.entitled_days)
    if (!sd || !Number.isFinite(ed) || ed <= 0) return
    const newEnd = addDaysISO(sd, Math.max(0, ed - 1))
    if (newEnd && newEnd !== form.end_date) {
      setForm(prev => ({ ...prev, end_date: newEnd }))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sheet, form.start_date, form.entitled_days, endDateDirty])

  // ── derivados ──────────────────────────────────────────────────────────────
  const employee = data?.employee || null
  const anniv = data?.anniversaryInfo || null
  // BUG G: balance ahora incluye los 4 contadores (pending, postponed, active, expired).
  const balance = data?.balance || { pendingDays: 0, pospuestasDays: 0, activeDays: 0, expiredDays: 0 }
  const periods = data?.periods || []
  const expiredPeriods = periods.filter(p => p.status === 'expired')
  const pendingOrPostponed = periods.filter(p => ['pending', 'postponed'].includes(p.status))

  const antig = useMemo(() => antiguedad(employee?.hire_date), [employee?.hire_date])

  // Aniversario destacado: amarillo suave <30d, amarillo fuerte <7d.
  const annivWarn = anniv && anniv.daysUntilNext >= 0 && anniv.daysUntilNext < 30
  const annivStrong = anniv && anniv.daysUntilNext >= 0 && anniv.daysUntilNext < 7

  // ── abrir modales ──────────────────────────────────────────────────────────
  function openTomar() {
    // Preselecciona el primer periodo pending si existe; si no, anniv actual.
    const firstPending = periods.find(p => p.status === 'pending' && p.tipo === 'tomadas')
    const defaultYear = firstPending?.anniversary_year || anniv?.yearsWorked || 1
    const defaultDays = firstPending?.entitled_days || 12
    setForm({
      anniversary_year: defaultYear,
      entitled_days: defaultDays,
      start_date: todayISO(),
      end_date: addDaysISO(todayISO(), Math.max(0, Number(defaultDays) - 1)),
      prima_pct: 25,
      notes: '',
    })
    setEndDateDirty(false) // BUG 14: reset flag al abrir
    setSheet('tomar')
  }

  function openPosponer() {
    setForm({
      anniversary_year: anniv?.yearsWorked || 1,
      notes: '',
    })
    setSheet('posponer')
  }

  function openCompensar() {
    const dr = dailySalary(employee)
    const defaultDays = 12
    setForm({
      anniversary_year: anniv?.yearsWorked || 1,
      compensated_days: defaultDays,
      daily_rate: dr,
      payment_type: employee?.payment_type || 'efectivo',
      notes: '',
      prima_pct: 25,
    })
    setSheet('compensar')
  }

  function openResume(period) {
    setSheetCtx({ period })
    setForm({ start_date: todayISO(), end_date: '' })
    setSheet('resume')
  }

  function openEarly(period) {
    setSheetCtx({ period })
    setForm({ return_date: todayISO() })
    setSheet('early')
  }

  function closeSheet() {
    setSheet(null)
    setSheetCtx({})
    setForm({})
    setEndDateDirty(false) // BUG 14
  }

  // ── submits ────────────────────────────────────────────────────────────────
  async function submitTomar() {
    if (!form.start_date || !form.end_date) { toast.error('Fechas requeridas'); return }
    if (form.end_date < form.start_date) { toast.error('La fecha fin no puede ser antes del inicio'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vacations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          tipo: 'tomadas',
          anniversary_year: Number(form.anniversary_year) || undefined,
          entitled_days: Number(form.entitled_days) || undefined,
          start_date: form.start_date,
          end_date: form.end_date,
          prima_pct: Number(form.prima_pct) || 25,
          notes: form.notes || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error al registrar'); setSaving(false); return }
      if (Array.isArray(body.warnings) && body.warnings.length) {
        body.warnings.forEach(w => toast(`⚠ ${w}`, { duration: 4000 }))
      }
      toast.success('Vacaciones registradas')
      closeSheet()
      await load()
    } catch { toast.error('Error de red') }
    finally { setSaving(false) }
  }

  async function submitPosponer() {
    setSaving(true)
    try {
      const res = await fetch('/api/vacations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          tipo: 'pospuestas',
          anniversary_year: Number(form.anniversary_year) || undefined,
          notes: form.notes || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error al posponer'); setSaving(false); return }
      if (Array.isArray(body.warnings) && body.warnings.length) {
        body.warnings.forEach(w => toast(`⚠ ${w}`, { duration: 4000 }))
      }
      toast.success('Periodo pospuesto')
      closeSheet()
      await load()
    } catch { toast.error('Error de red') }
    finally { setSaving(false) }
  }

  async function submitCompensar() {
    const days = Number(form.compensated_days) || 0
    if (days <= 0) { toast.error('Días a compensar debe ser > 0'); return }
    setSaving(true)
    try {
      const res = await fetch('/api/vacations/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          employee_id: employeeId,
          tipo: 'compensadas',
          anniversary_year: Number(form.anniversary_year) || undefined,
          // BUG 15: no mandar entitled_days — el form de compensar no
          // tiene input para este campo; era un residuo del state y
          // podía llegar stale o forzar override indeseado de la tabla.
          // El endpoint lo infiere del aniversario.
          compensated_days: days,
          payment_type: form.payment_type || 'efectivo',
          prima_pct: Number(form.prima_pct) || 25,
          notes: form.notes || null,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error al compensar'); setSaving(false); return }
      if (Array.isArray(body.warnings) && body.warnings.length) {
        body.warnings.forEach(w => toast(`⚠ ${w}`, { duration: 4000 }))
      }
      toast.success('Compensación registrada')
      closeSheet()
      await load()
    } catch { toast.error('Error de red') }
    finally { setSaving(false) }
  }

  async function submitResume() {
    if (!form.start_date) { toast.error('Fecha inicio requerida'); return }
    const p = sheetCtx.period
    if (!p) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vacations/${p.id}/resume`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start_date: form.start_date,
          end_date: form.end_date || undefined,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error'); setSaving(false); return }
      toast.success('Periodo reanudado')
      closeSheet()
      await load()
    } catch { toast.error('Error de red') }
    finally { setSaving(false) }
  }

  async function submitEarly() {
    const p = sheetCtx.period
    if (!p) return
    setSaving(true)
    try {
      const res = await fetch(`/api/vacations/${p.id}/early-return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ return_date: form.return_date || undefined }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error'); setSaving(false); return }
      toast.success('Reincorporación registrada')
      closeSheet()
      await load()
    } catch { toast.error('Error de red') }
    finally { setSaving(false) }
  }

  // BUG P: reemplazamos confirm()/alert() nativos por <ConfirmSheet>.
  // BUG 12: marcamos el ConfirmSheet como `loading` durante el fetch para
  // evitar double-click que dispara dos requests. El modal se cierra
  // cuando la operación termina (éxito o error).
  async function performCancel(period) {
    setConfirmState(prev => prev ? { ...prev, loading: true } : prev)
    try {
      const res = await fetch(`/api/vacations/${period.id}/cancel`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error'); return }
      toast.success('Periodo cancelado')
      await load()
    } catch { toast.error('Error de red') }
    finally {
      setConfirmState(null)
    }
  }

  function doCancel(period) {
    if (confirmState?.loading) return
    setConfirmState({
      title: 'Cancelar periodo',
      message: `¿Cancelar este periodo (${TIPO_LABEL[period.tipo]} ${period.anniversary_year})?`,
      confirmLabel: 'Cancelar periodo',
      cancelLabel: 'No',
      danger: true,
      onConfirm: () => performCancel(period),
    })
  }

  async function performReactivate(period) {
    setConfirmState(prev => prev ? { ...prev, loading: true } : prev)
    try {
      const res = await fetch(`/api/vacations/${period.id}/reactivate`, { method: 'POST' })
      const body = await res.json().catch(() => ({}))
      if (!res.ok || !body.ok) { toast.error(body.error || 'Error'); return }
      toast.success('Periodo reactivado')
      await load()
    } catch { toast.error('Error de red') }
    finally {
      setConfirmState(null)
    }
  }

  function doReactivate(period) {
    if (confirmState?.loading) return
    setConfirmState({
      title: 'Reactivar periodo prescrito',
      message: `¿Reactivar este periodo prescrito (año ${period.anniversary_year})? Volverá a ${period.start_date ? 'pendiente' : 'pospuesto'}.`,
      confirmLabel: 'Reactivar',
      cancelLabel: 'Cancelar',
      onConfirm: () => performReactivate(period),
    })
  }

  // ── render ─────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="p-5 md:p-6 max-w-3xl mx-auto">
        <div className="card animate-pulse h-24 mb-3" />
        <div className="card animate-pulse h-20 mb-3" />
        <div className="card animate-pulse h-40" />
      </div>
    )
  }

  if (err || !employee) {
    return (
      <div className="p-5 md:p-6 max-w-3xl mx-auto">
        <Link href="/dashboard/employees" className="text-brand-400 text-sm font-mono">← Volver a empleados</Link>
        <div className="card mt-4 text-center py-10">
          <div className="flex justify-center mb-3 text-yellow-400"><AlertTriangle size={40} /></div>
          <p className="text-red-400 text-sm font-mono">{err || 'Empleado no encontrado'}</p>
          <button onClick={load} className="mt-3 text-brand-400 text-sm font-semibold">Reintentar</button>
        </div>
      </div>
    )
  }

  const branchName = employee.schedule?.branch?.name || ''
  const dr = dailySalary(employee)
  const compDays = Number(form.compensated_days) || 0
  const compMonto = compDays * dr * 2 // doble pago según spec

  return (
    <div className="p-5 md:p-6 max-w-3xl mx-auto">
      {/* Back + título */}
      <div className="mb-4 flex items-center justify-between">
        <Link href="/dashboard/employees" className="text-brand-400 text-xs font-mono active:brightness-90">← Empleados</Link>
        <button
          onClick={() => setExportOpen(true)}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-dark-700 border border-dark-border text-gray-300 rounded-lg text-xs font-semibold hover:text-white active:bg-dark-600"
          title="Exportar asistencia">
          <Download size={14} /> Exportar
        </button>
      </div>

      {/* ── Header del empleado ───────────────────────────────────────────── */}
      <div className="card mb-3">
        <div className="flex items-start gap-3">
          <div className={`w-12 h-12 rounded-full flex items-center justify-center text-base font-bold font-mono shrink-0
            ${employee.can_manage ? 'bg-orange-500/10 text-orange-400 border border-orange-400/20' : 'bg-brand-400/10 text-brand-400 border border-brand-400/20'}`}>
            {employee.name.split(' ').slice(0, 2).map(w => w[0]).join('')}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-extrabold text-white break-words leading-tight">{employee.name}</h1>
              {employee.status === 'inactive' && <span className="badge-gray text-[10px]">Inactivo</span>}
            </div>
            <p className="text-xs text-gray-400 mt-0.5">
              {employee.role_label || 'Empleado'}
              {employee.department && ` · ${employee.department}`}
              {branchName && <span className="text-brand-400 inline-flex items-center gap-1"> · <Building2 size={10} /> {branchName}</span>}
            </p>
            <p className="text-[11px] text-gray-400 font-mono mt-1">
              <Calendar size={12} className="inline" /> Ingreso: {fmtLongDate(employee.hire_date)}
              {(antig.years > 0 || antig.months > 0) && (
                <> · {antig.years > 0 ? `${antig.years} año${antig.years !== 1 ? 's' : ''}` : ''}
                  {antig.years > 0 && antig.months > 0 ? ' ' : ''}
                  {antig.months > 0 ? `${antig.months} mes${antig.months !== 1 ? 'es' : ''}` : ''}
                </>
              )}
            </p>
          </div>
        </div>
      </div>

      {/* ── Próximo aniversario + Balance (grid 2 col en desktop) ─────────── */}
      <div className="grid md:grid-cols-2 gap-3 mb-3">
        {/* Próximo aniversario */}
        <div className={`card-sm border ${
          annivStrong ? 'bg-yellow-500/15 border-yellow-500/40'
          : annivWarn ? 'bg-yellow-500/10 border-yellow-500/20'
          : 'border-dark-border'
        }`}>
          <div className="flex items-center gap-2 mb-1">
            {annivStrong ? <Clock size={16} /> : <Cake size={16} />}
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Próximo aniversario</p>
          </div>
          {anniv ? (
            <>
              <p className={`text-base font-bold ${annivWarn ? 'text-yellow-400' : 'text-white'}`}>
                {fmtLongDate(anniv.nextAnnivDate)}
              </p>
              <p className="text-xs text-gray-500 mt-0.5">
                Cumple <b className="text-white">{anniv.nextYear} año{anniv.nextYear !== 1 ? 's' : ''}</b>
                {anniv.daysUntilNext >= 0 && (
                  <span> · en <b className={annivWarn ? 'text-yellow-400' : 'text-white'}>{anniv.daysUntilNext} día{anniv.daysUntilNext !== 1 ? 's' : ''}</b></span>
                )}
              </p>
            </>
          ) : (
            <p className="text-xs text-gray-500">Sin fecha de ingreso</p>
          )}
        </div>

        {/* Balance actual — BUG G: 4 contadores explicitos */}
        <div className="card-sm">
          <div className="flex items-center gap-2 mb-2">
            <Palmtree size={16} />
            <p className="text-[10px] font-mono text-gray-500 uppercase tracking-wider">Balance actual</p>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <div>
              <p className="text-xl font-extrabold text-blue-400 leading-none">{balance.pendingDays}</p>
              <p className="text-[9px] text-gray-400 font-mono mt-0.5 leading-tight">Pendientes</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-yellow-400 leading-none">{balance.pospuestasDays}</p>
              <p className="text-[9px] text-gray-400 font-mono mt-0.5 leading-tight">Pospuestos</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-green-400 leading-none">{balance.activeDays || 0}</p>
              <p className="text-[9px] text-gray-400 font-mono mt-0.5 leading-tight">Activos hoy</p>
            </div>
            <div>
              <p className="text-xl font-extrabold text-red-400 leading-none">{balance.expiredDays || 0}</p>
              <p className="text-[9px] text-gray-400 font-mono mt-0.5 leading-tight">Prescritos</p>
            </div>
          </div>
          {expiredPeriods.length > 0 && (
            <div className="mt-2 px-3 py-2 bg-red-500/10 border border-red-500/20 rounded-lg">
              <p className="text-red-400 text-[11px] font-bold flex items-center gap-1">
                <AlertTriangle size={12} /> {expiredPeriods.length} periodo{expiredPeriods.length !== 1 ? 's' : ''} prescrito{expiredPeriods.length !== 1 ? 's' : ''}
              </p>
              <p className="text-red-400/70 text-[10px] mt-0.5">Revisa el histórico abajo — puedes reactivar con el botón rojo.</p>
            </div>
          )}
        </div>
      </div>

      {/* ── Acciones ──────────────────────────────────────────────────────── */}
      <div className="mb-4">
        <p className="label mb-2">Acciones</p>
        <div className="grid grid-cols-3 gap-2">
          <button onClick={openTomar}
            className="flex flex-col items-center gap-1 py-4 px-2 rounded-xl bg-brand-400/10 border border-brand-400/30 text-brand-400 font-bold text-xs active:bg-brand-400/20 transition">
            <Palmtree size={22} />
            Tomar ahora
          </button>
          <button onClick={openPosponer}
            className="flex flex-col items-center gap-1 py-4 px-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-orange-400 font-bold text-xs active:bg-orange-500/20 transition">
            <Calendar size={22} />
            Posponer
          </button>
          <button onClick={openCompensar}
            className="flex flex-col items-center gap-1 py-4 px-2 rounded-xl bg-blue-500/10 border border-blue-500/30 text-blue-400 font-bold text-xs active:bg-blue-500/20 transition">
            <DollarSign size={22} />
            Compensar
          </button>
        </div>
      </div>

      {/* ── Histórico ─────────────────────────────────────────────────────── */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-bold text-white">Histórico de periodos</h2>
          <span className="text-[10px] font-mono text-gray-500">{periods.length} registro{periods.length !== 1 ? 's' : ''}</span>
        </div>

        {periods.length === 0 ? (
          <div className="text-center py-8 text-gray-500 font-mono text-xs">
            Sin periodos registrados.
          </div>
        ) : (
          <>
            {/* Desktop: tabla */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-gray-500 font-mono uppercase text-[10px] border-b border-dark-border">
                    <th className="py-2 pr-2">Año</th>
                    <th className="py-2 pr-2">Tipo</th>
                    <th className="py-2 pr-2">Status</th>
                    <th className="py-2 pr-2">Días</th>
                    <th className="py-2 pr-2">Fechas</th>
                    <th className="py-2 pr-2">Pago</th>
                    <th className="py-2 pr-2">Notas</th>
                    <th className="py-2 pr-2 text-right">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {periods.map(p => (
                    <tr key={p.id} className={`border-b border-dark-border/50 ${p.status === 'cancelled' ? 'opacity-60' : ''}`}>
                      <td className="py-2 pr-2 font-mono text-white">{p.anniversary_year}</td>
                      <td className="py-2 pr-2">
                        <span className="text-gray-300">{TIPO_ICON[p.tipo]} {TIPO_LABEL[p.tipo]}</span>
                      </td>
                      <td className="py-2 pr-2">
                        <span className={`${STATUS_CLASS[p.status] || 'badge-gray'} text-[9px]`}>{STATUS_LABEL[p.status] || p.status}</span>
                      </td>
                      <td className="py-2 pr-2 font-mono text-white">
                        {p.tipo === 'compensadas' ? (p.compensated_days || p.entitled_days) : p.entitled_days}
                      </td>
                      <td className="py-2 pr-2 font-mono text-gray-400">
                        {p.start_date ? fmtShortDate(p.start_date) : '—'}
                        {p.end_date ? ` → ${fmtShortDate(p.end_date)}` : ''}
                      </td>
                      <td className="py-2 pr-2 font-mono text-gray-400">
                        {p.tipo === 'compensadas' && p.compensated_amount != null
                          ? `${fmtMoney(p.compensated_amount)} · ${p.payment_type || '—'}`
                          : '—'}
                      </td>
                      <td className="py-2 pr-2 text-gray-500 max-w-[180px] truncate" title={p.notes || ''}>
                        {p.notes || '—'}
                      </td>
                      <td className="py-2 pr-2 text-right">
                        <PeriodActions period={p} onCancel={doCancel} onResume={openResume} onEarly={openEarly} onReactivate={doReactivate} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile: cards */}
            <div className="md:hidden space-y-2">
              {periods.map(p => (
                <div key={p.id}
                  className={`p-3 bg-dark-700 border border-dark-border rounded-xl ${p.status === 'cancelled' ? 'opacity-60' : ''}`}>
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-mono text-white font-bold">Año {p.anniversary_year}</span>
                      <span className="text-xs text-gray-400">{TIPO_ICON[p.tipo]} {TIPO_LABEL[p.tipo]}</span>
                    </div>
                    <span className={`${STATUS_CLASS[p.status] || 'badge-gray'} text-[9px] shrink-0`}>{STATUS_LABEL[p.status] || p.status}</span>
                  </div>
                  <div className="text-[11px] text-gray-500 font-mono">
                    {p.tipo === 'compensadas' ? (p.compensated_days || p.entitled_days) : p.entitled_days} días
                    {p.start_date && <> · {fmtShortDate(p.start_date)}{p.end_date ? ` → ${fmtShortDate(p.end_date)}` : ''}</>}
                  </div>
                  {p.tipo === 'compensadas' && p.compensated_amount != null && (
                    <div className="text-[11px] text-blue-400/80 font-mono mt-0.5 flex items-center gap-1">
                      <DollarSign size={11} /> {fmtMoney(p.compensated_amount)} · {p.payment_type || '—'}
                    </div>
                  )}
                  {p.notes && <div className="text-[11px] text-gray-500 mt-1 italic">“{p.notes}”</div>}
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <PeriodActions period={p} onCancel={doCancel} onResume={openResume} onEarly={openEarly} onReactivate={doReactivate} />
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* ── Modal: Tomar ──────────────────────────────────────────────────── */}
      <BottomSheet open={sheet === 'tomar'} title={<span className="flex items-center gap-2"><Umbrella size={18} /> Tomar vacaciones ahora</span>} onClose={closeSheet}>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="vac-anniv">Aniversario</label>
            {pendingOrPostponed.filter(p => p.tipo !== 'compensadas').length > 0 ? (
              <select id="vac-anniv" className="input" value={form.anniversary_year || ''}
                onChange={e => {
                  const y = Number(e.target.value)
                  const found = periods.find(p => p.anniversary_year === y && ['pending','postponed'].includes(p.status))
                  // BUG 9: usar updater funcional; el useEffect sincroniza end_date.
                  setForm(prev => ({
                    ...prev,
                    anniversary_year: y,
                    entitled_days: found?.entitled_days || prev.entitled_days,
                  }))
                }}>
                {pendingOrPostponed.filter(p => p.tipo !== 'compensadas').map(p => (
                  <option key={p.id} value={p.anniversary_year}>
                    Año {p.anniversary_year} — {p.entitled_days} días ({STATUS_LABEL[p.status]})
                  </option>
                ))}
                {anniv && !pendingOrPostponed.some(p => p.anniversary_year === anniv.yearsWorked) && (
                  <option value={anniv.yearsWorked}>Año {anniv.yearsWorked} (nuevo)</option>
                )}
              </select>
            ) : (
              <div className="input bg-dark-700 text-gray-400 text-xs">
                Año {anniv?.yearsWorked || 1} (se auto-genera el periodo)
              </div>
            )}
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="label" htmlFor="vac-start-date">Fecha inicio</label>
              {/* BUG Q: start_date no puede ser pasado al crear nuevo periodo */}
              <input id="vac-start-date" type="date" className="input"
                min={todayISO()}
                value={form.start_date || ''}
                onChange={e => F('start_date', e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="vac-end-date">Fecha fin</label>
              {/* BUG Q: end_date no puede ser antes de start_date */}
              {/* BUG 14: marcar dirty al teclear para que el auto-cálculo
                  no pise la edición manual. */}
              <input id="vac-end-date" type="date" className="input"
                min={form.start_date || todayISO()}
                value={form.end_date || ''}
                onChange={e => { setEndDateDirty(true); F('end_date', e.target.value) }} />
            </div>
          </div>

          <div>
            <label className="label" htmlFor="vac-prima-pct">Prima vacacional (%)</label>
            <input id="vac-prima-pct" type="number" step="0.01" min="0" className="input" value={form.prima_pct ?? 25}
              onChange={e => F('prima_pct', e.target.value)} />
            {Number(form.prima_pct) < 25 && (
              <p className="text-[10px] text-yellow-400 font-mono mt-1">⚠ La LFT exige mínimo 25%.</p>
            )}
          </div>

          <div>
            <label className="label" htmlFor="vac-notes">Notas (opcional)</label>
            <textarea id="vac-notes" className="input min-h-[70px]" rows={3} value={form.notes || ''}
              onChange={e => F('notes', e.target.value)} placeholder="Detalles del periodo…" />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={submitTomar} disabled={saving} className="btn-primary">
              {saving ? 'Guardando…' : 'Registrar'}
            </button>
            <button onClick={closeSheet} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── Modal: Posponer ───────────────────────────────────────────────── */}
      <BottomSheet open={sheet === 'posponer'} title={<span className="flex items-center gap-2"><Calendar size={18} /> Posponer periodo</span>} onClose={closeSheet}>
        <div className="space-y-3">
          <div className="px-3 py-2 bg-orange-500/10 border border-orange-500/20 rounded-lg text-orange-400 text-[11px]">
            Se pospondrá el periodo del aniversario {form.anniversary_year || anniv?.yearsWorked || 1}. La LFT permite posponer hasta la fecha de prescripción (18 meses tras el aniversario).
          </div>
          <div>
            <label className="label" htmlFor="vac-posp-notes">Notas (por qué se pospone)</label>
            <textarea id="vac-posp-notes" className="input min-h-[90px]" rows={4} value={form.notes || ''}
              onChange={e => F('notes', e.target.value)} placeholder="Ej: temporada alta, acuerdo con empleado…" />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={submitPosponer} disabled={saving} className="btn-primary">
              {saving ? 'Guardando…' : 'Posponer'}
            </button>
            <button onClick={closeSheet} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── Modal: Compensar ──────────────────────────────────────────────── */}
      <BottomSheet open={sheet === 'compensar'} title={<span className="flex items-center gap-2"><DollarSign size={18} /> Compensar vacaciones</span>} onClose={closeSheet}>
        <div className="space-y-3">
          <div>
            <label className="label" htmlFor="vac-comp-anniv">Aniversario</label>
            <input id="vac-comp-anniv" type="number" className="input" value={form.anniversary_year ?? 1}
              onChange={e => F('anniversary_year', e.target.value)} />
            <p className="text-[10px] text-gray-400 font-mono mt-1">
              El API toma el periodo pendiente correspondiente.
            </p>
          </div>

          <div>
            <label className="label" htmlFor="vac-comp-days">Días a compensar</label>
            <input id="vac-comp-days" type="number" min="1" className="input" value={form.compensated_days ?? ''}
              onChange={e => F('compensated_days', e.target.value)} />
          </div>

          <div>
            <label className="label" htmlFor="vac-comp-payment">Tipo de pago</label>
            <select id="vac-comp-payment" className="input" value={form.payment_type || 'efectivo'}
              onChange={e => F('payment_type', e.target.value)}>
              <option value="efectivo">Efectivo</option>
              <option value="transferencia">Transferencia</option>
            </select>
            <p className="text-[10px] text-gray-400 font-mono mt-1">
              Default heredado del empleado ({employee.payment_type || 'efectivo'}).
            </p>
          </div>

          <div>
            <label className="label" htmlFor="vac-comp-prima">Prima vacacional (%)</label>
            <input id="vac-comp-prima" type="number" step="0.01" min="0" className="input" value={form.prima_pct ?? 25}
              onChange={e => F('prima_pct', e.target.value)} />
          </div>

          <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
            <p className="text-[10px] font-mono text-blue-400 uppercase tracking-wider mb-1">Monto calculado</p>
            <p className="text-lg font-extrabold text-white">{fmtMoney(compMonto)}</p>
            <p className="text-[10px] text-gray-300 font-mono mt-1">
              Doble pago = {compDays} días × {fmtMoney(dr)}/día × 2
            </p>
          </div>

          <div>
            <label className="label" htmlFor="vac-comp-notes">Notas (opcional)</label>
            <textarea id="vac-comp-notes" className="input min-h-[70px]" rows={3} value={form.notes || ''}
              onChange={e => F('notes', e.target.value)} />
          </div>

          <div className="flex gap-2 pt-2">
            <button onClick={submitCompensar} disabled={saving} className="btn-primary">
              {saving ? 'Guardando…' : 'Registrar compensación'}
            </button>
            <button onClick={closeSheet} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── Modal: Reanudar (pospuestas → tomar) ──────────────────────────── */}
      <BottomSheet open={sheet === 'resume'} title={<span className="flex items-center gap-2"><Play size={18} /> Reanudar periodo pospuesto</span>} onClose={closeSheet}>
        <div className="space-y-3">
          <div className="text-[11px] font-mono text-gray-500">
            Año {sheetCtx.period?.anniversary_year} · {sheetCtx.period?.entitled_days} días
          </div>
          <div>
            <label className="label" htmlFor="vac-resume-start">Fecha inicio</label>
            {/* BUG C + Q: resume rechaza pasado; limitar min a hoy */}
            <input id="vac-resume-start" type="date" className="input"
              min={todayISO()}
              value={form.start_date || ''}
              onChange={e => F('start_date', e.target.value)} />
          </div>
          <div>
            <label className="label" htmlFor="vac-resume-end">Fecha fin (opcional)</label>
            <input id="vac-resume-end" type="date" className="input"
              min={form.start_date || todayISO()}
              value={form.end_date || ''}
              onChange={e => F('end_date', e.target.value)} />
            <p className="text-[10px] text-gray-400 font-mono mt-1">
              Si se omite, el API calcula automáticamente según días disponibles.
            </p>
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={submitResume} disabled={saving} className="btn-primary">
              {saving ? 'Guardando…' : 'Reanudar'}
            </button>
            <button onClick={closeSheet} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </BottomSheet>

      {/* ── Modal: Reincorporación temprana ───────────────────────────────── */}
      <BottomSheet open={sheet === 'early'} title={<span className="flex items-center gap-2"><CornerUpLeft size={18} /> Reincorporación temprana</span>} onClose={closeSheet}>
        <div className="space-y-3">
          <div className="px-3 py-2 bg-yellow-500/10 border border-yellow-500/20 rounded-lg text-yellow-400 text-[11px]">
            Cerrarás este periodo en la fecha indicada. El empleado regresa a trabajar.
          </div>
          <div>
            <label className="label" htmlFor="vac-return-date">Fecha de reincorporación</label>
            {/* BUG 13: el max anterior (end_date+1) dejaba seleccionar un
                día DESPUÉS del fin del periodo. min/max ahora coinciden
                con el rango real [start_date, end_date]. */}
            <input id="vac-return-date" type="date" className="input"
              min={sheetCtx.period?.start_date || undefined}
              max={sheetCtx.period?.end_date || undefined}
              value={form.return_date || ''}
              onChange={e => F('return_date', e.target.value)} />
          </div>
          <div className="flex gap-2 pt-2">
            <button onClick={submitEarly} disabled={saving} className="btn-primary">
              {saving ? 'Guardando…' : 'Confirmar'}
            </button>
            <button onClick={closeSheet} className="btn-ghost">Cancelar</button>
          </div>
        </div>
      </BottomSheet>

      {/* BUG P: ConfirmSheet reutilizable (reemplaza confirm()/alert()) */}
      <ConfirmSheet state={confirmState} onCancel={() => setConfirmState(null)} />

      {/* Modal exportar asistencia individual */}
      {exportOpen && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="bg-dark-800 border border-dark-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
               style={{ maxHeight: '90dvh' }}>
            <div className="px-5 pt-4 pb-2 shrink-0">
              <h3 className="text-lg font-bold text-white">Exportar asistencia</h3>
              <p className="text-xs text-gray-500 mt-0.5">{employee.name}</p>
            </div>
            <div className="px-5 pb-4 min-h-0 overflow-y-auto flex-1" style={{ touchAction: 'pan-y' }}>
              <div className="grid grid-cols-2 gap-2 mb-3">
                <div>
                  <label className="label">Desde</label>
                  <input type="date" className="input text-sm" value={expFrom}
                    onChange={e => setExpFrom(e.target.value)} />
                </div>
                <div>
                  <label className="label">Hasta</label>
                  <input type="date" className="input text-sm" value={expTo}
                    onChange={e => setExpTo(e.target.value)} />
                </div>
              </div>
              <div className="flex gap-1.5 flex-wrap mb-2">
                {[
                  { label: 'Últimos 7 días', days: 7 },
                  { label: '30 días', days: 30 },
                  { label: '90 días', days: 90 },
                ].map(p => (
                  <button key={p.days} type="button"
                    onClick={() => {
                      const to = new Date()
                      const from = new Date(); from.setDate(from.getDate() - p.days)
                      setExpFrom(from.toISOString().slice(0, 10))
                      setExpTo(to.toISOString().slice(0, 10))
                    }}
                    className="px-2.5 py-1 rounded-lg text-[11px] bg-dark-700 border border-dark-border text-gray-400 hover:text-white">
                    {p.label}
                  </button>
                ))}
              </div>
              <p className="text-[11px] text-gray-400 mt-2">
                Se exportará un archivo con dos hojas: Registros y Resumen (incluye tarifa/hora y neto a pagar).
              </p>

              <div className="mt-4 pt-4 border-t border-dark-border">
                <p className="text-[10px] font-mono uppercase tracking-wider text-gray-500 mb-2">Historial completo</p>
                <button
                  type="button"
                  onClick={() => doExport('full')}
                  disabled={exporting}
                  className="w-full px-3 py-2.5 bg-dark-700 border border-dark-border rounded-lg text-sm text-white font-semibold hover:bg-dark-600 active:bg-dark-600 disabled:opacity-50 flex items-center justify-between">
                  <span className="inline-flex items-center gap-2">
                    <Download size={14} /> Exportar TODO el historial
                  </span>
                  <span className="text-[10px] font-mono text-brand-400">ignora rango</span>
                </button>
                <p className="text-[11px] text-gray-400 mt-2 leading-snug">
                  Trae cada registro de entrada y salida del empleado desde su alta. Pensado para auditorías, terminación laboral o finiquito.
                </p>
              </div>
            </div>
            <div className="px-5 pb-5 pt-2 border-t border-dark-border shrink-0 flex gap-2">
              <button onClick={() => doExport('range')} disabled={exporting}
                className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90 disabled:opacity-50">
                {exporting ? 'Generando...' : 'Descargar período'}
              </button>
              <button onClick={() => setExportOpen(false)} disabled={exporting}
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

// ── Botones de acción por status ──────────────────────────────────────────────
function PeriodActions({ period, onCancel, onResume, onEarly, onReactivate }) {
  const s = period.status
  const base = 'px-2.5 py-1 rounded-lg text-[10px] font-bold border active:brightness-90'
  if (s === 'pending') {
    return (
      <button onClick={() => onCancel(period)}
        className={`${base} bg-dark-700 border-dark-border text-gray-400`}>
        Cancelar
      </button>
    )
  }
  if (s === 'active') {
    return (
      <div className="flex gap-1.5 justify-end flex-wrap">
        <button onClick={() => onEarly(period)}
          className={`${base} bg-yellow-500/10 border-yellow-500/30 text-yellow-400`}>
          Reincorporación temprana
        </button>
        <button onClick={() => onCancel(period)}
          className={`${base} bg-dark-700 border-dark-border text-gray-400`}>
          Cancelar
        </button>
      </div>
    )
  }
  if (s === 'postponed') {
    return (
      <div className="flex gap-1.5 justify-end flex-wrap">
        <button onClick={() => onResume(period)}
          className={`${base} bg-brand-400/10 border-brand-400/30 text-brand-400`}>
          Reanudar
        </button>
        <button onClick={() => onCancel(period)}
          className={`${base} bg-dark-700 border-dark-border text-gray-400`}>
          Cancelar
        </button>
      </div>
    )
  }
  if (s === 'expired') {
    return (
      <button onClick={() => onReactivate(period)}
        className={`${base} bg-red-500/10 border-red-500/30 text-red-400`}>
        Reactivar
      </button>
    )
  }
  // completed, cancelled → solo lectura
  return <span className="text-[10px] text-gray-600 font-mono">—</span>
}
