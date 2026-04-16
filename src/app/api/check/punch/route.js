// src/app/api/check/punch/route.js
import { createServiceClient } from '@/lib/supabase'
import { NextResponse } from 'next/server'
import { classifyEntry, isoDate, diffHrs, calcOvertimeHours, scheduledExitDate } from '@/lib/utils'
import crypto from 'crypto'

function getClientIp(req) {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) return xff.split(',')[0].trim()
  return req.headers.get('x-real-ip') || req.headers.get('cf-connecting-ip') || 'unknown'
}

const TTL_MS = 12 * 60 * 60 * 1000

function verifyToken(token) {
  try {
    const secret = process.env.SUPABASE_SERVICE_ROLE_KEY || 'checkpro-fallback-secret'
    const data = JSON.parse(Buffer.from(token, 'base64url').toString())
    const { sig, ...payload } = data
    const expected = crypto.createHmac('sha256', secret)
      .update(JSON.stringify(payload))
      .digest('hex')
    if (sig !== expected) return null
    if (Date.now() - payload.ts > TTL_MS) return null // expired (12h)
    return payload
  } catch { return null }
}

export async function POST(req) {
  try {
    const { tenantId, employeeCode, pin, action, coveringEmployeeId, geo, sessionToken, deviceId } = await req.json()
    const supabase = createServiceClient()
    const currentIp = getClientIp(req)

    // 1. Verify session token (IP-bound + device-bound QR session)
    let sessionIp = null
    let sessionValid = false
    let sessionDeviceId = null
    let branchId = null
    if (sessionToken) {
      const sess = verifyToken(sessionToken)
      if (sess && sess.tenantId === tenantId) {
        sessionIp = sess.ip
        sessionDeviceId = sess.deviceId || null
        branchId = sess.branchId || null
        sessionValid = true
      }
    }

    // 2. Validate PIN
    const { data: authResult } = await supabase.rpc('validate_employee_pin', {
      p_tenant_id: tenantId,
      p_code: employeeCode.toUpperCase(),
      p_pin: pin
    })

    if (!authResult?.valid) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'PIN_REJECTED',
        employee_name: employeeCode, detail: 'PIN incorrecto', success: false
      })
      return NextResponse.json({ ok: false, msg: 'PIN incorrecto. Intento registrado.' })
    }

    const emp = authResult.employee

    // 3. Validate GPS
    if (!geo?.valid) {
      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: action === 'in' ? 'CHK_IN_REJ' : 'CHK_OUT_REJ',
        employee_id: emp.id, employee_name: emp.name,
        detail: `Fuera de área: ${geo?.dist}m`, success: false
      })
      return NextResponse.json({ ok: false, msg: `Fuera del área autorizada (${geo?.dist}m). Acércate a la sucursal.` })
    }

    // 4. Get tenant config
    const { data: tenant } = await supabase.from('tenants').select('config').eq('id', tenantId).single()
    const cfg = tenant?.config || {}

    const branch = branchId ? (cfg.branches || []).find(b => b.id === branchId) : null
    const branchIp = branch?.ip || null
    const ipMatchesBranch = branchIp ? (currentIp === branchIp) : true
    const coveragePayMode = branch?.coveragePayMode || 'covered'

    const now = new Date().toISOString()
    const dateStr = isoDate(now)

    if (action === 'in') {
      // Check no open shift exists
      const { data: existing } = await supabase.from('shifts')
        .select('id').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()
      if (existing) {
        return NextResponse.json({ ok: false, msg: 'Ya tienes una jornada abierta. Registra tu salida primero.' })
      }

      // Device binding check on entry: warn if session deviceId doesn't match submitted deviceId
      // (On entry we just record; strict block is on exit)
      const deviceMismatchOnEntry = sessionDeviceId && deviceId && sessionDeviceId !== deviceId

      const classification = classifyEntry(emp.schedule || {}, now, cfg.toleranceMinutes || 10)
      const holidays = cfg.holidays || []
      const holiday = holidays.find(h => h.date === dateStr)
      const coverName = coveringEmployeeId
        ? (await supabase.from('employees').select('name').eq('id', coveringEmployeeId).single())?.data?.name
        : null

      const { error } = await supabase.from('shifts').insert({
        tenant_id: tenantId,
        employee_id: emp.id,
        date_str: dateStr,
        entry_time: now,
        status: 'open',
        classification,
        is_holiday: !!holiday,
        holiday_name: holiday?.name || null,
        covering_employee_id: coveringEmployeeId || null,
        geo_entry: geo,
        incidents: [],
        corrections: {
          entryIp: currentIp,
          sessionValid,
          branchId: branchId || null,
          ipMatchesBranch,
          entryDeviceId: deviceId || null,
          sessionDeviceId: sessionDeviceId || null,
          deviceMismatchOnEntry,
          coveragePayMode,    // store so payroll can use it
        },
      })

      if (error) throw error

      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'CHK_IN',
        employee_id: emp.id, employee_name: emp.name,
        detail: `${classification.label}${coverName ? ' · Cubriendo: ' + coverName : ''}${holiday ? ' 🎉 FERIADO' : ''} · IP: ${currentIp}${deviceMismatchOnEntry ? ' ⚠ Dispositivo diferente al QR' : ''}`,
        success: true
      })

      return NextResponse.json({
        ok: true,
        msg: `Entrada registrada. ${classification.label}${coverName ? ' · Cubriendo a ' + coverName : ''}${holiday ? ' — Pago ×3 🎉' : ''}.`,
        ipMatchesBranch,
      })

    } else {
      // OUT
      const { data: openShift } = await supabase.from('shifts')
        .select('*').eq('tenant_id', tenantId).eq('employee_id', emp.id).eq('status', 'open').single()

      if (!openShift) {
        return NextResponse.json({ ok: false, msg: 'No tienes entrada registrada. Contacta a tu supervisor.' })
      }

      // ── Device binding check ──────────────────────────────────────────────
      const entryDeviceId = openShift.corrections?.entryDeviceId || null
      const deviceMismatch = entryDeviceId && deviceId && entryDeviceId !== deviceId

      if (deviceMismatch) {
        // Record incident but block the clock-out
        const incidentNote = `Intento de salida desde dispositivo diferente. Dispositivo entrada: ${entryDeviceId}, dispositivo actual: ${deviceId}`
        await supabase.from('shifts').update({
          incidents: [...(openShift.incidents || []), {
            type: 'device_mismatch',
            note: incidentNote,
            detectedAt: now,
          }]
        }).eq('id', openShift.id)

        await supabase.from('audit_log').insert({
          tenant_id: tenantId, action: 'CHK_OUT_REJ',
          employee_id: emp.id, employee_name: emp.name,
          detail: `⚠ Dispositivo diferente al de entrada — salida bloqueada`,
          success: false
        })

        return NextResponse.json({
          ok: false,
          msg: 'Salida bloqueada: dispositivo diferente al que registró la entrada. Contacta a tu supervisor.',
          deviceMismatch: true,
        })
      }

      // ── Duration & overtime ────────────────────────────────────────────────
      const duration = parseFloat(diffHrs(openShift.entry_time, now).toFixed(2))
      const entryIp = openShift.corrections?.entryIp || null

      // Calculate overtime
      let overtimeHours = 0
      let overtimeMinutes = 0
      const scheduledExit = scheduledExitDate(openShift.date_str, emp)
      if (scheduledExit) {
        const exitNow = new Date(now)
        const minutesOver = Math.round((exitNow - scheduledExit) / 60000)
        if (minutesOver > 0) {
          overtimeMinutes = minutesOver
          overtimeHours = calcOvertimeHours(minutesOver)
        }
      }

      // ── IP mismatch incident ───────────────────────────────────────────────
      const exitIpMismatch = entryIp && currentIp !== entryIp && !ipMatchesBranch
      const newStatus = exitIpMismatch ? 'incident' : 'closed'
      const incidents = exitIpMismatch ? [{
        type: 'ip_mismatch',
        note: `Salida desde red diferente a la de entrada (IP entrada: ${entryIp}, IP salida: ${currentIp})`,
        detectedAt: now,
      }] : []

      // Build overtime corrections
      const overtimeCorrections = overtimeHours > 0 ? {
        overtime: {
          hours: overtimeHours,
          minutes: overtimeMinutes,
          calculatedAt: now,
        }
      } : {}

      await supabase.from('shifts').update({
        exit_time: now,
        duration_hours: duration,
        status: newStatus,
        geo_exit: geo,
        incidents: incidents.length > 0 ? incidents : openShift.incidents || [],
        corrections: {
          ...(openShift.corrections || {}),
          exitIp: currentIp,
          ...overtimeCorrections,
        },
      }).eq('id', openShift.id)

      await supabase.from('audit_log').insert({
        tenant_id: tenantId, action: 'CHK_OUT',
        employee_id: emp.id, employee_name: emp.name,
        detail: `Duración: ${duration}h${overtimeHours > 0 ? ` · HE: ${overtimeHours}h` : ''} · IP: ${currentIp}${exitIpMismatch ? ' ⚠ IP diferente a entrada' : ''}`,
        success: true
      })

      if (exitIpMismatch) {
        return NextResponse.json({
          ok: true,
          msg: `Salida registrada (${duration}h). ⚠ Red diferente — incidencia creada para revisión del gerente.`,
          incident: true,
          overtimeHours,
        })
      }

      const otMsg = overtimeHours > 0 ? ` · ${overtimeHours} hora(s) extra registrada(s).` : ''
      return NextResponse.json({ ok: true, msg: `Salida registrada. Jornada: ${duration} horas.${otMsg}`, overtimeHours })
    }

  } catch (err) {
    console.error(err)
    return NextResponse.json({ ok: false, msg: 'Error interno del servidor.' }, { status: 500 })
  }
}
