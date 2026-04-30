// src/app/api/check/punch/route.js
// feat/mixed-schedule — soporte para empleados mixtos:
//   - Al entrar, si emp.is_mixed === true, se busca el shift_plan del dia
//     y se clasifica la entrada con classifyEntryMixed (contra plan.entry_time_str).
//   - Si no hay plan para ese dia, se crea el shift con classification
//     { type: 'no_planificado' } para que el gerente lo vea marcado.
//   - En la salida, scheduledExitDate usa plan.entry_time_str + plan.duration_hours
//     para calcular HE y duracion esperada.
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { classifyEntry, classifyEntryMixed, classifyEntryFree, isoDate, diffHrs, calcOvertimeHours, scheduledExitDate, haversineMeters, todayISOMX } from '@/lib/utils'
import { rateLimit } from '@/lib/rate-limit'
import crypto from 'crypto'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

const TTL_MS = 4 * 60 * 60 * 1000

function secret() {
  const s = process.env.KIOSK_SESSION_SECRET
  if (!s) throw new Error('KIOSK_SESSION_SECRET no configurado')
  return s
}

function verifyToken(token) {
  try {
    const data = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { sig, ...payload } = data
    const expected = crypto.createHmac('sha256', secret()).update(JSON.stringify(payload)).digest('hex')
    const a = Buffer.from(String(sig || ''))
    const b = Buffer.from(expected)
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null // FIX: comparar firma en tiempo constante.
    if (Date.now() - payload.ts > TTL_MS) return null
    return payload
  } catch { return null }
}

const CODE_RE = /^[A-Z0-9]{1,20}$/
const PIN_RE = /^\d{4,8}$/
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

async function insertIncidenciaOnce(supabase, payload) {
  const { data: existing, error: existingErr } = await supabase
    .from('incidencias')
    .select('id')
    .eq('tenant_id', payload.tenant_id)
    .eq('employee_id', payload.employee_id)
    .eq('date_str', payload.date_str)
    .eq('kind', payload.kind)
    .limit(1) // FIX: dedupe no debe fallar si ya existen duplicados historicos.
    .maybeSingle()

  if (existingErr) {
    console.warn('[check/punch] incidencia dedupe error:', existingErr.message)
    return
  }
  if (existing?.id) return

  const { error } = await supabase.from('incidencias').insert(payload)
  if (error) console.warn('[check/punch] incidencia insert error:', error.message)
}

function minutesFromLabel(label) {
  const match = String(label || '').match(/(\d+)\s*min/i)
  return match ? Number(match[1]) : null
}

export async function POST(req) {
  try {
    const body = await req.json()
    const { employeeCode, pin, action, coveringEmployeeId, geo, sessionToken, deviceId } = body
    const supabase = createServiceClient()
    const currentIp = getClientIp(req)
    const sess = verifyToken(sessionToken)
    if (!sess?.tenantId || (sess.deviceId && deviceId && sess.deviceId !== deviceId)) {
      return NextResponse.json({ ok: false, msg: 'Sesion invalida. Escanea de nuevo el QR.' }, { status: 401 })
    }
    const tenantId = sess.tenantId // FIX: tenant isolation desde sesion firmada, no desde body.

    if (!tenantId || !employeeCode || !pin || !['in', 'out'].includes(action)) {
      return NextResponse.json({ ok: false, msg: 'Datos incompletos.' }, { status: 400 })
    }
    if (!UUID_RE.test(String(tenantId))) return NextResponse.json({ ok: false, msg: 'Tenant invalido.' }, { status: 400 }) // FIX: validar tenantId antes de usarlo en RPC/query.
    if (coveringEmployeeId && !UUID_RE.test(String(coveringEmployeeId))) return NextResponse.json({ ok: false, msg: 'Cobertura invalida.' }, { status: 400 }) // FIX: validar UUID de cobertura.
    const code = String(employeeCode).toUpperCase()
    if (!CODE_RE.test(code)) return NextResponse.json({ ok: false, msg: 'Código inválido.' }, { status: 400 })
    if (!PIN_RE.test(String(pin))) return NextResponse.json({ ok: false, msg: 'PIN inválido.' }, { status: 400 })

    // Rate limiting: 5 intentos / 15 min por (tenant, IP, code)
    const rlKey = `punch:${tenantId}:${currentIp}:${code}`
    const rl = rateLimit(rlKey, 5, 15 * 60_000)
    if (!rl.ok) {
      return NextResponse.json(
        { ok: false, msg: `Demasiados intentos. Espera ${Math.ceil(rl.retryAfter/60)} minuto(s).` },
        { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } }
      )
    }

    // FIX: session token obligatorio; branch_id viene del token firmado.
    let sessionDeviceId = sess.deviceId || null, branchId = sess.branchId || null, sessionValid = true

    // Validar PIN (usa RPC con crypt())
    const { data: authResult } = await supabase.rpc('validate_employee_pin', {
      p_tenant_id: tenantId, p_code: code, p_pin: String(pin)
    })

    if (!authResult?.valid) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'PIN_REJECTED',
        employee_name: code, detail: `PIN incorrecto · IP ${currentIp}`, success: false
      })
      return NextResponse.json({ ok: false, msg: 'Credenciales incorrectas.' })
    }
    const emp = authResult.employee

    // Cargar config del tenant
    const { data: tenant } = await supabase.from('tenants').select('config').eq('id', tenantId).single()
    let cfg = tenant?.config || {}
    if (branchId) {
      const { data: branchCfg } = await supabase
        .from('branches')
        .select('config')
        .eq('tenant_id', tenantId)
        .eq('id', branchId)
        .maybeSingle()
      cfg = { ...cfg, ...(branchCfg?.config || {}) } // FIX: umbral falta configurable
    }
    const tz = cfg.timezone || 'America/Mexico_City'
    const now = new Date().toISOString()
    const dateStr = isoDate(now, tz)

    // R7: cumpleanios. La RPC validate_employee_pin no expone birth_date (PII),
    // asi que lo leemos aqui post-PIN por emp.id. Solo exponemos un booleano
    // `birthday` al cliente — NUNCA la fecha completa.
    let isBirthdayToday = false
    try {
      const { data: empRow } = await supabase
        .from('employees')
        .select('birth_date')
        .eq('tenant_id', tenantId)
        .eq('id', emp.id)
        .maybeSingle()
      if (empRow?.birth_date) {
        // Fecha "hoy" en TZ MX
        const nowInTz = new Date(new Date().toLocaleString('en-US', { timeZone: tz }))
        const s = String(empRow.birth_date).slice(0, 10).split('-')
        if (s.length === 3) {
          const bdMonth = parseInt(s[1], 10) - 1
          const bdDay = parseInt(s[2], 10)
          if (
            Number.isFinite(bdMonth) && Number.isFinite(bdDay) &&
            nowInTz.getMonth() === bdMonth && nowInTz.getDate() === bdDay
          ) {
            isBirthdayToday = true
          }
        }
      }
    } catch { /* no-op: flag por defecto false */ }

    // Validar GPS server-side — NO confiar en el cliente
    const locCfg = cfg.location
    let geoValid = true
    let dist = null
    let outOfRange = false
    const lat = Number(geo?.lat)
    const lng = Number(geo?.lng)
    const accuracy = Number(geo?.accuracy)
    // FIX UX: accuracy <=100m era muy estricto y rechazaba celulares legitimos en
    // interiores con peor GPS. La defensa real es dist <= radius; subimos a 200m
    // que es el umbral practico de mobile GPS (urbano + interior leve).
    if (locCfg?.lat != null && locCfg?.lng != null && Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(accuracy) && accuracy <= 200) {
      dist = haversineMeters(lat, lng, locCfg.lat, locCfg.lng)
      const radius = locCfg.radius || 300
      geoValid = dist <= radius
    } else {
      geoValid = false
    }

    if (!geoValid) {
      outOfRange = true
      const hasGeo = Number.isFinite(lat) && Number.isFinite(lng)
      const mapsLink = hasGeo ? ` https://www.google.com/maps?q=${lat},${lng}` : '' // FIX: no interpolar coordenadas sin validar.
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: action === 'in' ? 'CHK_IN_REJ' : 'CHK_OUT_REJ',
        employee_id: emp.id, employee_name: emp.name,
        detail: `Fuera de area${dist != null ? ` (${Math.round(dist)}m)` : ' - sin GPS'}`, success: false
      })
      await insertIncidenciaOnce(supabase, {
        tenant_id: tenantId,
        branch_id: branchId || null,
        employee_id: emp.id,
        employee_name: emp.name,
        date_str: dateStr,
        kind: 'fuera_de_rango',
        description: `Marcaje fuera de rango GPS${dist != null ? ` (${Math.round(dist)}m)` : ' (sin GPS)'}.${mapsLink}`,
        status: 'open',
      })
      // FIX: block punch when outside geofence, incident already recorded above
      return NextResponse.json(
        { ok: false, error: 'Fuera del area de trabajo. Se registro un aviso para el administrador.' },
        { status: 422 }
      )
    }

    const branch = branchId ? (cfg.branches || []).find(b => b.id === branchId) : null
    const branchIp = cfg.ip || branch?.ip || null
    const ipMatchesBranch = branchIp ? (currentIp === branchIp) : true
    const coveragePayMode = cfg.coveragePayMode || branch?.coveragePayMode || 'covered'
    const prepCloseMinutes = cfg.prepCloseMinutes ?? branch?.prepCloseMinutes ?? 30 // FIX: tiempo de preparacion de cierre configurable.

    const safeGeo = { lat: Number.isFinite(lat) ? lat : null, lng: Number.isFinite(lng) ? lng : null, dist, accuracy: Number.isFinite(accuracy) ? accuracy : null, verified: geoValid, outOfRange }

    // Plan del dia para mixtos — se busca una sola vez, usado en entrada y salida.
    let mixedPlan = null
    if (emp.is_mixed) {
      const { data: planRow } = await supabase
        .from('shift_plans')
        .select('employee_id, date_str, entry_time_str, duration_hours, exit_time_str')
        .eq('tenant_id', tenantId)
        .eq('employee_id', emp.id)
        .eq('date_str', dateStr)
        .maybeSingle()
      mixedPlan = planRow || null
    }

    if (action === 'in') {
      // BUG 5: revalidar vacaciones server-side. El bloqueo de cliente puede ser
      // saltado via DevTools/fetch directo. Si hay un periodo active que cubre HOY
      // (MX TZ), rechazar la entrada. El cliente ya sabe reaccionar al codigo
      // 'on_vacation' mostrando el modal de reincorporacion temprana.
      const todayMX = todayISOMX(tz)
      const { data: activeVac } = await supabase
        .from('vacation_periods')
        .select('id, start_date, end_date, entitled_days, tipo, status')
        .eq('tenant_id', tenantId)
        .eq('employee_id', emp.id)
        .eq('status', 'active')
        .lte('start_date', todayMX)
        .gte('end_date', todayMX)
        .maybeSingle()
      if (activeVac) {
        await supabase.from('audit_log').insert({
          tenant_id: tenantId,
          action: 'CHK_IN_REJ_VAC',
          employee_id: emp.id,
          employee_name: emp.name,
          detail: `Intento de entrada durante vacaciones (periodo ${activeVac.id}, ${activeVac.start_date} -> ${activeVac.end_date})`,
          success: false,
        })
        return NextResponse.json(
          {
            ok: false,
            error: 'on_vacation',
            msg: 'Estas en periodo de vacaciones. Si te reincorporas temprano, usa el modal del checador.',
            period: {
              id: activeVac.id,
              start_date: activeVac.start_date,
              end_date: activeVac.end_date,
              entitled_days: activeVac.entitled_days,
              tipo: activeVac.tipo,
            },
          },
          { status: 409 }
        )
      }

      // Clasificacion: libre > mixto > fijo.
      // free_schedule: gerentes con horario libre siempre "libre" (tracking only).
      let classification
      if (emp.free_schedule) {
        classification = classifyEntryFree()
      } else if (emp.is_mixed) {
        classification = classifyEntryMixed(mixedPlan, now, cfg.toleranceMinutes || 10, tz)
      } else {
        classification = classifyEntry(emp.schedule || {}, now, cfg.toleranceMinutes || 10, cfg.absenceMinutes || 60, tz) // FIX: umbral falta configurable
      }

      const holidays = cfg.holidays || []
      const holiday = holidays.find(h => h.date === dateStr)
      let coverName = null
      if (coveringEmployeeId) {
        const { data: coverEmp } = await supabase
          .from('employees')
          .select('id, name')
          .eq('tenant_id', tenantId)
          .eq('id', coveringEmployeeId)
          .eq('status', 'active')
          .maybeSingle()
        if (!coverEmp) return NextResponse.json({ ok: false, msg: 'Empleado cubierto invalido.' }, { status: 400 }) // FIX: impedir cobertura con empleado de otro tenant/inactivo.
        coverName = coverEmp.name
      }

      const deviceMismatchOnEntry = sessionDeviceId && deviceId && sessionDeviceId !== deviceId

      const { data: existingOpen } = await supabase
        .from('shifts')
        .select('id')
        .eq('employee_id', emp.id)
        .eq('tenant_id', tenantId)
        .eq('date_str', dateStr)
        .eq('status', 'open')
        .maybeSingle()

      if (existingOpen) {
        return NextResponse.json(
          { ok: false, error: 'Ya tienes una entrada activa para hoy.' },
          { status: 409 }
        )
      }

      const { data: insertedShift, error } = await supabase.from('shifts').insert({
        tenant_id: tenantId, employee_id: emp.id, date_str: dateStr, entry_time: now,
        status: 'open', classification, is_holiday: !!holiday, holiday_name: holiday?.name || null,
        covering_employee_id: coveringEmployeeId || null, geo_entry: safeGeo, incidents: [],
        corrections: {
          entryIp: currentIp, sessionValid, branchId: branchId || null, ipMatchesBranch,
          entryDeviceId: deviceId || null, sessionDeviceId: sessionDeviceId || null,
          deviceMismatchOnEntry, coveragePayMode,
          // Mixto: guardamos el plan usado para que payroll/attendance tengan
          // una referencia estable aunque el plan se modifique despues.
          mixedPlanAtEntry: emp.is_mixed ? (mixedPlan ? {
            entry_time_str: mixedPlan.entry_time_str,
            duration_hours: Number(mixedPlan.duration_hours),
            exit_time_str: mixedPlan.exit_time_str,
          } : null) : undefined,
        },
      }).select('id').single()

      if (error) {
        if (error.code === '23505') {
          return NextResponse.json({ ok: false, msg: 'Ya tienes una jornada abierta. Registra tu salida primero.' })
        }
        throw error
      }

      if (classification.type === 'retardo') {
        const minutes = minutesFromLabel(classification.label)
        await insertIncidenciaOnce(supabase, {
          tenant_id: tenantId,
          branch_id: branchId || null,
          employee_id: emp.id,
          employee_name: emp.name,
          shift_id: insertedShift?.id || null,
          date_str: dateStr,
          kind: 'retardo',
          description: minutes != null ? `Retardo de ${minutes} minutos.` : classification.label,
          status: 'open',
        })
      }

      if (classification.type === 'falta') { // FIX: umbral falta configurable
        const minutes = minutesFromLabel(classification.label)
        await insertIncidenciaOnce(supabase, {
          tenant_id: tenantId,
          branch_id: branchId || null,
          employee_id: emp.id,
          employee_name: emp.name,
          shift_id: insertedShift?.id || null,
          date_str: dateStr,
          kind: 'falta',
          description: minutes != null ? `Entrada reclasificada como falta por ${minutes} minutos tarde.` : classification.label,
          status: 'open',
        })
      }

      if (classification.type === 'no_planificado') {
        await insertIncidenciaOnce(supabase, {
          tenant_id: tenantId,
          branch_id: branchId || null,
          employee_id: emp.id,
          employee_name: emp.name,
          shift_id: insertedShift?.id || null,
          date_str: dateStr,
          kind: 'no_planificado',
          description: 'Empleado checo entrada sin plan asignado para este dia.',
          status: 'open',
        })
      }

      if (coveringEmployeeId) {
        await insertIncidenciaOnce(supabase, {
          tenant_id: tenantId,
          branch_id: branchId || null,
          employee_id: emp.id,
          employee_name: emp.name,
          shift_id: insertedShift?.id || null,
          date_str: dateStr,
          kind: 'cobertura',
          description: `Cubrio a ${coverName || 'empleado asignado'}`,
          status: 'open',
        })
        await insertIncidenciaOnce(supabase, {
          tenant_id: tenantId,
          branch_id: branchId || null,
          employee_id: coveringEmployeeId,
          employee_name: coverName || 'Empleado cubierto',
          date_str: dateStr,
          kind: 'falta',
          description: `No se presento - cubierto por ${emp.name}`,
          status: 'open',
        })
      }

      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'CHK_IN',
        employee_id: emp.id, employee_name: emp.name,
        detail: `${classification.label}${coverName ? ' · Cubriendo: ' + coverName : ''}${holiday ? ' 🎉 FERIADO' : ''}${emp.is_mixed && !mixedPlan ? ' ⚠ Sin plan' : ''} · IP ${currentIp}${deviceMismatchOnEntry ? ' ⚠ Dispositivo diferente' : ''}`,
        success: true
      })

      return NextResponse.json({
        ok: true,
        msg: `Entrada registrada. ${classification.label}${coverName ? ' · Cubriendo a ' + coverName : ''}${holiday ? ' — Pago ×3 🎉' : ''}.`,
        employee: { id: emp.id, name: emp.name, can_manage: emp.can_manage, department: emp.department, role_label: emp.role_label }, // FIX: PII solo post-PIN.
        entry_time: now,
        ipMatchesBranch,
        birthday: isBirthdayToday, // R7
        mixedNoPlan: emp.is_mixed && !mixedPlan, // aviso al cliente
      })
    }

    // ── action === 'out' ──
    const { data: openShift } = await supabase.from('shifts')
      .select('id,entry_time,date_str,corrections,incidents').eq('tenant_id', tenantId)
      .eq('employee_id', emp.id).eq('status', 'open').single()

    if (!openShift) {
      return NextResponse.json({ ok: false, msg: 'No tienes entrada registrada. Contacta a tu supervisor.' })
    }

    const entryDeviceId = openShift.corrections?.entryDeviceId || null
    const deviceMismatch = entryDeviceId && deviceId && entryDeviceId !== deviceId
    const entryIp = openShift.corrections?.entryIp || null

    const duration = parseFloat(diffHrs(openShift.entry_time, now).toFixed(2))
    if (duration <= 0) {
      return NextResponse.json({ ok: false, msg: 'Duración inválida. Contacta a tu supervisor.' })
    }

    // HE: mixtos usan el plan de hoy (o el snapshot del shift) para saber
    // cual es la "hora esperada de salida". Si no habia plan, no se calcula HE
    // por reloj — solo se marca como no_planificado y se revisa en manager.
    let overtimeHours = 0, overtimeMinutes = 0
    // free_schedule: nómina íntegra, no se calcula HE contra un horario inexistente.
    if (!emp.free_schedule) {
      const planForExit = emp.is_mixed
        ? (mixedPlan || openShift.corrections?.mixedPlanAtEntry || null)
        : null
      const scheduledExit = scheduledExitDate(openShift.date_str, emp, tz, planForExit)
      if (scheduledExit) {
        const minutesOver = Math.round((new Date(now) - scheduledExit) / 60000)
        if (minutesOver > 0) {
          overtimeMinutes = minutesOver
          overtimeHours = calcOvertimeHours(minutesOver, prepCloseMinutes)
        }
      }
    }

    const exitIpMismatch = entryIp && currentIp !== entryIp && !ipMatchesBranch
    const isIncident = deviceMismatch || exitIpMismatch
    const newStatus = isIncident ? 'incident' : 'closed'

    const prevIncidents = Array.isArray(openShift.incidents) ? openShift.incidents : []
    const newIncidents = []
    if (deviceMismatch) newIncidents.push({
      type: 'device_mismatch',
      note: `Salida desde dispositivo diferente (entrada: ${entryDeviceId}, actual: ${deviceId})`,
      detectedAt: now
    })
    if (exitIpMismatch) newIncidents.push({
      type: 'ip_mismatch',
      note: `Red diferente (entrada: ${entryIp}, salida: ${currentIp})`,
      detectedAt: now
    })

    const overtimeCorrections = overtimeHours > 0
      ? { overtime: { hours: overtimeHours, minutes: overtimeMinutes, calculatedAt: now } } : {}

    // FIX: antes se swallowed el error — si la update fallaba, el empleado
    // recibia "salida registrada" pero el shift seguia open y podia re-checar.
    const { error: outErr } = await supabase.from('shifts').update({
      exit_time: now, duration_hours: duration, status: newStatus, geo_exit: safeGeo,
      incidents: [...prevIncidents, ...newIncidents],
      corrections: { ...(openShift.corrections || {}), exitIp: currentIp, ...overtimeCorrections },
    }).eq('id', openShift.id)
    if (outErr) {
      console.error('[check/punch] exit update error:', outErr)
      return NextResponse.json({ error: 'No se pudo registrar la salida' }, { status: 500 })
    }

    if (overtimeHours > 0) {
      await insertIncidenciaOnce(supabase, {
        tenant_id: tenantId,
        branch_id: branchId || null,
        employee_id: emp.id,
        employee_name: emp.name,
        shift_id: openShift.id,
        date_str: openShift.date_str,
        kind: 'horas_extra',
        description: `Horas extra detectadas: ${Number(overtimeHours).toFixed(2)}h (${overtimeMinutes} min excedentes).`,
        status: 'open',
      })
    }

    if (deviceMismatch) {
      await insertIncidenciaOnce(supabase, {
        tenant_id: tenantId,
        branch_id: branchId || null,
        employee_id: emp.id,
        employee_name: emp.name,
        shift_id: openShift.id,
        date_str: openShift.date_str, // FIX: incidencias de salida deben quedarse en la fecha del turno abierto.
        kind: 'device_mismatch',
        description: `Salida desde dispositivo diferente (entrada: ${entryDeviceId}, salida: ${deviceId}).`,
        status: 'open',
      })

      const since = isoDate(new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString(), tz)
      const { data: otherShift } = await supabase
        .from('shifts')
        .select('employee_id')
        .eq('tenant_id', tenantId)
        .gte('date_str', since)
        .neq('employee_id', emp.id)
        .filter('corrections->>entryDeviceId', 'eq', deviceId)
        .order('date_str', { ascending: false })
        .limit(1)
        .maybeSingle()

      if (otherShift?.employee_id) {
        const { data: otherEmp } = await supabase
          .from('employees')
          .select('id, name, branch_id')
          .eq('tenant_id', tenantId)
          .eq('id', otherShift.employee_id)
          .maybeSingle()

        await insertIncidenciaOnce(supabase, {
          tenant_id: tenantId,
          branch_id: otherEmp?.branch_id || branchId || null,
          employee_id: otherShift.employee_id,
          employee_name: otherEmp?.name || 'Empleado',
          date_str: openShift.date_str, // FIX: incidencias relacionadas al mismo dispositivo usan la fecha del turno abierto.
          kind: 'device_mismatch',
          description: `Su dispositivo de entrada (${deviceId}) fue usado para la salida de ${emp.name}.`,
          status: 'open',
        })
      }
    }

    if (exitIpMismatch) {
      await insertIncidenciaOnce(supabase, {
        tenant_id: tenantId,
        branch_id: branchId || null,
        employee_id: emp.id,
        employee_name: emp.name,
        shift_id: openShift.id,
        date_str: openShift.date_str, // FIX: incidencias de salida deben quedarse en la fecha del turno abierto.
        kind: 'ip_mismatch',
        description: `Red diferente entre entrada y salida. Entrada: ${entryIp}; salida: ${currentIp}.`,
        status: 'open',
      })
    }

    await supabase.from('audit_log').insert({
      tenant_id: tenantId, action: 'CHK_OUT',
      employee_id: emp.id, employee_name: emp.name,
      detail: `Duración ${duration}h${overtimeHours > 0 ? ` · HE ${Number(overtimeHours).toFixed(2)}h` : ''} · IP ${currentIp}${isIncident ? ' ⚠ ' + newIncidents.map(i => i.type).join(',') : ''}`,
      success: true
    })

    const msg = isIncident
      ? `Salida registrada (${duration}h). ⚠ Se creó una incidencia para revisión.`
      : `Salida registrada. Jornada: ${duration} horas.${overtimeHours > 0 ? ` · ${Number(overtimeHours).toFixed(2)} HE.` : ''}`
    return NextResponse.json({ ok: true, msg, overtimeHours, incident: isIncident, birthday: isBirthdayToday, employee: { id: emp.id, name: emp.name, can_manage: emp.can_manage, department: emp.department, role_label: emp.role_label } }) // FIX: PII solo post-PIN.

  } catch (err) {
    console.error('punch/route error:', err?.message)
    return NextResponse.json({ ok: false, msg: 'Error interno del servidor.' }, { status: 500 })
  }
}
