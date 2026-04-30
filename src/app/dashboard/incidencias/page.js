'use client'
// src/app/dashboard/incidencias/page.js
import { useState, useEffect, useCallback } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import { scheduledExitDate, scheduledDayHours } from '@/lib/utils'
import { fromZonedTime } from 'date-fns-tz'
import toast from 'react-hot-toast'
import BranchFilter from '@/components/BranchFilter'
import {
  AlertCircle, CheckCircle2, Plus, Inbox, Lock, X, RefreshCw,
  MapPin, Smartphone, Wifi, Clock, UserCheck, UserX, AlertTriangle,
} from 'lucide-react'

const KIND_LABEL = {
  falta: 'Falta',
  retardo: 'Retardo',
  retardo_justificado: 'Retardo justificado',
  horas_extra: 'Horas extra',
  fuera_de_rango: 'Fuera de rango GPS',
  cobertura: 'Cobertura',
  abandono: 'Abandono de turno',
  salida_temprana: 'Salida temprana',
  permiso: 'Permiso',
  device_mismatch: 'Dispositivo diferente',
  ip_mismatch: 'Red diferente',
  no_planificado: 'Sin plan (mixto)',
  '4_retardos_falta': '4 retardos = 1 falta',
  '3_faltas_causal': 'Causal despido Art. 47',
  otro: 'Otro',
}

const KIND_COLOR = {
  falta: 'bg-red-500/10 border-red-500/30 text-red-300',
  retardo: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  retardo_justificado: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  horas_extra: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  fuera_de_rango: 'bg-red-500/10 border-red-500/30 text-red-300',
  cobertura: 'bg-teal-500/10 border-teal-500/30 text-teal-300',
  abandono: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  salida_temprana: 'bg-amber-500/10 border-amber-500/30 text-amber-300',
  permiso: 'bg-blue-500/10 border-blue-500/30 text-blue-300',
  device_mismatch: 'bg-purple-500/10 border-purple-500/30 text-purple-300',
  ip_mismatch: 'bg-purple-500/10 border-purple-500/30 text-purple-300',
  no_planificado: 'bg-orange-500/10 border-orange-500/30 text-orange-300',
  '4_retardos_falta': 'bg-red-500/10 border-red-500/30 text-red-300',
  '3_faltas_causal': 'bg-red-600/20 border-red-600/40 text-red-200',
  otro: 'bg-gray-500/10 border-gray-500/30 text-gray-300',
}

// Opciones de resolución por tipo
const RESOLUTION_OPTIONS = {
  falta: [
    { value: 'falta_injustificada', label: 'Injustificada', desc: 'Sin causa válida. No se paga. Cuenta para Art. 47 LFT.', color: 'red' },
    { value: 'falta_justificada_pagada', label: 'Justificada — con goce de sueldo', desc: 'Falta con justificante. Se paga el día.', color: 'green' },
    { value: 'falta_justificada_no_pagada', label: 'Justificada — sin goce de sueldo', desc: 'Falta con justificante pero sin pago del día.', color: 'orange' },
  ],
  retardo: [
    { value: 'justificado', label: 'Justificado', desc: 'Causa válida. No cuenta para acumulador de retardos.', color: 'green' },
    { value: 'injustificado', label: 'Injustificado', desc: 'Sin causa. Acumula hacia los 4 retardos = 1 falta.', color: 'red' },
    { value: 'exonerado', label: 'Exonerado', desc: 'Sin consecuencias disciplinarias.', color: 'blue' },
  ],
  horas_extra: [
    { value: 'autorizado_pago', label: 'Autorizar y pagar', desc: 'Se pagan como horas extra (×2 según LFT).', color: 'green' },
    { value: 'no_pagar', label: 'No autorizado — no pagar', desc: 'No se incluyen en nómina.', color: 'red' },
    { value: 'compensar_tiempo', label: 'Compensar con tiempo libre', desc: 'Se acredita tiempo equivalente en descanso.', color: 'blue' },
  ],
  fuera_de_rango: [
    { value: 'error_gps', label: 'Error de GPS', desc: 'Sin consecuencias disciplinarias. Falla de señal.', color: 'blue' },
    { value: 'intento_fraude', label: 'Intento de fraude', desc: 'Se registra falta grave en historial disciplinario.', color: 'red' },
  ],
  no_planificado: [
    { value: 'aprobar_jornada', label: 'Aprobar jornada', desc: 'Se incluye en nómina y asistencia normalmente.', color: 'green' },
    { value: 'rechazar', label: 'Rechazar', desc: 'No cuenta en asistencia ni nómina.', color: 'red' },
  ],
  abandono: [
    { value: 'salio_en_hora', label: 'Salió a su hora (registrar salida)', desc: 'Error del sistema. Se registra la salida programada.', color: 'blue' },
    { value: 'registrar_manual', label: 'Registrar hora de salida manual', desc: 'El gerente indica la hora real de salida.', color: 'orange' },
    { value: 'falta_grave', label: 'Falta grave', desc: 'Abandono real de turno. Se registra en historial disciplinario.', color: 'red' },
  ],
  salida_temprana: [
    { value: 'justificada', label: 'Justificada', desc: 'Con autorización previa. Sin consecuencias.', color: 'green' },
    { value: 'injustificada', label: 'Injustificada — descontar tiempo', desc: 'Sin autorización. Se descuenta el tiempo faltante.', color: 'orange' },
    { value: 'falta_grave', label: 'Falta grave', desc: 'Patrón reincidente. Se registra en historial disciplinario.', color: 'red' },
  ],
  ip_mismatch: [
    { value: 'autorizada', label: 'Autorizada', desc: 'El cambio de red fue justificado.', color: 'green' },
    { value: 'no_autorizada', label: 'No autorizada', desc: 'Marcaje sospechoso. Se registra en historial.', color: 'red' },
  ],
  cobertura: [
    { value: 'autorizada', label: 'Cobertura autorizada', desc: 'El reemplazo fue aprobado por el gerente.', color: 'green' },
    { value: 'no_autorizada', label: 'No autorizada', desc: 'Cambio de turno no aprobado. Ambos empleados quedan marcados.', color: 'red' },
  ],
  device_mismatch: [
    { value: 'revisado', label: 'Revisado — sin consecuencias', desc: 'Explicación válida para el cambio de dispositivo.', color: 'blue' },
    { value: 'fraude_confirmado', label: 'Fraude confirmado', desc: 'Se registra falta grave en historial disciplinario para ambos empleados involucrados.', color: 'red' },
  ],
  '4_retardos_falta': [
    { value: 'convertir_falta', label: 'Convertir a falta injustificada', desc: 'Marca el día de hoy como falta injustificada en el historial disciplinario.', color: 'red' },
    { value: 'dejar_pasar', label: 'Dejar pasar — solo aviso', desc: 'Se cierra la alerta sin generar falta. El acumulador de retardos sigue contando.', color: 'blue' },
  ],
}

const OPTION_BORDER = {
  red: 'bg-red-500/10 border-red-500/30',
  green: 'bg-green-500/10 border-green-500/30',
  blue: 'bg-blue-500/10 border-blue-500/30',
  orange: 'bg-orange-500/10 border-orange-500/30',
}

export default function IncidenciasPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [profile, setProfile] = useState(null)
  const [incidencias, setIncidencias] = useState([])
  const [filter, setFilter] = useState('open')
  const [resolvingId, setResolvingId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [resolutionText, setResolutionText] = useState('')
  const [selectedOption, setSelectedOption] = useState('')
  const [manualTime, setManualTime] = useState('')
  // Creación manual
  const [showNew, setShowNew] = useState(false)
  const [employees, setEmployees] = useState([])
  const [branches, setBranches] = useState([])
  const [selectedBranchId, setSelectedBranchId] = useState('all')
  const [empFilter, setEmpFilter] = useState('')
  const searchParams = useSearchParams()

  // Body scroll lock — igual que BottomSheet.js, evita que el fondo se mueva en móvil
  useEffect(() => {
    if (detail || showNew) {
      document.body.style.overflow = 'hidden'
    } else {
      document.body.style.overflow = ''
    }
    return () => { document.body.style.overflow = '' }
  }, [detail, showNew])
  const [newForm, setNewForm] = useState({ employee_id: '', date_str: '', kind: 'falta', description: '' })

  const load = useCallback(async () => {
    setLoading(true)
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) { router.push('/login'); return }
    const { data: prof } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (!prof?.tenant_id) { router.push('/onboarding'); return }
    setProfile(prof)

    // FIX: branch isolation server-side
    const isManagerBranch = prof.role === 'manager' && !!prof.branch_id
    let empQuery = supabase
      .from('employees')
      .select('id, name, employee_code, branch_id')
      .eq('tenant_id', prof.tenant_id)
      .eq('status', 'active')
      .order('name')
    if (isManagerBranch) empQuery = empQuery.eq('branch_id', prof.branch_id)
    let branchQuery = supabase
      .from('branches')
      .select('id,name')
      .eq('tenant_id', prof.tenant_id)
      .eq('active', true)
      .order('created_at')
    if (isManagerBranch) branchQuery = branchQuery.eq('id', prof.branch_id)
    const [{ data: emps }, { data: branchData }] = await Promise.all([empQuery, branchQuery])
    setEmployees(emps || [])
    setBranches(branchData || [])
    setSelectedBranchId(cur => {
      if (isManagerBranch) return prof.branch_id || 'all'
      if (cur !== 'all' && (branchData || []).some(b => b.id === cur)) return cur
      return cur || 'all'
    })
    const empIds = (emps || []).map(e => e.id)
    const branchEmpIds = selectedBranchId !== 'all'
      ? (emps || []).filter(e => e.branch_id === selectedBranchId).map(e => e.id)
      : empIds

    let q = supabase
      .from('incidencias')
      .select('*')
      .eq('tenant_id', prof.tenant_id)
      .order('date_str', { ascending: false })
      .order('created_at', { ascending: false })
    if (filter !== 'all') q = q.eq('status', filter === 'resolved' ? 'resolved' : 'open')
    // FIX: filtro de sucursal para admin global usando empleados ya aislados por tenant/role.
    const scopedEmpIds = (isManagerBranch || selectedBranchId !== 'all') ? branchEmpIds : empIds
    if (isManagerBranch || selectedBranchId !== 'all') q = scopedEmpIds.length ? q.in('employee_id', scopedEmpIds) : null
    const { data: incs, error } = q ? await q : { data: [], error: null }
    if (error) {
      setIncidencias([])
    } else {
      setIncidencias(incs || [])
    }
    setLoading(false)
  }, [router, filter, selectedBranchId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const empId = searchParams.get('employee_id')
    const status = searchParams.get('status')
    if (status === 'open') setFilter('open')
    if (empId) setEmpFilter(empId)
  }, [searchParams])

  function openDetail(inc) {
    setDetail(inc)
    setResolutionText('')
    const opts = RESOLUTION_OPTIONS[inc.kind]
    setSelectedOption(opts ? opts[0].value : '')
    setManualTime('')
  }

  async function detectNow() {
    setDetecting(true)
    try {
      const supabase = createClient()
      const { data: { session } } = await supabase.auth.getSession()
      const res = await fetch('/api/incidencias/detect-now', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${session?.access_token || ''}` },
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Error desconocido')
      if (data.total === 0) {
        toast.success('Detección completada — sin nuevas incidencias')
      } else {
        toast.success(`Se detectaron ${data.total} incidencia${data.total !== 1 ? 's' : ''} nuevas`)
      }
      load()
    } catch (e) {
      toast.error(`Error al detectar: ${e.message}`)
    } finally {
      setDetecting(false)
    }
  }

  async function resolveIncidencia() {
    if (!detail) return
    if (resolvingId === detail.id) return
    if (profile?.tenant_id && detail.tenant_id !== profile.tenant_id) { toast.error('Incidencia fuera de tu empresa'); return } // FIX: defensa cliente contra resolucion cross-tenant.
    const opts = RESOLUTION_OPTIONS[detail.kind]
    if (opts && !selectedOption) {
      toast.error('Selecciona una opción')
      return
    }
    if (!opts && !resolutionText.trim()) {
      toast.error('Agrega una nota breve de resolución')
      return
    }
    // FIX: validate manualTime format before submit
    if (manualTime && !/^\d{2}:\d{2}$/.test(manualTime)) {
      toast.error('Formato de hora invalido, usa HH:MM')
      return
    }
    // FIX: disable resolution buttons during fetch to prevent double-submit
    setResolvingId(detail.id)
    const supabase = createClient()

    // Construir texto de resolución
    const opt = opts?.find(o => o.value === selectedOption)
    const resolveLabel = opt ? opt.label : resolutionText
    const fullNote = resolutionText.trim()
      ? `${resolveLabel} · ${resolutionText.trim()}`
      : resolveLabel

    // Acciones especiales según tipo y opción
    try {
      if (detail.kind === 'falta') {
        await resolveFalta(supabase, selectedOption, resolveLabel, resolutionText)
      } else if (detail.kind === '4_retardos_falta' && selectedOption === 'convertir_falta') {
        await resolveRetardosThresholdToFalta(supabase, fullNote)
      } else if (detail.kind === 'abandono' && selectedOption === 'salio_en_hora') {
        await resolveAbandonoScheduled(supabase, fullNote)
      } else if (detail.kind === 'abandono' && selectedOption === 'registrar_manual') {
        if (!manualTime) { toast.error('Ingresa la hora de salida'); setResolvingId(null); return }
        await resolveAbandonoManual(supabase, fullNote)
      } else if (detail.kind === 'fuera_de_rango' && selectedOption === 'intento_fraude') {
        await resolveFraudeGps(supabase, fullNote)
      } else if (detail.kind === 'device_mismatch' && selectedOption === 'fraude_confirmado') {
        await resolveFraudeDevice(supabase, fullNote)
      } else {
        // Resolución genérica
        await resolveGenericOpt(supabase, fullNote)
      }

      toast.success('Incidencia resuelta')
      setDetail(null)
      setResolutionText('')
      load()
    } catch (e) {
      toast.error(`Error: ${e.message}`)
    } finally {
      setResolvingId(null)
    }
  }

  async function resolveFalta(supabase, absenceType, label, note) {
    const isGrave = absenceType === 'falta_injustificada'
    const isPaid = absenceType === 'falta_justificada_pagada'
    const fullNote = `${label}${note ? ' · ' + note : ''}`

    // FIX nomina: si la falta se paga, popular duration_hours con las horas programadas del dia.
    // Asi calcShiftPay/empWeekSummary cobran el dia correctamente.
    let paidHours = 0
    if (isPaid) {
      const { data: emp } = await supabase
        .from('employees').select('schedule, is_mixed, daily_hours')
        .eq('id', detail.employee_id).eq('tenant_id', profile?.tenant_id).maybeSingle()
      let plan = null
      if (emp?.is_mixed) {
        const { data: planRow } = await supabase
          .from('shift_plans').select('entry_time_str, duration_hours')
          .eq('tenant_id', profile?.tenant_id).eq('employee_id', detail.employee_id)
          .eq('date_str', detail.date_str).maybeSingle()
        plan = planRow || null
        // Fallback razonable para mixto sin plan: daily_hours del empleado.
        if (!plan && emp?.daily_hours > 0) plan = { duration_hours: Number(emp.daily_hours) }
      }
      paidHours = scheduledDayHours(emp || {}, detail.date_str, 'America/Mexico_City', plan)
    }

    const { data: existing } = await supabase
      .from('shifts').select('id')
      .eq('tenant_id', detail.tenant_id)
      .eq('employee_id', detail.employee_id)
      .eq('date_str', detail.date_str)
      .maybeSingle()

    if (existing?.id) {
      const { error } = await supabase.from('shifts').update({
        status: 'absent',
        duration_hours: paidHours,
        classification: { type: absenceType, label },
        incidents: isGrave ? [{ type: 'grave', note: fullNote, ts: new Date().toISOString() }] : [],
      }).eq('id', existing.id).eq('tenant_id', profile?.tenant_id) // FIX: no actualizar shifts fuera del tenant cargado.
      if (error) throw error
    } else {
      const { error } = await supabase.from('shifts').insert({
        tenant_id: detail.tenant_id, employee_id: detail.employee_id,
        date_str: detail.date_str, entry_time: null, exit_time: null,
        duration_hours: paidHours, status: 'absent',
        classification: { type: absenceType, label },
        incidents: isGrave ? [{ type: 'grave', note: fullNote, ts: new Date().toISOString() }] : [],
        corrections: [],
      })
      if (error) throw error
    }

    const { error: incErr } = await supabase.from('incidencias').update({
      status: 'resolved', resolution: fullNote,
      resolved_by: profile?.id || null, resolved_by_name: profile?.name || null,
      resolved_at: new Date().toISOString(),
    }).eq('id', detail.id).eq('tenant_id', profile?.tenant_id) // FIX: resolver solo incidencias del tenant actual.
    if (incErr) throw incErr

    await supabase.from('audit_log').insert({
      tenant_id: detail.tenant_id, action: 'ABSENCE',
      employee_id: detail.employee_id, employee_name: detail.employee_name,
      detail: `${label} · ${detail.date_str}${note ? ' · ' + note : ''}`, success: true,
    })
  }

  // Cuando admin decide convertir el aviso "4 retardos = 1 falta" en una falta real:
  // crea/actualiza el shift de hoy como falta_injustificada y resuelve la incidencia.
  async function resolveRetardosThresholdToFalta(supabase, fullNote) {
    const today = detail.date_str // detect-now usa hoy como date_str de la alerta
    const { data: existing } = await supabase
      .from('shifts').select('id, status, classification')
      .eq('tenant_id', detail.tenant_id)
      .eq('employee_id', detail.employee_id)
      .eq('date_str', today)
      .maybeSingle()

    const classification = { type: 'falta_injustificada', label: 'Falta injustificada (acumulado de retardos)' }
    const incidents = [{ type: 'grave', note: fullNote, ts: new Date().toISOString() }]

    if (existing?.id) {
      // Si ya hay un shift hoy (ej: el empleado checó tarde), lo respetamos: solo loggeamos.
      // Esto evita machacar una entrada real con una falta artificial.
      if (existing.status !== 'absent') {
        // Resolvemos la incidencia con nota explicativa pero NO tocamos el shift real.
      } else {
        const { error } = await supabase.from('shifts').update({
          status: 'absent', classification, incidents,
        }).eq('id', existing.id).eq('tenant_id', profile?.tenant_id)
        if (error) throw error
      }
    } else {
      const { error } = await supabase.from('shifts').insert({
        tenant_id: detail.tenant_id, employee_id: detail.employee_id,
        date_str: today, entry_time: null, exit_time: null,
        duration_hours: 0, status: 'absent',
        classification, incidents, corrections: [],
      })
      if (error) throw error
    }

    const { error: incErr } = await supabase.from('incidencias').update({
      status: 'resolved', resolution: fullNote,
      resolved_by: profile?.id || null, resolved_by_name: profile?.name || null,
      resolved_at: new Date().toISOString(),
    }).eq('id', detail.id).eq('tenant_id', profile?.tenant_id)
    if (incErr) throw incErr

    await supabase.from('audit_log').insert({
      tenant_id: detail.tenant_id, action: 'RETARDOS_THRESHOLD_TO_FALTA',
      employee_id: detail.employee_id, employee_name: detail.employee_name,
      detail: `${fullNote} · ${today}`, success: true,
    })
  }

  async function resolveAbandonoManual(supabase, fullNote) {
    // Actualizar shift con la hora manual de salida
    if (detail.shift_id) {
      const { data: shift } = await supabase.from('shifts').select('corrections').eq('id', detail.shift_id).eq('tenant_id', profile?.tenant_id).maybeSingle()
      const exitISO = fromZonedTime(`${detail.date_str}T${manualTime}:00`, 'America/Mexico_City').toISOString() // FIX: interpretar hora manual en Mexico_City, no en TZ del navegador.
      const { error } = await supabase.from('shifts').update({
        exit_time: exitISO, status: 'closed',
        corrections: { ...(shift?.corrections || {}), manualExit: true, exitRegisteredBy: profile?.name || 'manager' }, // FIX: no borrar correcciones existentes del turno.
      }).eq('id', detail.shift_id).eq('tenant_id', profile?.tenant_id) // FIX: no cerrar shifts de otro tenant.
      if (error) throw error
    }
    await resolveGenericOpt(supabase, fullNote)
  }

  async function resolveAbandonoScheduled(supabase, fullNote) {
    if (!detail.shift_id) { await resolveGenericOpt(supabase, fullNote); return }
    const [{ data: shift, error: shErr }, { data: emp, error: empErr }, { data: tenant }] = await Promise.all([
      supabase.from('shifts').select('id, employee_id, date_str, corrections').eq('id', detail.shift_id).eq('tenant_id', profile?.tenant_id).maybeSingle(),
      supabase.from('employees').select('id, schedule, is_mixed').eq('id', detail.employee_id).eq('tenant_id', profile?.tenant_id).maybeSingle(),
      supabase.from('tenants').select('config').eq('id', profile?.tenant_id).maybeSingle(),
    ])
    if (shErr) throw shErr
    if (empErr) throw empErr
    if (!shift || !emp) throw new Error('No se pudo calcular la salida programada')
    const tz = tenant?.config?.timezone || 'America/Mexico_City'
    const plan = emp.is_mixed ? shift.corrections?.mixedPlanAtEntry || null : null
    const exit = scheduledExitDate(shift.date_str, emp, tz, plan)
    if (!exit) throw new Error('No hay horario programado para registrar la salida')
    const { error } = await supabase.from('shifts').update({
      exit_time: exit.toISOString(), status: 'closed',
      corrections: { ...(shift.corrections || {}), scheduledExitResolved: true, exitRegisteredBy: profile?.name || 'manager' },
    }).eq('id', shift.id).eq('tenant_id', profile?.tenant_id) // FIX: opcion "salio en hora" debe cerrar el shift esperado dentro del tenant.
    if (error) throw error
    await resolveGenericOpt(supabase, fullNote)
  }

  async function resolveFraudeGps(supabase, fullNote) {
    const { error: updErr } = await supabase.from('incidencias').update({
      status: 'resolved', resolution: fullNote,
      resolved_by: profile?.id || null, resolved_by_name: profile?.name || null,
      resolved_at: new Date().toISOString(),
    }).eq('id', detail.id).eq('tenant_id', profile?.tenant_id) // FIX: resolver solo incidencias del tenant actual.
    if (updErr) throw updErr
    // Registrar falta grave
    const { error: insErr } = await supabase.from('incidencias').insert({
      tenant_id: detail.tenant_id, branch_id: detail.branch_id || null,
      employee_id: detail.employee_id, employee_name: detail.employee_name,
      date_str: detail.date_str, kind: 'falta',
      description: `Falta grave: intento de fraude GPS confirmado. ${fullNote}`,
      status: 'open',
    })
    if (insErr) throw insErr
  }

  async function resolveFraudeDevice(supabase, fullNote) {
    await resolveGenericOpt(supabase, fullNote)
  }

  async function resolveGenericOpt(supabase, fullNote) {
    const { error } = await supabase.from('incidencias').update({
      status: 'resolved', resolution: fullNote,
      resolved_by: profile?.id || null, resolved_by_name: profile?.name || null,
      resolved_at: new Date().toISOString(),
    }).eq('id', detail.id).eq('tenant_id', profile?.tenant_id) // FIX: resolver solo incidencias del tenant actual.
    if (error) throw error
  }

  async function createIncidencia() {
    if (!newForm.employee_id || !newForm.date_str || !newForm.kind) {
      toast.error('Empleado, fecha y tipo son obligatorios')
      return
    }
    const emp = employees.find(e => e.id === newForm.employee_id)
    const supabase = createClient()
    const { error } = await supabase.from('incidencias').insert({
      tenant_id: profile.tenant_id,
      branch_id: emp?.branch_id || null,
      employee_id: emp?.id || null,
      employee_name: emp?.name || 'Sin empleado',
      date_str: newForm.date_str,
      kind: newForm.kind,
      description: newForm.description || null,
      status: 'open',
    })
    if (error) { toast.error(`Error: ${error.message}`); return }
    toast.success('Incidencia creada')
    setShowNew(false)
    setNewForm({ employee_id: '', date_str: '', kind: 'falta', description: '' })
    load()
  }

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando incidencias...</div>

  const openCount = incidencias.filter(i => i.status === 'open').length
  const isManagerBranch = profile?.role === 'manager' && !!profile?.branch_id
  const opts = detail ? RESOLUTION_OPTIONS[detail.kind] : null
  const filteredIncidencias = empFilter
    ? incidencias.filter(inc => inc.employee_id === empFilter)
    : incidencias
  const filteredEmployeeName =
    filteredIncidencias[0]?.employee_name ||
    employees.find(e => e.id === empFilter)?.name ||
    'Empleado'

  return (
    <div className="p-5 md:p-6 max-w-5xl mx-auto">
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-5 gap-3">
        <div>
          <h1 className="page-title">Incidencias</h1>
          <p className="text-gray-400 text-xs font-mono mt-0.5 flex items-center gap-1.5">
            {openCount > 0 ? (
              <span className="text-red-400 inline-flex items-center gap-1.5">
                <Lock size={12} /> {openCount} abierta{openCount !== 1 ? 's' : ''} · bloquean el corte
              </span>
            ) : (
              <span className="text-brand-400 inline-flex items-center gap-1.5">
                <CheckCircle2 size={12} /> Sin incidencias pendientes
              </span>
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={detectNow}
            disabled={detecting}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-400/10 border border-brand-400/40 text-brand-400 font-semibold rounded-lg text-xs active:brightness-90 disabled:opacity-50 hover:bg-brand-400/20 transition-colors"
          >
            <RefreshCw size={13} className={detecting ? 'animate-spin' : ''} />
            {detecting ? 'Detectando...' : 'Detectar ahora'}
          </button>
          <button
            onClick={() => setShowNew(true)}
            className="inline-flex items-center gap-1.5 px-3 py-2 bg-brand-400 text-black font-bold rounded-lg text-xs active:brightness-90"
          >
            <Plus size={14} /> Nueva
          </button>
        </div>
      </div>

      <div className="flex gap-1.5 mb-4 flex-wrap">
        {[
          { k: 'open', label: `Abiertas (${openCount})` },
          { k: 'resolved', label: 'Resueltas' },
          { k: 'all', label: 'Todas' },
        ].map(t => (
          <button key={t.k} onClick={() => setFilter(t.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors ${
              filter === t.k
                ? 'bg-brand-400 text-black'
                : 'bg-dark-700 border border-dark-border text-gray-400 hover:text-white'
            }`}>{t.label}</button>
        ))}
      </div>

      {branches.length > 0 && !isManagerBranch && (
        <div className="mb-4">
          {/* FIX: unificar selector de sucursal en dashboard. */}
          <BranchFilter branches={branches} value={selectedBranchId} onChange={setSelectedBranchId} />
        </div>
      )}

      {empFilter && (
        <div className="mb-4 inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-dark-700 border border-dark-border text-xs text-gray-200">
          <span>Filtrando: {filteredEmployeeName}</span>
          <button
            onClick={() => setEmpFilter('')}
            className="text-gray-400 hover:text-white"
            aria-label="Limpiar filtro de empleado"
          >
            <X size={13} />
          </button>
        </div>
      )}

      {filteredIncidencias.length === 0 ? (
        <div className="card text-center py-10">
          <div className="flex justify-center mb-3 text-gray-400">
            {filter === 'open' ? <CheckCircle2 size={40} /> : <Inbox size={40} />}
          </div>
          <p className="text-gray-200 text-sm font-semibold">
            {filter === 'open' ? 'Ninguna incidencia abierta' : 'Sin incidencias'}
          </p>
          <p className="text-gray-400 text-xs mt-2">
            Usa "Detectar ahora" para revisar el día de hoy, o crea una manualmente.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filteredIncidencias.map(inc => (
            <div key={inc.id} className="card p-3 flex items-start gap-3 flex-wrap">
              <div className="flex-1 min-w-[200px]">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${KIND_COLOR[inc.kind] || KIND_COLOR.otro}`}>
                    {KIND_LABEL[inc.kind] || inc.kind}
                  </span>
                  <span className="text-white font-semibold text-sm">{inc.employee_name || '—'}</span>
                  <span className="text-gray-400 text-[11px] font-mono">· {inc.date_str}</span>
                </div>
                {inc.description && (
                  <p className="text-gray-300 text-xs leading-snug">{inc.description}</p>
                )}
                {inc.status !== 'open' && inc.resolution && (
                  <p className="text-gray-400 text-[11px] font-mono mt-1 inline-flex items-center gap-1">
                    <CheckCircle2 size={10} /> {inc.resolution}{inc.resolved_by_name ? ` · ${inc.resolved_by_name}` : ''}
                  </p>
                )}
              </div>
              {inc.status === 'open' && (
                <button onClick={() => openDetail(inc)}
                  className="px-3 py-1.5 bg-brand-400 text-black font-bold rounded-lg text-xs active:brightness-90">
                  Gestionar
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Modal de resolución */}
      {detail && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
          <div className="bg-dark-800 border border-dark-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
               style={{ maxHeight: '90dvh' }}>
            <div className="px-5 pt-4 pb-2 flex items-start justify-between shrink-0">
              <div>
                <h2 className="text-lg font-bold text-white">{KIND_LABEL[detail.kind] || detail.kind}</h2>
                <p className="text-gray-400 text-xs font-mono mt-0.5">
                  {detail.employee_name || '—'} · {detail.date_str}
                </p>
              </div>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-white hover:bg-white/10 rounded-md p-1 -mt-1 -mr-1 transition-colors">
                <X size={18} />
              </button>
            </div>

            <div className="px-5 pb-4 min-h-0 overflow-y-auto overscroll-contain flex-1" style={{ touchAction: 'pan-y' }}>
              {detail.description && (
                <div className="text-gray-300 text-sm mb-3 bg-dark-700 p-3 rounded-lg">
                  {/* Enlace a Google Maps si viene en la descripción */}
                  {detail.description.split(/(https:\/\/www\.google\.com\/maps\?q=[\d.,]+)/).map((part, i) =>
                    part.startsWith('https://') ? (
                      <a key={i} href={part} target="_blank" rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-brand-400 underline">
                        <MapPin size={12} /> Ver en mapa
                      </a>
                    ) : <span key={i}>{part}</span>
                  )}
                </div>
              )}

              {/* Opciones específicas por tipo */}
              {opts && (
                <>
                  <p className="label mb-2">Resolución</p>
                  <div className="space-y-2 mb-3">
                    {opts.map(opt => (
                      <label key={opt.value}
                        className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition-colors
                          ${selectedOption === opt.value ? OPTION_BORDER[opt.color] : 'bg-dark-700 border-dark-border'}`}>
                        <input type="radio" name="resolution" value={opt.value}
                          checked={selectedOption === opt.value}
                          onChange={() => setSelectedOption(opt.value)}
                          className="mt-0.5 shrink-0" />
                        <div>
                          <p className="text-sm text-white font-semibold">{opt.label}</p>
                          <p className="text-xs text-gray-400 mt-0.5">{opt.desc}</p>
                        </div>
                      </label>
                    ))}
                  </div>
                </>
              )}

              {/* Campo de hora manual para abandono */}
              {detail.kind === 'abandono' && selectedOption === 'registrar_manual' && (
                <div className="mb-3">
                  <label className="label">Hora de salida real</label>
                  <input type="time" className="input text-sm"
                    value={manualTime}
                    onChange={e => setManualTime(e.target.value)} />
                </div>
              )}

              {/* Alerta graves */}
              {(selectedOption === 'falta_injustificada' || selectedOption === 'falta_grave' ||
                selectedOption === 'intento_fraude' || selectedOption === 'fraude_confirmado') && (
                <div className="mb-3 p-3 bg-red-500/10 border border-red-500/20 rounded-xl inline-flex items-start gap-2 w-full">
                  <AlertCircle className="text-red-400 shrink-0 mt-0.5" size={14} />
                  <div>
                    <p className="text-red-400 text-xs font-bold">Falta grave</p>
                    <p className="text-red-400/70 text-xs mt-0.5">
                      {detail.kind === 'falta'
                        ? 'A las 3 faltas injustificadas acumuladas se genera alerta causal Art. 47 LFT.'
                        : 'Se registra en el historial disciplinario del empleado.'}
                    </p>
                  </div>
                </div>
              )}

              <div className="mb-3">
                <label className="label">Nota {opts ? '(opcional)' : '(obligatoria)'}</label>
                <textarea className="input text-sm min-h-[60px]"
                  placeholder={opts ? 'Agrega contexto si es necesario...' : 'Describe la resolución'}
                  value={resolutionText}
                  onChange={e => setResolutionText(e.target.value)} />
              </div>
            </div>

            <div className="px-5 pb-5 pt-2 border-t border-dark-border shrink-0 flex gap-2">
              <button onClick={resolveIncidencia}
                disabled={resolvingId === detail.id}
                className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90 disabled:opacity-50">
                {resolvingId === detail.id ? 'Guardando...' : 'Confirmar'}
              </button>
              <button onClick={() => setDetail(null)}
                className="px-3 py-2.5 bg-dark-700 border border-dark-border rounded-lg text-gray-300 text-sm">
                Cancelar
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal nueva incidencia */}
      {showNew && (
        <div className="fixed inset-0 bg-black/75 backdrop-blur-sm flex items-end sm:items-center justify-center z-[60] p-0 sm:p-4">
          <div className="bg-dark-800 border border-dark-border w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl flex flex-col overflow-hidden"
               style={{ maxHeight: '90dvh' }}>
            <div className="px-5 pt-4 pb-2 flex items-start justify-between shrink-0">
              <h2 className="text-lg font-bold text-white">Nueva incidencia</h2>
              <button onClick={() => setShowNew(false)} className="text-gray-400 hover:text-white hover:bg-white/10 rounded-md p-1 -mt-1 -mr-1 transition-colors">
                <X size={18} />
              </button>
            </div>
            <div className="px-5 pb-4 min-h-0 overflow-y-auto overscroll-contain flex-1 space-y-3" style={{ touchAction: 'pan-y' }}>
              <div>
                <label className="label">Empleado</label>
                <select className="input text-sm"
                  value={newForm.employee_id}
                  onChange={e => setNewForm(f => ({ ...f, employee_id: e.target.value }))}>
                  <option value="">— Seleccionar —</option>
                  {employees.map(e => (
                    <option key={e.id} value={e.id}>{e.name} · {e.employee_code}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Fecha</label>
                <input type="date" className="input text-sm"
                  value={newForm.date_str}
                  onChange={e => setNewForm(f => ({ ...f, date_str: e.target.value }))} />
              </div>
              <div>
                <label className="label">Tipo</label>
                <select className="input text-sm"
                  value={newForm.kind}
                  onChange={e => setNewForm(f => ({ ...f, kind: e.target.value }))}>
                  <option value="falta">Falta</option>
                  <option value="retardo_justificado">Retardo justificado</option>
                  <option value="permiso">Permiso</option>
                  <option value="otro">Otro</option>
                </select>
              </div>
              <div>
                <label className="label">Descripción</label>
                <textarea className="input text-sm min-h-[60px]"
                  placeholder="Detalle breve"
                  value={newForm.description}
                  onChange={e => setNewForm(f => ({ ...f, description: e.target.value }))} />
              </div>
            </div>
            <div className="px-5 pb-5 pt-2 border-t border-dark-border shrink-0 flex gap-2">
              <button onClick={createIncidencia}
                className="flex-1 px-3 py-2.5 bg-brand-400 text-black font-bold rounded-lg text-sm active:brightness-90">
                Guardar
              </button>
              <button onClick={() => setShowNew(false)}
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
