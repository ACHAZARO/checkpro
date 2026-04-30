'use client'
// src/app/check/page.js
import { useState, useEffect, useCallback, useRef } from 'react'
import { haversineMeters, fmtTime, fmtDate, classifyEntry, isoDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import Link from 'next/link'
import {
  Building2,
  MapPin,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  Loader2,
  Settings,
  Wifi,
  Monitor,
  Smartphone,
} from 'lucide-react'

const ABANDON_MINUTES = 20        // minutes outside zone before auto-close
const GPS_INTERVAL_MS = 60_000    // check GPS every 60s while shift is open
const IP_INTERVAL_MS = 5 * 60_000 // check IP every 5 min

// ── Get or create a stable deviceId (UUID stored in localStorage) ─────────────
function getOrCreateDeviceId() {
  if (typeof window === 'undefined') return null
  const key = 'checkpro_device_id'
  let id = localStorage.getItem(key)
  if (!id) {
    id = crypto.randomUUID ? crypto.randomUUID() : `dev-${Date.now()}-${Math.random().toString(36).slice(2)}`
    localStorage.setItem(key, id)
  }
  return id
}

// ── LiveClock ─────────────────────────────────────────────────────────────────
function LiveClock({ locationName, branchName }) {
  const [t, setT] = useState(new Date())
  useEffect(() => { const id = setInterval(() => setT(new Date()), 1000); return () => clearInterval(id) }, [])
  return (
    <div className="min-h-[160px] flex flex-col items-center justify-center text-center px-4 py-6">
      <div className="font-mono tabular-nums text-[clamp(2.75rem,13vw,4.75rem)] font-semibold leading-none tracking-normal text-brand-400">
        {t.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
      </div>
      <div className="font-mono tabular-nums text-sm text-gray-400 mt-3">{fmtDate(t)}</div>
      {(branchName || locationName) && (
        <div className="inline-flex items-center gap-1.5 mt-3 px-3 py-1 bg-dark-700 border border-dark-border rounded-full text-xs text-gray-400 font-mono">
          <Building2 size={14} /> {branchName || locationName}
        </div>
      )}
    </div>
  )
}

// ── GpsStatus ─────────────────────────────────────────────────────────────────
function GpsStatus({ gps, onVerify }) {
  const ok = gps.status === 'ok' && gps.valid
  const out = gps.status === 'ok' && !gps.valid
  return (
    <div className="mb-4">
      <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold
        ${ok ? 'bg-brand-400/10 border-brand-400/20 text-brand-400' :
          out || gps.status === 'error' ? 'bg-red-500/10 border-red-500/20 text-red-400' :
          'bg-dark-700 border-dark-border text-gray-500'}`}>
        <span className="flex items-center">
          {ok
            ? <CheckCircle2 size={20} />
            : out || gps.status === 'error'
              ? <XCircle size={20} />
              : gps.status === 'loading'
                ? <Loader2 size={20} className="animate-spin" />
                : <MapPin size={20} />}
        </span>
        <span className="flex-1 text-xs">
          {gps.status === 'idle' ? 'Verifica tu ubicación antes de checar' :
           gps.status === 'loading' ? 'Obteniendo GPS...' :
           gps.status === 'error' ? gps.error :
           ok ? `Dentro del área · ${gps.dist}m · ±${gps.accuracy}m` :
           `Fuera del área (${gps.dist}m)`}
        </span>
        <button onClick={onVerify} disabled={gps.status === 'loading'}
          className="px-3 py-1.5 bg-dark-600 border border-dark-border rounded-lg text-xs font-bold text-white disabled:opacity-40 active:bg-dark-500 transition-all">
          {gps.status === 'loading' ? '...' : '↻'}
        </button>
      </div>
    </div>
  )
}

// ── PinPad ────────────────────────────────────────────────────────────────────
// FIX 5: prop `busy` bloquea auto-submit y captura de teclas para evitar
// que el usuario dispare un segundo handlePinComplete mientras el flujo async
// (punch + vacation return) sigue corriendo.
function PinPad({ onComplete, onClear, busy }) {
  const [pin, setPin] = useState('')
  const ref = useRef(null)
  useEffect(() => { ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }) }, [])
  useEffect(() => {
    if (busy) return
    if (pin.length === 4) { onComplete(pin); setTimeout(() => setPin(''), 200) }
  }, [pin, onComplete, busy])
  const num = d => { if (busy) return; if (pin.length < 4) setPin(p => p + d) }
  const del = () => { if (busy) return; setPin(p => p.slice(0, -1)) }
  return (
    <div ref={ref} className="text-center">
      <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">PIN de acceso</p>
      <div className="flex gap-3 justify-center mb-5">
        {[0,1,2,3].map(i => (
          <div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all duration-200
            ${pin.length > i ? 'bg-brand-400 border-brand-400 shadow-[0_0_8px_rgba(61,255,160,.4)]' : 'border-dark-500'}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
        {[1,2,3,4,5,6,7,8,9].map(d => (
          <button key={d} onClick={() => num(String(d))}
            className="bg-dark-700 border border-dark-border rounded-xl py-4 text-xl font-bold text-white active:scale-90 active:bg-dark-600 transition-all select-none">
            {d}
          </button>
        ))}
        <button onClick={() => { setPin(''); onClear?.() }}
          className="bg-dark-700 border border-dark-border rounded-xl py-4 text-xs font-bold text-gray-500 active:scale-90 transition-all">
          ESC
        </button>
        <button onClick={() => num('0')}
          className="bg-dark-700 border border-dark-border rounded-xl py-4 text-xl font-bold text-white active:scale-90 active:bg-dark-600 transition-all">
          0
        </button>
        <button onClick={del}
          className="bg-dark-700 border border-dark-border rounded-xl py-4 text-sm font-bold text-red-400 active:scale-90 transition-all">
          ⌫
        </button>
      </div>
    </div>
  )
}

// ── AbandonBanner ─────────────────────────────────────────────────────────────
function AbandonBanner({ monitor, onAbandon }) {
  const { outsideSince, outsideReason, minsLeft } = monitor
  if (!outsideSince) return null
  return (
    <div className="mx-4 mb-3 px-4 py-3 bg-orange-500/10 border border-orange-500/30 rounded-xl">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-orange-400 text-sm font-bold flex items-center gap-1.5">
            <AlertTriangle size={16} /> Fuera de la sucursal · {minsLeft}min restante{minsLeft !== 1 ? 's' : ''}
          </p>
          <p className="text-orange-400/70 text-xs mt-0.5">
            {outsideReason === 'ip' ? 'Saliste de la red WiFi de la sucursal' :
             outsideReason === 'gps' ? 'Saliste del perímetro GPS' :
             'Saliste del GPS y de la red WiFi'}
          </p>
        </div>
        <div className="text-orange-400 text-2xl font-mono font-bold">{minsLeft}</div>
      </div>
      {minsLeft <= 0 && (
        <button onClick={onAbandon}
          className="mt-2 w-full py-2 bg-red-500/20 border border-red-500/30 rounded-lg text-red-400 text-xs font-bold">
          Cerrar turno ahora (abandonado)
        </button>
      )}
    </div>
  )
}

// ── EmergencyExitModal ────────────────────────────────────────────────────────
function EmergencyExitModal({ onConfirm, onCancel, busy }) {
  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-5 pt-4 pb-4">
      <div className="bg-dark-800 border border-red-500/30 rounded-2xl p-6 w-full max-w-sm max-h-[90dvh] overflow-y-auto">
        <div className="text-center mb-4">
          <div className="flex justify-center mb-2"><AlertTriangle size={40} className="text-red-400" /></div>
          <h3 className="text-white font-bold text-lg mb-1">Salida de emergencia</h3>
          <p className="text-gray-400 text-sm">
            Esto registrará tu salida <span className="text-red-400 font-semibold">aunque estés fuera de la sucursal</span>.
            Se creará una incidencia que el gerente deberá revisar.
          </p>
        </div>
        <div className="space-y-2">
          <button onClick={onConfirm} disabled={busy}
            className="w-full py-3 bg-red-500/20 border border-red-500/40 rounded-xl text-red-400 font-bold text-sm active:bg-red-500/30 transition-all disabled:opacity-50">
            {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 size={16} className="animate-spin" /> Registrando...</span> : 'Confirmar salida de emergencia'}
          </button>
          <button onClick={onCancel} disabled={busy}
            className="w-full py-3 bg-dark-700 border border-dark-border rounded-xl text-gray-400 font-bold text-sm active:bg-dark-600 transition-all">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── VacationModal ─────────────────────────────────────────────────────────────
// Mostrado cuando el empleado esta en un periodo de vacaciones activo.
// Le permite decidir si se reincorpora hoy (sigue al PIN) o cancela.
// BUG M: soporte ESC + back button Android + a11y (role=dialog, aria-modal).
// Ademas hacemos body scroll lock al abrir y liberamos focus al cerrar.
function VacationModal({ period, employeeName, onAccept, onCancel }) {
  // R7: foco inicial al boton primario "Si, reincorporarme" cuando el modal
  // aparece. Mejora accesibilidad (screen readers anuncian el dialog) y UX en
  // teclados fisicos: Enter acepta directamente.
  const acceptRef = useRef(null)
  // Hooks deben llamarse siempre antes de cualquier return (rules-of-hooks).
  useEffect(() => {
    if (!period) return undefined
    function onKey(e) {
      if (e.key === 'Escape') { e.stopPropagation(); onCancel?.() }
    }
    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    // R7: foco inicial (timeout minimo para esperar al mount del boton).
    const prevFocused = typeof document !== 'undefined' ? document.activeElement : null
    const t = setTimeout(() => {
      acceptRef.current?.focus?.()
    }, 30)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
      // Restaurar foco al elemento previo (si sigue en DOM).
      if (prevFocused && typeof prevFocused.focus === 'function') {
        try { prevFocused.focus() } catch { /* ignore */ }
      }
    }
  }, [period, onCancel])

  if (!period) return null
  const endIso = String(period.end_date || '').slice(0, 10)
  const parts = endIso.split('-')
  const fmtEnd = parts.length === 3 ? `${parts[2]}/${parts[1]}/${parts[0]}` : endIso
  return (
    <div
      className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-start sm:items-center justify-center p-5 pt-4 pb-4"
      onClick={onCancel}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="vac-modal-title"
        className="bg-dark-800 border border-purple-500/30 rounded-2xl p-6 w-full max-w-sm max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="text-center mb-4">
          <div className="text-4xl mb-2">🏖</div>
          <h3 id="vac-modal-title" className="text-white font-bold text-lg mb-1">Estás de vacaciones</h3>
          <p className="text-gray-400 text-sm">
            {employeeName ? `${employeeName}, tu` : 'Tu'} periodo de vacaciones termina el{' '}
            <span className="text-purple-300 font-semibold">{fmtEnd}</span>.
          </p>
          <p className="text-gray-400 text-sm mt-2">
            ¿Quieres reincorporarte hoy?
          </p>
          <p className="text-xs text-gray-500 font-mono mt-2">
            Al confirmar, tu periodo se cerrará hoy y podrás registrar tu entrada con tu PIN.
          </p>
        </div>
        <div className="space-y-2">
          <button ref={acceptRef} onClick={onAccept}
            className="w-full py-3 bg-purple-500/20 border border-purple-500/40 rounded-xl text-purple-300 font-bold text-sm active:bg-purple-500/30 transition-all">
            Sí, reincorporarme
          </button>
          <button onClick={onCancel}
            className="w-full py-3 bg-dark-700 border border-dark-border rounded-xl text-gray-400 font-bold text-sm active:bg-dark-600 transition-all">
            Cancelar
          </button>
        </div>
      </div>
    </div>
  )
}

// ── isBirthday helper (parses YYYY-MM-DD avoiding UTC drift) ─────────────────
function isBirthday(iso) {
  if (!iso) return false
  const parts = String(iso).split('T')[0].split('-')
  if (parts.length !== 3) return false
  const m = parseInt(parts[1], 10)
  const d = parseInt(parts[2], 10)
  const now = new Date()
  return (m - 1) === now.getMonth() && d === now.getDate()
}

// ── Main ──────────────────────────────────────────────────────────────────────
export default function CheckPage() {
  const [cfg, setCfg]           = useState(null)
  const [logoUrl, setLogoUrl]   = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [branchId, setBranchId] = useState(null)
  const [branchName, setBranchName] = useState('')
  const [slug, setSlug]         = useState('')
  const [tenantToken, setTenantToken] = useState(null)

  // Device ID (persistent, bound to this browser)
  const [deviceId, setDeviceId] = useState(null)

  // Session (QR-bound, IP-tied, device-tied)
  const [session, setSession]   = useState(null)   // { token, ip }
  const [sessionLoading, setSessionLoading] = useState(true)

  // UI
  const [step, setStep]         = useState('id')   // id | pin | done
  const [empCode, setEmpCode]   = useState('')
  const [foundEmp, setFoundEmp] = useState(null)
  const [openShift, setOpenShift] = useState(null)
  const [coverMode, setCoverMode] = useState(false)
  const [coverTarget, setCoverTarget] = useState('')
  const [allEmps, setAllEmps]   = useState([])
  const [msg, setMsg]           = useState(null)
  const [busy, setBusy]         = useState(false)
  // R7: flag devuelto por /api/check/punch cuando hoy es cumpleanios del
  // empleado (en TZ MX). El identify es publico y NO expone birth_date, asi
  // que la UI reacciona solo tras PIN valido con este booleano.
  const [isBirthdayToday, setIsBirthdayToday] = useState(false)

  // Vacation flow: periodo activo detectado tras identify
  const [vacationPeriod, setVacationPeriod] = useState(null)  // { id, start_date, end_date, ... } | null
  const [showVacationModal, setShowVacationModal] = useState(false)
  const [vacationAccepted, setVacationAccepted] = useState(false) // true cuando el empleado acepto reincorporarse

  // GPS
  const [gps, setGps]           = useState({ status: 'idle', valid: false })

  // Dual monitoring (active when shift is open)
  const [currentIp, setCurrentIp] = useState(null)
  const [monitor, setMonitor]   = useState({ outsideSince: null, outsideReason: null, minsLeft: ABANDON_MINUTES })
  const monitorRef              = useRef(monitor)
  monitorRef.current            = monitor
  const abandonCalledRef        = useRef(false)

  // Emergency exit
  const [showEmergency, setShowEmergency] = useState(false)
  const [emergencyBusy, setEmergencyBusy] = useState(false)

  // FIX 6: guard síncrono contra double-submit de handlePinComplete.
  // setBusy(true) corre async vía setState, no protege contra el segundo
  // auto-submit del PinPad — este ref sí es inmediato.
  const submittingRef = useRef(false)

  // ── Init deviceId on mount ────────────────────────────────────────────────
  useEffect(() => {
    setDeviceId(getOrCreateDeviceId())
  }, [])

  // ── Load tenant from URL/localStorage ──────────────────────────────────────
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlSlug = params.get('tenant')
    const urlBranch = params.get('branch')
    const urlTenantToken = params.get('tenantToken')
    if (urlTenantToken) setTenantToken(urlTenantToken)

    async function init() {
      // FIX: merge branch.config sobre tenant.config cuando hay urlBranch.
      // Importante para location (GPS perimeter) — antes todas las sucursales
      // compartian el GPS del tenant, lo que rompia geofencing multi-branch.
      const mergeBranch = (tenantCfg, brList, bid) => {
        if (!bid) return tenantCfg
        const b = brList.find(x => x.id === bid)
        if (!b) return tenantCfg
        return { ...(tenantCfg || {}), ...(b.config || {}) }
      }

      // Try URL params first (fresh QR scan)
      if (urlSlug) {
        try {
          const res = await fetch(`/api/check/tenant?slug=${encodeURIComponent(urlSlug)}`)
          if (res.ok) {
            const data = await res.json()
            // FIX: preferir data.branches (tabla real) y caer a config.branches legacy
            const brList = (Array.isArray(data.branches) && data.branches.length > 0)
              ? data.branches
              : (data.config?.branches || [])
            setTenantId(data.id)
            setCfg(mergeBranch(data.config, brList, urlBranch))
            setSlug(data.slug)
            setLogoUrl(data.config?.logoUrl || null)
            if (urlBranch) {
              const b = brList.find(b => b.id === urlBranch)
              setBranchName(b?.name || '')
              setBranchId(urlBranch)
            }
            localStorage.setItem('checkpro_tenant', JSON.stringify({ id: data.id, config: data.config, slug: data.slug, branches: brList }))
            return
          }
        } catch {}
      }
      // Fallback to localStorage
      const stored = localStorage.getItem('checkpro_tenant')
      if (stored) {
        try {
          const data = JSON.parse(stored)
          const brList = (Array.isArray(data.branches) && data.branches.length > 0)
            ? data.branches
            : (data.config?.branches || [])
          setTenantId(data.id)
          setCfg(mergeBranch(data.config, brList, urlBranch))
          setSlug(data.slug)
          setLogoUrl(data.config?.logoUrl || null)
          if (urlBranch) {
            const b = brList.find(b => b.id === urlBranch)
            setBranchName(b?.name || ''); setBranchId(urlBranch)
          }
        } catch {}
      }
    }
    init()
  }, [])

  // ── Create session when tenant + deviceId are ready ───────────────────────
  useEffect(() => {
    if (!tenantId || !deviceId || !tenantToken) return
    setSessionLoading(true)
    fetch('/api/check/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantToken, branchId, deviceId })
    })
      .then(r => r.json())
      .then(data => { if (data?.token) { setSession({ token: data.token, ip: data.ip }); setCurrentIp(data.ip) } })
      .catch(() => {})
      .finally(() => setSessionLoading(false))
  }, [tenantId, branchId, deviceId, tenantToken])

  // ── GPS one-shot verify ───────────────────────────────────────────────────
  const verifyGps = useCallback(() => {
    if (!navigator.geolocation) { setGps(g => ({ ...g, status: 'error', error: 'GPS no disponible.' })); return }
    setGps(g => ({ ...g, status: 'loading' }))
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!cfg?.location) { setGps(g => ({ ...g, status: 'error', error: 'Sin ubicación configurada.' })); return }
        const { latitude: lat, longitude: lng, accuracy } = pos.coords
        const dist = Math.round(haversineMeters(lat, lng, cfg.location.lat, cfg.location.lng))
        setGps({ status: 'ok', lat, lng, accuracy: Math.round(accuracy), dist, valid: dist <= (cfg.location.radius || 300) })
      },
      err => {
        const m = { 1: 'Permiso denegado.', 2: 'No se obtuvo posición.', 3: 'Tiempo agotado.' }
        setGps(g => ({ ...g, status: 'error', error: m[err.code] || 'Error GPS.' }))
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }, [cfg])

  // ── Dual monitoring while shift is open (step=done + openShift) ───────────
  // En modo kiosko el dispositivo se queda fijo en la entrada: no tiene sentido
  // vigilar GPS/IP en vivo ni arrancar el timer de abandono — el empleado ya
  // no trae el device consigo. El GPS SÍ se valida al momento de checar.
  useEffect(() => {
    if (step !== 'done' || !openShift || !tenantId) return
    if (cfg?.kioskMode) return
    let gpsWatchId = null
    let ipTimer = null
    let countdownTimer = null
    const abandonCalledLocal = { v: false }

    async function triggerAbandon(reason, leftAt) {
      if (abandonCalledLocal.v) return
      abandonCalledLocal.v = true
      toast.error('Turno cerrado automáticamente — fuera de sucursal')
      await fetch('/api/check/abandon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId, employeeId: openShift.employee_id, reason, leftAt })
      })
      setOpenShift(null)
      setMsg({ type: 'warn', text: 'Tu turno fue cerrado automáticamente por salir de la sucursal. El gerente revisará la incidencia.' })
    }

    function evaluate(gpsOutside, ipOutside) {
      const outside = gpsOutside || ipOutside
      const reason = gpsOutside && ipOutside ? 'both' : gpsOutside ? 'gps' : 'ip'
      setMonitor(prev => {
        if (!outside) return { outsideSince: null, outsideReason: null, minsLeft: ABANDON_MINUTES }
        const since = prev.outsideSince || new Date()
        const elapsed = (Date.now() - since.getTime()) / 60000
        const left = Math.max(0, Math.ceil(ABANDON_MINUTES - elapsed))
        if (left <= 0 && !abandonCalledLocal.v) {
          triggerAbandon(reason, since.toISOString())
        }
        return { outsideSince: since, outsideReason: reason, minsLeft: left }
      })
    }

    let lastGpsOutside = false
    let lastIpOutside = false

    // ── GPS watch (disabled when screen is locked — browser limitation)
    if (navigator.geolocation && cfg?.location) {
      gpsWatchId = navigator.geolocation.watchPosition(
        pos => {
          const { latitude: lat, longitude: lng } = pos.coords
          const dist = Math.round(haversineMeters(lat, lng, cfg.location.lat, cfg.location.lng))
          lastGpsOutside = dist > (cfg.location.radius || 300)
          setGps(g => ({ ...g, status: 'ok', lat, lng, dist, valid: !lastGpsOutside, accuracy: Math.round(pos.coords.accuracy) }))
          evaluate(lastGpsOutside, lastIpOutside)
        },
        () => {},
        { enableHighAccuracy: true, maximumAge: 30000 }
      )
    }

    // ── IP watch (continues even when screen locked)
    const branchIp = branchId ? (cfg?.branches || []).find(b => b.id === branchId)?.ip : null
    async function checkIp() {
      try {
        const r = await fetch('/api/check/ip')
        const { ip } = await r.json()
        setCurrentIp(ip)
        lastIpOutside = branchIp ? (ip !== branchIp) : false
        evaluate(lastGpsOutside, lastIpOutside)
      } catch {}
    }
    checkIp()
    ipTimer = setInterval(checkIp, IP_INTERVAL_MS)

    countdownTimer = setInterval(() => {
      setMonitor(prev => {
        if (!prev.outsideSince) return prev
        const elapsed = (Date.now() - prev.outsideSince.getTime()) / 60000
        const left = Math.max(0, Math.ceil(ABANDON_MINUTES - elapsed))
        return { ...prev, minsLeft: left }
      })
    }, 10000)

    // ── Re-verify GPS when tab becomes visible again (phone unlocked)
    function handleVisibility() {
      if (document.visibilityState === 'visible') {
        // Re-check GPS immediately
        if (navigator.geolocation && cfg?.location) {
          navigator.geolocation.getCurrentPosition(
            pos => {
              const { latitude: lat, longitude: lng } = pos.coords
              const dist = Math.round(haversineMeters(lat, lng, cfg.location.lat, cfg.location.lng))
              lastGpsOutside = dist > (cfg.location.radius || 300)
              setGps(g => ({ ...g, status: 'ok', lat, lng, dist, valid: !lastGpsOutside, accuracy: Math.round(pos.coords.accuracy) }))
              evaluate(lastGpsOutside, lastIpOutside)
            },
            () => {},
            { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
          )
        }
        // Also re-check IP
        checkIp()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)

    return () => {
      if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId)
      clearInterval(ipTimer)
      clearInterval(countdownTimer)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [step, openShift, tenantId, cfg, branchId])

  // ── Reset ─────────────────────────────────────────────────────────────────
  const reset = () => {
    setStep('id'); setEmpCode(''); setFoundEmp(null); setOpenShift(null)
    setMsg(null); setCoverMode(false); setCoverTarget('')
    setVacationPeriod(null); setShowVacationModal(false); setVacationAccepted(false)
    setIsBirthdayToday(false) // R7
    setMonitor({ outsideSince: null, outsideReason: null, minsLeft: ABANDON_MINUTES })
  }

  // ── Identify employee ─────────────────────────────────────────────────────
  async function submitId() {
    if (!tenantId || !session?.token) { setMsg({ type: 'err', text: 'Escanea de nuevo el QR de la sucursal.' }); return }
    setBusy(true)
    try {
      const res = await fetch('/api/check/identify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ employeeCode: empCode.trim().toUpperCase(), sessionToken: session.token, deviceId })
      })
      const data = await res.json()
      if (!data.found) { setMsg({ type: 'err', text: data.error || 'No pudimos validar ese ID.' }); setBusy(false); return }
      setFoundEmp({ code: empCode.trim().toUpperCase() }) // FIX: no exponer PII antes de PIN valido.
      setOpenShift(data.openShift || null)
      setAllEmps(data.allEmployees || []) // FIX: cobertura necesita lista de companeros (id+name).

      // BUG N: consultar estatus de vacaciones SIEMPRE despues de identify,
      // sin importar si hay turno abierto. Antes, un shift abierto fantasma
      // durante un periodo active impedia ver el modal y el empleado solo
      // podia hacer 'out', corrompiendo el flujo.
      if (data.employee?.id) {
        try {
          const vacRes = await fetch(
            `/api/vacations/check-status/${data.employee.id}?tenant_id=${encodeURIComponent(tenantId)}`
          )
          const vacJson = await vacRes.json().catch(() => ({}))
          if (vacRes.ok && vacJson?.onVacation && vacJson.period) {
            setVacationPeriod(vacJson.period)
            if (data.openShift) {
              // Estado inconsistente: active + turno abierto. No bloqueamos,
              // solo advertimos al gerente.
              console.warn(
                '[check] vacation active + openShift inconsistente',
                { employee: data.employee?.id, periodId: vacJson.period?.id }
              )
              toast('Turno abierto durante vacaciones — notifica al gerente', {
                icon: '⚠️',
                duration: 6000,
              })
              setShowVacationModal(false)
            } else {
              setShowVacationModal(true)
            }
          } else {
            setVacationPeriod(null)
            setShowVacationModal(false)
          }
        } catch {
          // Si falla el endpoint, no bloqueamos el flujo: se permite checar.
          setVacationPeriod(null)
          setShowVacationModal(false)
        }
      } else {
        setVacationPeriod(null)
        setShowVacationModal(false)
      }

      setStep('pin'); setMsg(null)
    } catch { setMsg({ type: 'err', text: 'Error de conexión.' }) }
    finally { setBusy(false) }
  }

  // ── PIN complete → punch ──────────────────────────────────────────────────
  async function handlePinComplete(pin) {
    // FIX 6: guard síncrono contra double-submit.
    if (submittingRef.current) return
    submittingRef.current = true
    try {
      if (!gps.valid) { setMsg({ type: 'warn', text: 'Verifica tu ubicación GPS primero.' }); return }
      setBusy(true)
      const action = openShift ? 'out' : 'in'
      try {
        // Si el empleado esta en vacaciones y acepto reincorporarse,
        // primero cerramos su periodo de vacaciones (autenticado con el mismo PIN).
        if (vacationPeriod && vacationAccepted && action === 'in') {
          const retRes = await fetch(`/api/vacations/${vacationPeriod.id}/employee-return`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId,
              employeeCode: empCode.trim().toUpperCase(),
              pin,
            }),
          })
          const retJson = await retRes.json().catch(() => ({}))
          if (!retRes.ok || !retJson?.ok) {
            const errMsg = retJson?.error || 'No se pudo cerrar el periodo de vacaciones.'
            setMsg({ type: 'err', text: errMsg })
            toast.error(errMsg)
            setBusy(false)
            return
          }
          // Limpiar estado de vacaciones; el punch continua normal.
          setVacationPeriod(null)
          setVacationAccepted(false)
          toast.success('Vacaciones cerradas. Registrando entrada...')
        }

        const res = await fetch('/api/check/punch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId, employeeCode: empCode.trim().toUpperCase(), pin, action,
            coveringEmployeeId: coverMode && coverTarget ? coverTarget : null,
            geo: { lat: gps.lat, lng: gps.lng, dist: gps.dist, accuracy: gps.accuracy, valid: gps.valid },
            sessionToken: session?.token || null,
            deviceId,
          })
        })
        const data = await res.json()
        // BUG 3: si el servidor detecta en el punch un periodo de vacaciones
        // activo (race con el check-status inicial), responde 409 on_vacation.
        // Reabrimos el modal de vacaciones con el periodo recibido para que el
        // empleado pueda aceptar la reincorporación y volver a intentar el PIN.
        if (res.status === 409 && data?.error === 'on_vacation') {
          setVacationPeriod(data.period || null)
          setVacationAccepted(false)
          setShowVacationModal(true)
          setStep('pin')
          setMsg({ type: 'warn', text: data.msg || 'Estás en vacaciones. Confirma tu reincorporación antes de checar.' })
          if (data.msg) toast(data.msg, { icon: '🏖️', duration: 5000 })
          setBusy(false)
          return
        }
        if (data.ok) {
          if (data.employee) setFoundEmp(data.employee) // FIX: mostrar PII solo despues de PIN correcto.
          setMsg({ type: 'ok', text: data.msg })
          toast.success(data.msg)
          // R7: el servidor marca birthday:true si hoy es cumpleanios del
          // empleado (en TZ MX). No exponemos birth_date al cliente: solo el flag.
          if (data.birthday) {
            setIsBirthdayToday(true)
            toast(`🎉 ¡Feliz cumpleaños${foundEmp?.name ? ', ' + (foundEmp.name.split(' ')[0] || '') : ''}!`, {
              icon: '🎂', duration: 5000,
            })
          } else {
            setIsBirthdayToday(false)
          }
          if (action === 'in') {
            setStep('done')
            setOpenShift({ employee_id: data.employee?.id || foundEmp?.id, entry_time: data.entry_time || new Date().toISOString() })
            // En modo kiosko el dispositivo es compartido: devolverlo al teclado
            // de ID unos segundos después para que el siguiente empleado entre.
            // El turno ya quedó abierto en BD — al volver a checar su salida,
            // /api/check/identify lo encontrará por su PIN+ID.
            if (cfg?.kioskMode) setTimeout(reset, 6000)
          } else {
            setStep('done')
            setOpenShift(null)
            setTimeout(reset, 4000)
          }
        } else {
          const safeMsg = data.msg || data.error || 'No se pudo registrar. Intenta de nuevo.'
          setMsg({ type: 'err', text: safeMsg }); toast.error(safeMsg)
        }
      } catch { setMsg({ type: 'err', text: 'Error de conexión.' }); toast.error('Error de conexión') }
      finally { setBusy(false) }
    } finally {
      submittingRef.current = false
    }
  }

  // ── Manual abandon (from countdown) ──────────────────────────────────────
  async function manualAbandon() {
    if (!openShift) return
    await fetch('/api/check/abandon', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tenantId, employeeId: foundEmp?.id || openShift.employee_id, reason: monitor.outsideReason || 'both', leftAt: monitor.outsideSince?.toISOString() })
    })
    setOpenShift(null)
    setMsg({ type: 'warn', text: 'Turno cerrado. El gerente revisará la incidencia.' })
    setTimeout(reset, 4000)
  }

  // ── Emergency exit ────────────────────────────────────────────────────────
  async function handleEmergencyExit() {
    if (!openShift) return
    setEmergencyBusy(true)
    try {
      await fetch('/api/check/abandon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          employeeId: foundEmp?.id || openShift.employee_id,
          reason: 'emergency',
          leftAt: new Date().toISOString(),
        })
      })
      setShowEmergency(false)
      setOpenShift(null)
      toast('Salida registrada. Se creó una incidencia.', { icon: '⚠️' })
      setMsg({ type: 'warn', text: 'Salida de emergencia registrada. El gerente revisará la incidencia.' })
      setTimeout(reset, 5000)
    } catch {
      toast.error('Error al registrar salida.')
    } finally {
      setEmergencyBusy(false)
    }
  }

  // ── Not configured ────────────────────────────────────────────────────────
  if (!tenantId || !tenantToken) return (
    <main className="min-h-dvh bg-dark-900 flex flex-col items-center justify-center px-5 text-center">
      <div className="text-4xl mb-4 flex justify-center"><Settings size={40} /></div>
      <h2 className="text-xl font-bold text-white mb-2">Checador no configurado</h2>
      <p className="text-gray-500 text-sm mb-6">Escanea el código QR de tu sucursal para comenzar.</p>
      <Link href="/dashboard/settings" className="btn-primary max-w-xs">Ir a configuración →</Link>
    </main>
  )

  const initials = foundEmp?.name?.split(' ').slice(0, 2).map(w => w[0]).join('') || ''
  const otherEmps = allEmps.filter(e => e.id !== foundEmp?.id)

  return (
    <main className="min-h-dvh bg-dark-900 flex flex-col max-w-[430px] mx-auto">
      {/* Emergency exit modal */}
      {showEmergency && (
        <EmergencyExitModal
          onConfirm={handleEmergencyExit}
          onCancel={() => setShowEmergency(false)}
          busy={emergencyBusy}
        />
      )}

      {/* Vacation modal (pedir confirmacion de reincorporacion) */}
      {showVacationModal && vacationPeriod && (
        <VacationModal
          period={vacationPeriod}
          employeeName={foundEmp?.name}
          onAccept={() => {
            setVacationAccepted(true)
            setShowVacationModal(false)
          }}
          onCancel={() => {
            setShowVacationModal(false)
            reset()
          }}
        />
      )}

      <div className="flex-1 overflow-y-auto no-scrollbar pb-safe">

        {/* Hero / clock */}
        <div className="mx-3.5 mt-3.5 bg-gradient-to-br from-brand-400/7 to-blue-500/5 border border-brand-400/15 rounded-2xl">
          {logoUrl && (
            <div className="pt-4 flex justify-center">
              <img src={logoUrl} alt="Logo" className="h-10 w-auto object-contain opacity-80" />
            </div>
          )}
          <LiveClock locationName={cfg?.location?.name} branchName={branchName} />
        </div>

        {/* Abandon banner */}
        {step === 'done' && openShift && (
          <div className="mt-3">
            <AbandonBanner monitor={monitor} onAbandon={manualAbandon} />
          </div>
        )}

        <div className="px-4 pt-3">
          <GpsStatus gps={gps} onVerify={verifyGps} />

          {/* ── DONE screen: shift is open, waiting for QR rescan ── */}
          {step === 'done' && openShift && (
            <div className="card text-center">
              <div className="w-14 h-14 rounded-full bg-brand-400/10 border-2 border-brand-400/20 text-brand-400 text-xl font-bold font-mono flex items-center justify-center mx-auto mb-3">
                {initials || '✓'}
              </div>
              <div className="font-bold text-lg text-white mb-1">{foundEmp?.name || 'Jornada activa'}</div>
              <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-brand-400/10 border border-brand-400/20 rounded-full text-brand-400 text-xs font-semibold mb-4">
                <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                Jornada desde {fmtTime(openShift.entry_time)}
              </div>
              {/* Network status pill */}
              {currentIp && (
                <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-[10px] font-mono mb-4 ml-2
                  ${monitor.outsideSince ? 'bg-orange-500/10 border border-orange-500/20 text-orange-400' : 'bg-dark-700 border border-dark-border text-gray-600'}`}>
                  {monitor.outsideSince
                    ? <><AlertTriangle size={12} className="inline mr-1" />Fuera de red</>
                    : <><Wifi size={12} className="inline mr-1" />En red de sucursal</>}
                </div>
              )}

              {/* Rescan to exit instructions */}
              <div className="mt-2 p-4 bg-dark-700 border border-dark-border rounded-xl mb-4">
                <div className="flex justify-center mb-2">{cfg?.kioskMode ? <Monitor size={28} /> : <Smartphone size={28} />}</div>
                <p className="text-white font-bold text-sm mb-1">Para registrar tu salida:</p>
                <p className="text-gray-400 text-xs">
                  {cfg?.kioskMode
                    ? 'Regresa a este mismo equipo y teclea tu ID + PIN. En unos segundos la pantalla vuelve al teclado para el siguiente empleado.'
                    : 'Escanea de nuevo el código QR de la sucursal con tu celular.'}
                </p>
              </div>

              {/* Birthday greeting (R7: usa flag del punch, no birth_date) */}
              {isBirthdayToday && (
                <div className="w-full mb-3 px-4 py-3 bg-gradient-to-br from-pink-500/10 via-yellow-500/10 to-brand-400/10 border border-yellow-400/30 rounded-xl text-center">
                  <div className="text-2xl mb-1">🎂 🎉</div>
                  <div className="text-yellow-300 text-sm font-bold">¡Feliz cumpleaños{foundEmp?.name ? ', ' + (foundEmp.name.split(' ')[0] || '') : ''}!</div>
                  <div className="text-gray-400 text-xs mt-0.5 font-mono">Que tengas un excelente día.</div>
                </div>
              )}

              {/* Manager: quick access to dashboard (opens in new tab so kiosk stays on /check) */}
              {foundEmp?.can_manage && (
                <Link
                  href="/login"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block w-full mb-3 py-3 bg-orange-500/10 border border-orange-400/30 rounded-xl text-orange-400 text-sm font-semibold hover:bg-orange-500/20 transition-all text-center">
                  🔑 Entrar a mi panel de gerente →
                </Link>
              )}

              {/* Emergency exit */}
              <button
                onClick={() => setShowEmergency(true)}
                className="w-full py-2.5 border border-red-500/20 rounded-xl text-red-500/70 text-xs font-semibold hover:bg-red-500/10 transition-all">
                <span className="inline-flex items-center gap-1.5"><AlertTriangle size={16} className="text-red-400" /> Salida de emergencia (crea incidencia)</span>
              </button>

              {msg && (
                <div className={`mt-3 px-4 py-3 rounded-xl text-sm font-semibold
                  ${msg.type === 'ok' ? 'bg-brand-400/10 border border-brand-400/20 text-brand-400' :
                    msg.type === 'warn' ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400' :
                    'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  {msg.text}
                </div>
              )}
            </div>
          )}

          {/* ── DONE screen: after clock-out ── */}
          {step === 'done' && !openShift && (
            <div className="card text-center py-8">
              <div className="flex justify-center mb-3"><CheckCircle2 size={48} className="text-brand-400" /></div>
              <p className="text-white font-bold text-lg">¡Hasta pronto!</p>
              {msg && <p className="text-brand-400 text-sm mt-2">{msg.text}</p>}
            </div>
          )}

          {/* ── ID step ── */}
          {step === 'id' && (
            <div className="card">
              {sessionLoading && (
                <div className="text-xs text-gray-600 font-mono text-center mb-3">🔐 Verificando sesión...</div>
              )}
              {session && !sessionLoading && (
                <div className="text-[10px] text-gray-600 font-mono text-center mb-3">
                  🔒 Sesión activa · {session.ip}
                </div>
              )}
              <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Identificación</p>
              <label className="label">ID de Empleado</label>
              <input className="input text-center text-xl tracking-widest font-mono mb-3"
                placeholder="EMP001" value={empCode}
                onChange={e => setEmpCode(e.target.value.toUpperCase())}
                onKeyDown={e => e.key === 'Enter' && submitId()} />
              <button onClick={submitId} disabled={busy || !empCode} className="btn-primary">
                {busy ? <span className="inline-flex items-center gap-1.5"><Loader2 size={16} className="animate-spin" /> Buscando...</span> : 'Continuar →'}
              </button>
              {msg && (
                <div className={`mt-3 px-4 py-3 rounded-xl text-sm font-semibold
                  ${msg.type === 'err' ? 'bg-red-500/10 border border-red-500/20 text-red-400' : 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400'}`}>
                  {msg.text}
                </div>
              )}
            </div>
          )}

          {/* ── PIN step ── */}
          {step === 'pin' && (
            <div className="card">
              {/* Employee header */}
              <div className="text-center mb-5">
                <div className={`w-14 h-14 rounded-full flex items-center justify-center text-lg font-bold font-mono mx-auto mb-2.5
                  ${foundEmp?.can_manage ? 'bg-orange-500/10 border-2 border-orange-400/30 text-orange-400' : 'bg-brand-400/10 border-2 border-brand-400/20 text-brand-400'}`}>
                  {initials}
                </div>
                <div className="font-bold text-lg text-white">{foundEmp?.name || 'Empleado identificado'}</div>
                {/* BUG 9: renderizar solo si hay valores — antes imprimía
                    "undefined · undefined" cuando el endpoint no los devolvía. */}
                {(foundEmp?.department || foundEmp?.role_label) && (
                  <div className="text-gray-500 text-xs mt-0.5">
                    {[foundEmp?.department, foundEmp?.role_label].filter(Boolean).join(' · ')}
                  </div>
                )}
                {openShift ? (
                  <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-brand-400/10 border border-brand-400/20 rounded-full text-brand-400 text-xs font-semibold">
                    <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
                    {openShift.entry_time ? `Jornada desde ${fmtTime(openShift.entry_time)}` : 'Jornada activa'}
                  </div>
                ) : vacationAccepted ? (
                  <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-purple-500/10 border border-purple-500/20 rounded-full text-purple-300 text-xs font-semibold">
                    🏖 Reincorporándote desde vacaciones
                  </div>
                ) : (
                  <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-dark-700 border border-dark-border rounded-full text-gray-400 text-xs">
                    ⏱ Registrar entrada
                  </div>
                )}
              </div>

              {/* Cover mode */}
              {!openShift && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-sm text-gray-400 font-medium">¿Cubriendo a compañero?</span>
                    <button onClick={() => setCoverMode(m => !m)}
                      className={`w-10 h-6 rounded-full relative transition-colors ${coverMode ? 'bg-brand-400' : 'bg-dark-600'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${coverMode ? 'left-5' : 'left-1'}`} />
                    </button>
                  </div>
                  {coverMode && (
                    <>
                      <select className="input text-sm mb-1" value={coverTarget} onChange={e => setCoverTarget(e.target.value)}>
                        <option value="">— Selecciona al compañero —</option>
                        {otherEmps.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                      </select>
                      <p className="text-xs text-blue-400 font-mono">💡 Tarifa: la del compañero cubierto</p>
                    </>
                  )}
                </div>
              )}

              <PinPad onComplete={handlePinComplete} onClear={() => setMsg(null)} busy={busy} />

              {!gps.valid && (
                <div className="mt-4 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-400 text-xs font-semibold">
                  <span className="inline-flex items-center gap-1.5"><AlertTriangle size={16} /> Verifica tu ubicación GPS antes de checar.</span>
                </div>
              )}
              {busy && <div className="mt-3 text-center text-blue-400 text-sm font-mono flex items-center justify-center gap-1.5"><Loader2 size={16} className="animate-spin" /> Procesando...</div>}
              {msg && (
                <div className={`mt-3 px-4 py-3 rounded-xl text-sm font-semibold
                  ${msg.type === 'ok' ? 'bg-brand-400/10 border border-brand-400/20 text-brand-400' :
                    msg.type === 'warn' ? 'bg-yellow-500/10 border border-yellow-500/20 text-yellow-400' :
                    'bg-red-500/10 border border-red-500/20 text-red-400'}`}>
                  <span className="inline-flex items-center gap-1.5">
                    {msg.type === 'ok' ? <CheckCircle2 size={16} /> : msg.type === 'warn' ? <AlertTriangle size={16} /> : <XCircle size={16} />}
                    {msg.text}
                  </span>
                </div>
              )}
            </div>
          )}

          <p className="text-center font-mono text-xs text-gray-600 mt-3 pb-4">
            RADIO {cfg?.location?.radius || 300}M · TOLERANCIA {cfg?.toleranceMinutes || 10}MIN
          </p>
        </div>
      </div>
    </main>
  )
}
