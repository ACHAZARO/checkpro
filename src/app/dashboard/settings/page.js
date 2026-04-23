'use client'
// src/app/dashboard/settings/page.js
// Tabs: Empresa / Sucursales / Equipo
// - Empresa: tenant-wide identity (name, logo, payroll legend, vacation table)
// - Sucursales: list + open each one → per-branch config (hours, GPS, tolerancia,
//   holidays, rest days, printing, coverage pay, IP, QR).
// - Equipo: invitations (owner-only).
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { DAYS, DAY_L, DAY_FL, LFT_VACATION_TABLE } from '@/lib/utils'
import toast from 'react-hot-toast'
import HelpCenter from '@/components/HelpCenter'

const DEFAULT_LEYENDA = 'Al firmar el presente comprobante de nómina, el trabajador acepta que los montos, horas trabajadas e incidencias registradas son correctos y conformes a su contrato laboral. Cualquier aclaración deberá presentarse por escrito en un plazo máximo de 5 días hábiles. Documento confidencial de uso interno.'
const FALLBACK_URL = 'https://checkpro-self.vercel.app'

export default function SettingsPage() {
  const [tab, setTab] = useState('empresa')
  const [profile, setProfile] = useState(null)
  const [tenant, setTenant] = useState(null)
  const [branches, setBranches] = useState([])
  const [loading, setLoading] = useState(true)
  const [openBranchId, setOpenBranchId] = useState(null)
  const [origin, setOrigin] = useState(FALLBACK_URL)

  useEffect(() => { setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session }, error: sErr } = await supabase.auth.getSession()
    if (sErr || !session) {
      console.error('[settings] no session:', sErr)
      setLoading(false)
      return
    }
    const { data: prof, error: pErr } = await supabase.from('profiles').select('*').eq('id', session.user.id).single()
    if (pErr) {
      console.error('[settings] profiles error:', pErr)
      toast.error(`No se pudo cargar tu perfil: ${pErr.message}`)
      setLoading(false)
      return
    }
    setProfile(prof)
    if (!prof?.tenant_id) {
      console.error('[settings] profile sin tenant_id', prof)
      toast.error('Tu perfil no tiene empresa asignada.')
      setLoading(false)
      return
    }
    const { data: ten, error: tErr } = await supabase.from('tenants').select('*').eq('id', prof.tenant_id).single()
    if (tErr || !ten) {
      console.error('[settings] tenants select error:', tErr, 'tenant_id:', prof.tenant_id)
      toast.error(tErr?.message ? `Error cargando empresa: ${tErr.message}` : 'No se pudo cargar tu empresa (RLS?)')
      setLoading(false)
      return
    }
    setTenant(ten)
    try {
      const r = await fetch('/api/branches')
      if (r.ok) {
        const { branches: list } = await r.json()
        setBranches(list || [])
      } else {
        console.error('[settings] /api/branches failed:', r.status)
      }
    } catch (e) {
      console.error('[settings] /api/branches threw:', e)
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  if (loading) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  const isOwner = profile?.role === 'owner' || profile?.role === 'super_admin'

  // ── Branch detail view ────────────────────────────────────────────────────
  if (openBranchId) {
    const branch = branches.find(b => b.id === openBranchId)
    if (!branch) { setOpenBranchId(null); return null }
    return (
      <BranchDetail
        branch={branch}
        origin={origin}
        tenantSlug={tenant?.slug || ''}
        canEditName={isOwner}
        onBack={() => setOpenBranchId(null)}
        onSaved={async () => { await load() }}
      />
    )
  }

  const TABS = isOwner
    ? [['empresa','Empresa'],['sucursales','Sucursales'],['equipo','Equipo'],['ayuda','Ayuda']]
    : [['sucursales','Mi sucursal'],['ayuda','Ayuda']]

  // Manager can't see Empresa/Equipo tabs; default to sucursales (Ayuda sí la ven)
  if (!isOwner && tab !== 'sucursales' && tab !== 'ayuda') setTab('sucursales')

  return (
    <div className="p-5 md:p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Configuración</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">PARÁMETROS DEL SISTEMA</p>
      </div>

      <div className="flex gap-2 mb-4 border-b border-dark-border overflow-x-auto">
        {TABS.map(([id,label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={`px-3 py-2 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors ${
              tab === id ? 'text-brand-400 border-brand-400' : 'text-gray-500 border-transparent hover:text-white'
            }`}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'empresa' && isOwner && (
        tenant
          ? <TenantIdentityTab tenant={tenant} onSaved={async () => { await load() }} />
          : (
            <div className="card text-center py-8">
              <div className="text-3xl mb-2">⚠️</div>
              <p className="text-sm text-red-400 font-bold mb-1">No se pudo cargar la empresa</p>
              <p className="text-xs text-gray-500 font-mono mb-4">
                La empresa vinculada a tu cuenta no esta disponible. Puedes crear una nueva o reintentar.
              </p>
              <div className="flex flex-col sm:flex-row gap-2 justify-center">
                <button onClick={() => load()} className="px-4 py-2 bg-dark-700 border border-dark-border text-gray-300 text-sm font-bold rounded-xl active:brightness-90">
                  🔄 Reintentar
                </button>
                <button onClick={() => { window.location.href = '/onboarding' }} className="px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90">
                  ＋ Crear empresa nueva
                </button>
              </div>
            </div>
          )
      )}

      {tab === 'sucursales' && (
        <BranchesTab
          branches={branches}
          isOwner={isOwner}
          myBranchId={profile?.branch_id}
          onOpen={setOpenBranchId}
          onChanged={async () => { await load() }}
        />
      )}

      {tab === 'equipo' && isOwner && (
        <TeamTab branches={branches} onChanged={load} />
      )}

      {tab === 'ayuda' && (
        <HelpCenter />
      )}
    </div>
  )
}

// ── Tab: Tenant identity (owner-only) ────────────────────────────────────────
function TenantIdentityTab({ tenant, onSaved }) {
  const [name, setName] = useState(tenant?.name || '')
  const [cfg, setCfg] = useState(tenant?.config || {})
  const [saving, setSaving] = useState(false)
  // Tabla de vacaciones: colapsada por default — la LFT 2023 aplica sin tocar nada.
  // Solo se expone si el admin explicitamente quiere sobrescribir o si ya habia un override guardado.
  const [showVacTable, setShowVacTable] = useState(Boolean(tenant?.config?.vacationTable))
  const F = (k, v) => setCfg(c => ({ ...c, [k]: v }))

  function getVacTable() { return cfg.vacationTable || LFT_VACATION_TABLE }
  function setVacTableRow(idx, field, val) {
    const table = [...getVacTable()]
    table[idx] = { ...table[idx], [field]: parseInt(val) || 0 }
    setCfg(c => ({ ...c, vacationTable: table }))
  }
  function resetVacTableToLFT() { setCfg(c => ({ ...c, vacationTable: null })); toast.success('Tabla reseteada a LFT 2023') }

  async function save() {
    if (saving) return
    // Bail out defensivo: si el tenant nunca cargo (RLS, network, o carrera de load),
    // tenant.id explota con "null is not an object". Mejor mensaje claro que reventar.
    if (!tenant || !tenant.id) {
      console.error('[settings] save() llamado sin tenant cargado', { tenant })
      toast.error('No se pudo cargar tu empresa. Recarga la pagina y vuelve a intentar.')
      return
    }
    setSaving(true)
    const supabase = createClient()
    // Timeout de 15s: si Supabase se cuelga (RLS recursivo, red, etc.) no dejamos el boton atascado
    let timedOut = false
    const timeoutId = setTimeout(() => {
      timedOut = true
      toast.error('El guardado esta tardando demasiado. Revisa tu conexion.')
      setSaving(false)
    }, 15000)
    try {
      // Validar sesion ANTES de tocar supabase — si no hay session, update() puede colgarse o throw opaco
      const { data: { session }, error: sessErr } = await supabase.auth.getSession()
      if (sessErr || !session) {
        clearTimeout(timeoutId)
        if (timedOut) return
        console.error('[settings] no session:', sessErr)
        toast.error('Tu sesion expiro. Vuelve a iniciar sesion.')
        setTimeout(() => { window.location.href = '/login' }, 1500)
        return
      }

      // Sanitizar cfg — si tiene valores undefined o circular refs, PostgREST throwea sin detalle
      let cleanCfg
      try {
        cleanCfg = JSON.parse(JSON.stringify(cfg || {}))
      } catch (jsonErr) {
        clearTimeout(timeoutId)
        console.error('[settings] cfg no serializable:', jsonErr, cfg)
        toast.error('Configuracion invalida (JSON).')
        return
      }

      const payload = { name: name.trim() || tenant.name, config: cleanCfg }
      // .select() fuerza a PostgREST a devolver la fila — asi detectamos si RLS filtro 0 filas
      const { data, error } = await supabase
        .from('tenants')
        .update(payload)
        .eq('id', tenant.id)
        .select()
      clearTimeout(timeoutId)
      if (timedOut) return
      if (error) {
        console.error('[settings] update tenant error:', error)
        const msg = error.message || error.details || error.hint || 'No se pudo guardar'
        toast.error(`Error: ${msg}`)
        return
      }
      if (!data || data.length === 0) {
        // RLS bloqueo el update sin throw — comun si la session expiro o el rol cambio
        toast.error('No tienes permisos para guardar esta empresa. Vuelve a iniciar sesion.')
        return
      }
      toast.success('Empresa guardada')
      try { await onSaved?.() } catch (e) { console.error('[settings] onSaved error:', e) }
    } catch (e) {
      clearTimeout(timeoutId)
      if (timedOut) return
      console.error('[settings] save unexpected:', e)
      const msg = e?.message || e?.error_description || e?.details || (typeof e === 'string' ? e : JSON.stringify(e)).slice(0, 150)
      toast.error(`Error: ${msg}`)
    } finally {
      if (!timedOut) setSaving(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <div>
          <label className="label">Nombre de la empresa</label>
          <input className="input" value={name} onChange={e => setName(e.target.value)} placeholder="Mi Empresa" />
          <p className="text-[10px] text-gray-600 font-mono mt-1">Nombre comercial. Cada sucursal puede elegir si usar este o el suyo en impresos.</p>
        </div>
        <div>
          <label className="label">Razón social <span className="text-gray-600 font-normal">(opcional)</span></label>
          <input className="input" value={cfg.razonSocial || ''} onChange={e => F('razonSocial', e.target.value)} placeholder="Mi Empresa S.A. de C.V." />
          <p className="text-[10px] text-gray-600 font-mono mt-1">Solo si necesitas que aparezca el nombre legal/fiscal en impresos.</p>
        </div>
        <div>
          <label className="label">Logo principal (URL)</label>
          <input className="input text-sm" placeholder="https://tuempresa.com/logo.png"
            value={cfg.logoUrl || ''} onChange={e => F('logoUrl', e.target.value)} />
          {cfg.logoUrl && (
            <div className="mt-2 p-2 bg-dark-700 border border-dark-border rounded-xl inline-flex items-center gap-2">
              <img src={cfg.logoUrl} alt="" className="h-10 w-auto object-contain" onError={e => { e.target.style.display='none' }} />
              <span className="text-[10px] text-gray-500 font-mono">Vista previa</span>
            </div>
          )}
          <p className="text-[10px] text-gray-600 font-mono mt-1">
            Cada sucursal puede sobrescribir el logo para sus hojas impresas.
          </p>
        </div>
        <div>
          <label className="label">Leyenda legal al pie de nóminas</label>
          <textarea className="input text-xs leading-relaxed" rows={4}
            value={cfg.payrollLegend ?? DEFAULT_LEYENDA}
            onChange={e => F('payrollLegend', e.target.value)} placeholder={DEFAULT_LEYENDA} />
          <div className="flex items-center justify-between mt-1">
            <p className="text-[10px] text-gray-600 font-mono">Cada sucursal puede sobrescribirla desde su propia configuración.</p>
            <button onClick={() => F('payrollLegend', DEFAULT_LEYENDA)}
              className="text-[10px] text-gray-600 hover:text-gray-400 font-mono">↻ Restaurar texto por defecto</button>
          </div>
        </div>
      </div>

      {/* Horario mixto (rotativos) — toggle a nivel empresa porque controla el módulo Planificador global */}
      <div className="card space-y-3">
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Horario mixto <span className="normal-case text-gray-600">(empleados rotativos)</span></p>
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1">
            <p className="text-sm font-semibold text-white">Activar horario mixto</p>
            <p className="text-[11px] text-gray-500 mt-0.5 leading-snug">
              Permite registrar empleados con duración de jornada (horas/día) en lugar de horario fijo. El gerente planifica su horario semana a semana.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setCfg(c => ({ ...c, mixedSchedule: { ...(c.mixedSchedule || {}), enabled: !c.mixedSchedule?.enabled } }))}
            className={`w-10 h-6 rounded-full relative transition-colors shrink-0 ${cfg.mixedSchedule?.enabled ? 'bg-brand-400' : 'bg-dark-600'}`}
            aria-label="Activar horario mixto">
            <div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${cfg.mixedSchedule?.enabled ? 'left-5' : 'left-1'}`} />
          </button>
        </div>

        {cfg.mixedSchedule?.enabled && (
          <div className="pt-3 border-t border-dark-border space-y-3">
            <div>
              <label className="label">Máximo de empleados rotativos permitidos</label>
              <div className="flex items-center gap-2">
                <input className="input flex-1" type="number" min="1" max="9999" placeholder="Ilimitado"
                  value={cfg.mixedSchedule?.maxRotating ?? ''}
                  onChange={e => {
                    const raw = e.target.value
                    const parsed = raw === '' ? null : Math.max(1, parseInt(raw) || 1)
                    setCfg(c => ({ ...c, mixedSchedule: { ...(c.mixedSchedule || {}), maxRotating: parsed, unlimitedRotating: parsed == null } }))
                  }}
                  disabled={!!cfg.mixedSchedule?.unlimitedRotating}
                />
                <label className="flex items-center gap-1.5 text-[11px] text-gray-400 whitespace-nowrap">
                  <input type="checkbox" className="accent-brand-400"
                    checked={!!cfg.mixedSchedule?.unlimitedRotating || cfg.mixedSchedule?.maxRotating == null}
                    onChange={e => {
                      const unlim = e.target.checked
                      setCfg(c => ({ ...c, mixedSchedule: { ...(c.mixedSchedule || {}), unlimitedRotating: unlim, maxRotating: unlim ? null : (c.mixedSchedule?.maxRotating || 1) } }))
                    }}
                  />
                  Ilimitados
                </label>
              </div>
              <p className="text-[10px] text-gray-600 font-mono mt-1">Vacío o "Ilimitados" = sin tope. El sistema bloquea registrar más mixtos que el tope definido.</p>
            </div>
            <div className="text-[11px] text-brand-300/80 bg-brand-400/5 border border-brand-400/20 rounded-lg p-2.5 leading-snug">
              💡 Los empleados mixtos aparecen en la pestaña <strong>Planificador</strong>. El gerente los agenda cada semana (ideal: el día del corte).
            </div>
          </div>
        )}
      </div>

      {/* Tabla de vacaciones — colapsada por default. Solo se expone si el admin la expande a proposito */}
      <div className="card">
        <button
          type="button"
          onClick={() => setShowVacTable(v => !v)}
          className="w-full flex items-center justify-between text-left"
          aria-expanded={showVacTable}
        >
          <div>
            <p className="text-xs font-mono text-gray-500 uppercase tracking-wider">Tabla de vacaciones (avanzado)</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              {cfg.vacationTable
                ? 'Usando tabla personalizada. Click para editar.'
                : 'Usando LFT 2023 por default. Click para sobrescribir (opcional).'}
            </p>
          </div>
          <span className={`text-gray-500 transition-transform ${showVacTable ? 'rotate-90' : ''}`}>▶</span>
        </button>

        {showVacTable && (
          <div className="mt-4 pt-4 border-t border-dark-border">
            <div className="flex items-center justify-between mb-3 gap-2">
              <p className="text-xs text-gray-400">
                Dias sugeridos segun la LFT 2023. Puedes ajustarlos; si bajas del minimo aparecera una advertencia al asignar vacaciones.
              </p>
              {cfg.vacationTable && (
                <button onClick={resetVacTableToLFT} className="shrink-0 px-2.5 py-1 bg-dark-700 border border-dark-border rounded-lg text-[10px] font-bold text-gray-400">
                  ↻ LFT default
                </button>
              )}
            </div>
            <div className="grid grid-cols-3 gap-2 mb-1">
              <span className="text-[10px] font-mono text-gray-500 uppercase">Desde</span>
              <span className="text-[10px] font-mono text-gray-500 uppercase">Hasta</span>
              <span className="text-[10px] font-mono text-gray-500 uppercase">Dias</span>
            </div>
            <div className="space-y-1.5">
              {getVacTable().map((row, idx) => (
                <div key={idx} className="grid grid-cols-3 gap-2 items-center">
                  <input type="number" min="1" max="50" className="input py-1.5 text-sm text-center" value={row.fromYear}
                    onChange={e => setVacTableRow(idx, 'fromYear', e.target.value)} />
                  <input type="number" min="1" max="999" className="input py-1.5 text-sm text-center" value={row.toYear === 999 ? '∞' : row.toYear}
                    onChange={e => setVacTableRow(idx, 'toYear', e.target.value === '∞' ? 999 : e.target.value)} />
                  <input type="number" min="1" max="365" className="input py-1.5 text-sm text-center text-brand-400 font-bold" value={row.days}
                    onChange={e => setVacTableRow(idx, 'days', e.target.value)} />
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <button onClick={save} disabled={saving}
        className="w-full md:w-auto flex items-center gap-1.5 px-5 py-2.5 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40">
        {saving ? '...' : '✓ Guardar empresa'}
      </button>

      {/* ── Zona de peligro: borrar cuenta ────────────────────────────────── */}
      <DangerZone tenantName={tenant?.name || ''} />
    </div>
  )
}

// ── Zona de peligro: eliminar cuenta + empresa ──────────────────────────────
// Requiere doble confirmación: (1) escribir el nombre exacto de la empresa,
// (2) contraseña válida. El POST/DELETE al /api/account/delete re-autentica
// con signInWithPassword antes de tocar nada.
function DangerZone({ tenantName: fallbackName }) {
  const [open, setOpen] = useState(false)
  const [preview, setPreview] = useState(null)
  const [loadingPreview, setLoadingPreview] = useState(false)
  const [confirmName, setConfirmName] = useState('')
  const [password, setPassword] = useState('')
  const [deleting, setDeleting] = useState(false)

  async function openModal() {
    setOpen(true)
    setConfirmName('')
    setPassword('')
    setPreview(null)
    setLoadingPreview(true)
    try {
      const r = await fetch('/api/account/delete')
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo cargar el resumen')
        setOpen(false)
        return
      }
      setPreview(j)
    } catch (e) {
      console.error('[danger] preview error:', e)
      toast.error('Error de red al cargar el resumen')
      setOpen(false)
    } finally {
      setLoadingPreview(false)
    }
  }

  function closeModal() {
    if (deleting) return
    setOpen(false)
  }

  const expectedName = (preview?.tenant_name || fallbackName || '').trim()
  const nameMatches = expectedName.length > 0 &&
    confirmName.trim().toLowerCase() === expectedName.toLowerCase()
  const canDelete = !deleting && nameMatches && password.length > 0

  async function doDelete() {
    if (!canDelete) return
    setDeleting(true)
    try {
      const r = await fetch('/api/account/delete', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      const j = await r.json().catch(() => ({}))
      if (!r.ok) {
        toast.error(j.error || 'No se pudo eliminar la cuenta')
        setDeleting(false)
        return
      }
      toast.success('Cuenta eliminada')
      // Cerrar sesión en el cliente y mandar a la landing.
      const supabase = createClient()
      try { await supabase.auth.signOut() } catch {}
      setTimeout(() => { window.location.href = '/' }, 1200)
    } catch (e) {
      console.error('[danger] delete error:', e)
      toast.error('Error de red al eliminar')
      setDeleting(false)
    }
  }

  return (
    <>
      {/* Trigger sutil: solo un link pequeño. Toda la advertencia vive en el modal. */}
      <div className="mt-10 pt-4 border-t border-dark-border flex justify-center">
        <button
          type="button"
          onClick={openModal}
          className="text-xs font-mono text-gray-600 hover:text-red-400 transition-colors underline underline-offset-2"
        >
          Eliminar cuenta
        </button>
      </div>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4 overflow-y-auto"
          onClick={closeModal}
        >
          <div
            className="bg-dark-800 border border-red-500/40 rounded-2xl max-w-md w-full p-5 space-y-4 my-8"
            onClick={e => e.stopPropagation()}
          >
            <div>
              <h3 className="text-lg font-extrabold text-red-400">⚠️ Eliminar cuenta</h3>
              <p className="text-xs text-gray-500 font-mono mt-0.5">ESTA ACCIÓN ES PERMANENTE E IRREVERSIBLE</p>
            </div>

            {loadingPreview ? (
              <p className="text-sm text-gray-400 font-mono">Cargando resumen…</p>
            ) : preview ? (
              <>
                <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 text-xs space-y-1.5">
                  <p className="text-red-400 font-bold mb-1">Se borrará permanentemente:</p>
                  <p className="text-gray-300">🏢 La empresa <span className="text-white font-bold">{preview.tenant_name || '(sin nombre)'}</span></p>
                  <p className="text-gray-300">📍 <span className="text-white font-bold">{preview.counts.branches}</span> sucursal(es)</p>
                  <p className="text-gray-300">👥 <span className="text-white font-bold">{preview.counts.employees}</span> empleado(s)</p>
                  <p className="text-gray-300">📅 <span className="text-white font-bold">{preview.counts.shifts}</span> turno(s)</p>
                  <p className="text-gray-300">🧾 <span className="text-white font-bold">{preview.counts.cuts}</span> corte(s) de nómina</p>
                  <p className="text-gray-300">🏖️ <span className="text-white font-bold">{preview.counts.vacations}</span> periodo(s) de vacaciones</p>
                  <p className="text-gray-300">📋 <span className="text-white font-bold">{preview.counts.audits}</span> registro(s) de bitácora</p>
                  <p className="text-gray-300">🔑 <span className="text-white font-bold">{preview.counts.profiles}</span> cuenta(s) de admin/gerente</p>
                  <p className="text-orange-400 pt-1.5 border-t border-red-500/20 mt-1.5">
                    🔓 El email <span className="font-bold text-white">{preview.owner_email || ''}</span> queda libre para registrarse de nuevo.
                  </p>
                </div>

                <div>
                  <label className="text-[11px] font-mono text-gray-500 uppercase tracking-wider">
                    Escribe el nombre EXACTO de la empresa para confirmar
                  </label>
                  <input
                    className="input mt-1 text-sm"
                    placeholder={expectedName}
                    value={confirmName}
                    onChange={e => setConfirmName(e.target.value)}
                    autoComplete="off"
                    spellCheck={false}
                    disabled={deleting}
                  />
                  {confirmName && !nameMatches && (
                    <p className="text-[10px] text-orange-400 font-mono mt-1">
                      Debe coincidir con: <span className="text-white">{expectedName}</span>
                    </p>
                  )}
                </div>

                <div>
                  <label className="text-[11px] font-mono text-gray-500 uppercase tracking-wider">
                    Contraseña de tu cuenta
                  </label>
                  <input
                    className="input mt-1 text-sm"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    autoComplete="current-password"
                    disabled={deleting}
                  />
                  <p className="text-[10px] text-gray-600 font-mono mt-1">
                    Se valida contra Supabase Auth antes de borrar nada.
                  </p>
                </div>

                <div className="flex gap-2 pt-2">
                  <button
                    type="button"
                    onClick={closeModal}
                    disabled={deleting}
                    className="flex-1 px-4 py-2 bg-dark-700 border border-dark-border text-gray-300 text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-50"
                  >
                    Cancelar
                  </button>
                  <button
                    type="button"
                    onClick={doDelete}
                    disabled={!canDelete}
                    className="flex-1 px-4 py-2 bg-red-500 text-white text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-30 disabled:cursor-not-allowed"
                  >
                    {deleting ? '⏳ Eliminando…' : 'Eliminar definitivamente'}
                  </button>
                </div>
              </>
            ) : (
              <p className="text-sm text-red-400 font-mono">No se pudo cargar el resumen.</p>
            )}
          </div>
        </div>
      )}
    </>
  )
}

// ── Tab: Branches list ────────────────────────────────────────────────────────
function BranchesTab({ branches, isOwner, myBranchId, onOpen, onChanged }) {
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')

  async function createBranch() {
    if (!newName.trim()) { toast.error('Nombre requerido'); return }
    setCreating(true)
    const r = await fetch('/api/branches', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newName.trim() })
    })
    const d = await r.json()
    setCreating(false)
    if (!r.ok) { toast.error(d.error || 'No se pudo crear la sucursal'); return }
    toast.success('Sucursal creada')
    setNewName('')
    onChanged?.()
  }

  async function deleteBranch(id, name) {
    if (!confirm(`¿Eliminar "${name}"?\n\nLos empleados y jornadas de esta sucursal se eliminarán en cascada.`)) return
    const r = await fetch(`/api/branches/${id}`, { method: 'DELETE' })
    const d = await r.json()
    if (!r.ok) { toast.error(d.error || 'No se pudo eliminar'); return }
    toast.success('Sucursal eliminada')
    onChanged?.()
  }

  const visible = isOwner ? branches : branches.filter(b => b.id === myBranchId)

  return (
    <div className="space-y-3">
      {visible.length === 0 && (
        <div className="card text-center py-8 text-gray-600 text-sm font-mono">
          <div className="text-3xl mb-2">🏢</div>
          {isOwner ? 'Aún no hay sucursales. Crea la primera abajo.' : 'No tienes sucursal asignada.'}
        </div>
      )}

      {visible.map(b => (
        <div key={b.id} className="card flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-bold text-white truncate">{b.name}</div>
            <div className="text-[10px] text-gray-500 font-mono mt-0.5">
              {b.config?.location?.name || 'Sin ubicación'}
              {b.config?.ip ? <span className="text-brand-400/70"> · 🌐 {b.config.ip}</span> : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <button onClick={() => onOpen(b.id)}
              className="px-3 py-1.5 bg-brand-400 text-black text-xs font-bold rounded-lg active:brightness-90">
              Abrir →
            </button>
            {isOwner && visible.length > 1 && (
              <button onClick={() => deleteBranch(b.id, b.name)}
                className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg" title="Eliminar">🗑</button>
            )}
          </div>
        </div>
      ))}

      {isOwner && (
        <div className="card">
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Agregar sucursal</p>
          <div className="flex gap-2">
            <input className="input text-sm flex-1" placeholder="Nombre (ej. Centro, Norte)"
              value={newName} onChange={e => setNewName(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && createBranch()} />
            <button onClick={createBranch} disabled={creating}
              className="px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40 shrink-0">
              {creating ? '...' : '+ Crear'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Branch detail page ───────────────────────────────────────────────────────
function BranchDetail({ branch, origin, tenantSlug, canEditName, onBack, onSaved }) {
  const [name, setName] = useState(branch.name)
  const [cfg, setCfg] = useState(branch.config || {})
  const [saving, setSaving] = useState(false)
  const [locating, setLocating] = useState(false)
  const [newHol, setNewHol] = useState({ name: '', date: '' })
  const [newRest, setNewRest] = useState({ name: '', date: '' })

  const F = (k, v) => setCfg(c => ({ ...c, [k]: v }))
  const FL = (k, v) => setCfg(c => ({ ...c, location: { ...(c.location || {}), [k]: v } }))
  const FH = (day, k, v) => setCfg(c => ({ ...c, businessHours: { ...(c.businessHours || {}), [day]: { ...(c.businessHours?.[day] || {}), [k]: v } } }))

  function captureLocation() {
    if (!navigator.geolocation) { toast.error('Tu navegador no soporta geolocalización'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude, accuracy } = pos.coords
        FL('lat', +latitude.toFixed(6))
        FL('lng', +longitude.toFixed(6))
        setLocating(false)
        toast.success(`📍 Ubicación capturada (precisión ±${Math.round(accuracy)}m)`)
      },
      err => {
        setLocating(false)
        toast.error(err.code === 1
          ? 'Permiso de ubicación denegado. Actívalo en el navegador.'
          : 'No se pudo obtener la ubicación. Asegúrate de estar al aire libre.')
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    )
  }

  function addHoliday() {
    if (!newHol.name || !newHol.date) { toast.error('Nombre y fecha'); return }
    F('holidays', [...(cfg.holidays || []), { id: crypto.randomUUID(), name: newHol.name, date: newHol.date }])
    setNewHol({ name: '', date: '' })
  }
  function removeHoliday(id) { F('holidays', (cfg.holidays || []).filter(h => h.id !== id)) }
  function addRestDay() {
    if (!newRest.name || !newRest.date) { toast.error('Nombre y fecha'); return }
    F('restDays', [...(cfg.restDays || []), { id: crypto.randomUUID(), name: newRest.name, date: newRest.date }])
    setNewRest({ name: '', date: '' })
  }
  function removeRestDay(id) { F('restDays', (cfg.restDays || []).filter(r => r.id !== id)) }

  async function detectIp() {
    try {
      const r = await fetch('/api/check/ip')
      const { ip } = await r.json()
      F('ip', ip)
      F('ipDetectedAt', new Date().toISOString())
      toast.success(`IP registrada: ${ip}`)
    } catch { toast.error('No se pudo detectar la IP') }
  }

  async function save() {
    setSaving(true)
    const body = { config: cfg }
    if (canEditName && name.trim() && name !== branch.name) body.name = name.trim()
    const r = await fetch(`/api/branches/${branch.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    })
    const d = await r.json()
    setSaving(false)
    if (!r.ok) { toast.error(d.error || 'No se pudo guardar'); return }
    toast.success('Sucursal guardada')
    await onSaved?.()
  }

  const checkUrl = `${origin}/check?tenant=${tenantSlug}&branch=${branch.id}`
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(checkUrl)}&size=200x200&bgcolor=0d0d0d&color=3DFFA0&qzone=2`

  return (
    <div className="p-5 md:p-6 max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-4 gap-2">
        <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white">
          ← Volver a sucursales
        </button>
        <button onClick={save} disabled={saving}
          className="px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40">
          {saving ? '...' : '✓ Guardar'}
        </button>
      </div>

      <div className="mb-5">
        {canEditName ? (
          <input className="input text-2xl font-extrabold bg-transparent border-0 border-b border-dark-border rounded-none px-0 focus:border-brand-400"
            value={name} onChange={e => setName(e.target.value)} />
        ) : (
          <h1 className="text-2xl font-extrabold text-white">{branch.name}</h1>
        )}
        <p className="text-gray-500 text-xs font-mono mt-0.5">CONFIGURACIÓN DE ESTA SUCURSAL</p>
      </div>

      {/* QR + URL */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Código QR para empleados</p>
      <div className="card mb-4 flex gap-4 items-start">
        <div className="shrink-0 p-2 bg-dark-700 border border-dark-border rounded-xl">
          <img src={qrSrc} alt="QR" width={112} height={112} className="rounded-lg" />
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <p className="text-[10px] text-gray-500 font-mono break-all leading-relaxed">{checkUrl}</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={() => navigator.clipboard.writeText(checkUrl).then(() => toast.success('URL copiada'))}
              className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-xs font-semibold text-white active:bg-dark-600">📋 Copiar URL</button>
            <a href={checkUrl} target="_blank" rel="noreferrer"
              className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-xs font-semibold text-white active:bg-dark-600">↗ Abrir checador</a>
          </div>
        </div>
      </div>

      {/* GPS */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Ubicación GPS</p>
      <div className="card mb-4 space-y-3">
        <div>
          <label className="label">Nombre del lugar</label>
          <input className="input" value={cfg.location?.name || ''} onChange={e => FL('name', e.target.value)} placeholder="Oficina principal" />
        </div>

        <button onClick={captureLocation} disabled={locating}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40">
          {locating ? '📡 Obteniendo...' : '📍 Usar mi ubicación actual'}
        </button>
        <p className="text-[10px] text-gray-600 font-mono -mt-2">
          Párate en el punto exacto de la sucursal y toca el botón. Tu navegador pedirá permiso.
        </p>

        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="label">Latitud</label>
            <input className="input" type="number" step="any" value={cfg.location?.lat || ''} onChange={e => FL('lat', parseFloat(e.target.value) || 0)} />
          </div>
          <div>
            <label className="label">Longitud</label>
            <input className="input" type="number" step="any" value={cfg.location?.lng || ''} onChange={e => FL('lng', parseFloat(e.target.value) || 0)} />
          </div>
        </div>

        <div>
          <label className="label flex items-center justify-between">
            <span>Radio permitido</span>
            <span className="text-brand-400 font-mono text-sm">{cfg.location?.radius || 300} m</span>
          </label>
          <input type="range" min="30" max="1000" step="10"
            value={cfg.location?.radius || 300} onChange={e => FL('radius', parseInt(e.target.value))}
            className="w-full accent-brand-400" />
          <div className="flex justify-between text-[10px] text-gray-600 font-mono mt-1">
            <span>30 m</span><span>1 km</span>
          </div>
        </div>
      </div>

      {/* Time & tolerance */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Tiempo y tolerancia</p>
      <div className="card mb-4 space-y-3">
        <div>
          <label className="label">Tolerancia de entrada (minutos)</label>
          <input className="input" type="number" min="0" max="60" value={cfg.toleranceMinutes ?? 10} onChange={e => F('toleranceMinutes', parseInt(e.target.value) || 0)} />
        </div>
        <div>
          <label className="label">Alerta jornada abierta (horas)</label>
          <input className="input" type="number" min="1" max="24" value={cfg.alertHours ?? 8} onChange={e => F('alertHours', parseInt(e.target.value) || 8)} />
        </div>
        <div>
          <label className="label">Día de cierre de semana</label>
          <select className="input" value={cfg.weekClosingDay || 'dom'} onChange={e => F('weekClosingDay', e.target.value)}>
            {DAYS.map(d => <option key={d} value={d}>{DAY_FL[d]}</option>)}
          </select>
        </div>
      </div>

      {/* Business hours */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Horario del establecimiento</p>
      <div className="card mb-4">
        {DAYS.map(day => {
          const h = cfg.businessHours?.[day] || { open: false, start: '08:00', end: '20:00' }
          return (
            <div key={day} className="flex items-center gap-2 mb-2 last:mb-0">
              <span className={`font-mono text-xs w-7 font-bold ${h.open ? 'text-white' : 'text-gray-600'}`}>{DAY_L[day]}</span>
              <button onClick={() => FH(day, 'open', !h.open)}
                className={`w-9 h-5 rounded-full relative transition-colors shrink-0 ${h.open ? 'bg-brand-400' : 'bg-dark-600'}`}>
                <div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 transition-all ${h.open ? 'left-5' : 'left-0.5'}`} />
              </button>
              {h.open ? <>
                <input type="time" className="input py-1.5 px-2 text-xs flex-1" value={h.start} onChange={e => FH(day, 'start', e.target.value)} />
                <span className="text-gray-600 text-xs">–</span>
                <input type="time" className="input py-1.5 px-2 text-xs flex-1" value={h.end} onChange={e => FH(day, 'end', e.target.value)} />
              </> : <span className="text-xs text-gray-600 font-mono flex-1">Cerrado</span>}
            </div>
          )
        })}
      </div>

      {/* Holidays */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Días feriados <span className="normal-case text-gray-600">(pago ×3)</span></p>
      <div className="card mb-4">
        {(cfg.holidays || []).length === 0 && <p className="text-gray-600 text-xs font-mono mb-3">Sin feriados registrados</p>}
        {(cfg.holidays || []).map(h => (
          <div key={h.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
            <div><div className="font-semibold text-sm text-white">{h.name}</div><div className="text-xs text-gray-500 font-mono">{h.date} · ×3</div></div>
            <button onClick={() => removeHoliday(h.id)} className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg">🗑</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <input className="input text-sm py-2" placeholder="Nombre" value={newHol.name} onChange={e => setNewHol(f => ({ ...f, name: e.target.value }))} />
          <input className="input text-sm py-2" type="date" value={newHol.date} onChange={e => setNewHol(f => ({ ...f, date: e.target.value }))} />
        </div>
        <button onClick={addHoliday} className="mt-2 w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white active:bg-dark-600">+ Agregar feriado</button>
      </div>

      {/* Rest days */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Días de descanso colectivo <span className="normal-case text-gray-600">(día libre pagado)</span></p>
      <div className="card mb-4">
        {(cfg.restDays || []).length === 0 && <p className="text-gray-600 text-xs font-mono mb-3">Sin días registrados</p>}
        {(cfg.restDays || []).map(r => (
          <div key={r.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
            <div><div className="font-semibold text-sm text-white">{r.name}</div><div className="text-xs text-gray-500 font-mono">{r.date}</div></div>
            <button onClick={() => removeRestDay(r.id)} className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg">🗑</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <input className="input text-sm py-2" placeholder="Nombre" value={newRest.name} onChange={e => setNewRest(f => ({ ...f, name: e.target.value }))} />
          <input className="input text-sm py-2" type="date" value={newRest.date} onChange={e => setNewRest(f => ({ ...f, date: e.target.value }))} />
        </div>
        <button onClick={addRestDay} className="mt-2 w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white active:bg-dark-600">+ Agregar día</button>
      </div>

      {/* WiFi / IP lock */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Red WiFi (2do candado)</p>
      <div className="card mb-4">
        <div className="flex items-center justify-between">
          <div>
            {cfg.ip
              ? <p className="text-xs text-brand-400 font-mono">🌐 {cfg.ip}</p>
              : <p className="text-[10px] text-gray-600">Sin IP registrada — solo GPS</p>}
          </div>
          <button onClick={detectIp} className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-xs font-semibold text-white active:bg-dark-600">
            {cfg.ip ? '↻ Actualizar' : '📡 Detectar'}
          </button>
        </div>
        <p className="text-[9px] text-gray-600 font-mono mt-2">Toca "Detectar" mientras estés conectado al WiFi de esta sucursal.</p>
      </div>

      {/* Printing — owner only (manager has no preview anyway) */}
      {canEditName && (
        <>
          <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Hoja impresa de esta sucursal</p>
          <div className="card mb-4 space-y-3">
            <div>
              <label className="label">Encabezado</label>
              <input className="input text-sm" value={cfg.printHeader || ''} onChange={e => F('printHeader', e.target.value)} placeholder="Nombre de la sucursal" />
            </div>
            <div>
              <label className="label">Texto legal</label>
              <textarea className="input text-xs" rows={3} value={cfg.printLegalText || ''} onChange={e => F('printLegalText', e.target.value)} placeholder="Texto que aparece al pie de las hojas impresas de esta sucursal" />
            </div>
            <div>
              <label className="label">Pie</label>
              <input className="input text-sm" value={cfg.printFooter || ''} onChange={e => F('printFooter', e.target.value)} placeholder="Teléfono, dirección, etc." />
            </div>
          </div>
        </>
      )}

      <button onClick={save} disabled={saving}
        className="w-full flex items-center justify-center gap-1.5 px-5 py-3 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40">
        {saving ? '...' : '✓ Guardar sucursal'}
      </button>
    </div>
  )
}

// ── Tab: Team / invitations (owner-only) ─────────────────────────────────────
function TeamTab({ branches, onChanged }) {
  const [invs, setInvs] = useState([])
  const [loading, setLoading] = useState(true)
  const [form, setForm] = useState({ email: '', branchId: branches[0]?.id || '' })
  const [sending, setSending] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const r = await fetch('/api/invite')
    const d = await r.json()
    setInvs(d.invitations || [])
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  async function invite() {
    if (!form.email || !form.email.includes('@')) { toast.error('Correo inválido'); return }
    if (!form.branchId) { toast.error('Elige una sucursal'); return }
    setSending(true)
    const r = await fetch('/api/invite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: form.email, branchId: form.branchId })
    })
    const d = await r.json()
    setSending(false)
    if (!r.ok) {
      toast.error(d.error || 'No se pudo invitar')
      if (d.manualLink) {
        navigator.clipboard.writeText(d.manualLink).then(() => toast('Link copiado — mándaselo manualmente', { icon: '📋' }))
      }
      return
    }
    toast.success('Invitación enviada')
    setForm({ email: '', branchId: branches[0]?.id || '' })
    load()
  }

  async function cancel(id) {
    if (!confirm('¿Cancelar esta invitación?')) return
    const r = await fetch(`/api/invite?id=${id}`, { method: 'DELETE' })
    if (!r.ok) { toast.error('No se pudo cancelar'); return }
    toast.success('Invitación cancelada')
    load()
  }

  return (
    <div className="space-y-4">
      <div className="card space-y-3">
        <p className="text-sm font-bold text-white">Invitar gerente</p>
        <p className="text-xs text-gray-500">El gerente sólo podrá gestionar empleados, asistencia y nómina de su sucursal. No podrá crear sucursales ni cambiar la identidad de la empresa.</p>
        <div>
          <label className="label">Correo del gerente</label>
          <input className="input" type="email" value={form.email} placeholder="gerente@tuempresa.com"
            onChange={e => setForm(f => ({ ...f, email: e.target.value }))} />
        </div>
        <div>
          <label className="label">Sucursal asignada</label>
          <select className="input" value={form.branchId} onChange={e => setForm(f => ({ ...f, branchId: e.target.value }))}>
            <option value="">— Elegir sucursal —</option>
            {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>
        <button onClick={invite} disabled={sending}
          className="w-full md:w-auto px-5 py-2.5 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40">
          {sending ? 'Enviando...' : 'Enviar invitación'}
        </button>
      </div>

      <div>
        <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Invitaciones activas</p>
        {loading && <p className="text-xs text-gray-500 font-mono">Cargando...</p>}
        {!loading && invs.length === 0 && <p className="text-xs text-gray-600 font-mono">Sin invitaciones activas.</p>}
        {invs.map(i => {
          const branch = branches.find(b => b.id === i.branch_id)
          const expired = new Date(i.expires_at) < new Date()
          return (
            <div key={i.id} className="card flex items-center justify-between gap-2 mb-2">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-white truncate">{i.email}</div>
                <div className="text-[10px] text-gray-500 font-mono">
                  {branch?.name || 'Sucursal eliminada'} · {i.accepted_at ? '✓ Aceptada' : expired ? '⏱ Expirada' : '⏳ Pendiente'}
                </div>
              </div>
              {!i.accepted_at && (
                <button onClick={() => cancel(i.id)} className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg">🗑</button>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
