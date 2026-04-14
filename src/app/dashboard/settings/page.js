'use client'
// src/app/dashboard/settings/page.js
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { DAYS, DAY_L, DAY_FL } from '@/lib/utils'
import toast from 'react-hot-toast'

const FALLBACK_URL = 'https://checkpro-self.vercel.app'

export default function SettingsPage() {
  const [cfg, setCfg] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [tenantSlug, setTenantSlug] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newHol, setNewHol] = useState({ name: '', date: '' })
  const [newRest, setNewRest] = useState({ name: '', date: '' })
  const [newBranch, setNewBranch] = useState('')
  const [origin, setOrigin] = useState(FALLBACK_URL)

  useEffect(() => { setOrigin(window.location.origin) }, [])

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)
    const { data: tenant } = await supabase.from('tenants').select('config,slug').eq('id', prof.tenant_id).single()
    setCfg(tenant?.config || {})
    setTenantSlug(tenant?.slug || '')
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const F = (k, v) => setCfg(c => ({ ...c, [k]: v }))
  const FL = (k, v) => setCfg(c => ({ ...c, location: { ...c.location, [k]: v } }))
  const FH = (day, k, v) => setCfg(c => ({ ...c, businessHours: { ...c.businessHours, [day]: { ...c.businessHours?.[day], [k]: v } } }))

  async function save() {
    setSaving(true)
    const supabase = createClient()
    await supabase.from('tenants').update({ config: cfg }).eq('id', tenantId)
    toast.success('Configuración guardada')
    setSaving(false)
  }

  // ── Branches ──────────────────────────────────────────────────────────────
  function addBranch() {
    if (!newBranch.trim()) { toast.error('Escribe el nombre de la sucursal'); return }
    const branch = { id: crypto.randomUUID(), name: newBranch.trim() }
    setCfg(c => ({ ...c, branches: [...(c.branches || []), branch] }))
    setNewBranch('')
    toast('Guarda la configuración para que persista', { icon: '💾' })
  }

  function removeBranch(id) {
    if (!confirm('¿Eliminar esta sucursal? Los empleados asignados quedarán sin sucursal.')) return
    setCfg(c => ({ ...c, branches: (c.branches || []).filter(b => b.id !== id) }))
  }

  function branchCheckUrl(branchId) {
    return `${origin}/check?tenant=${tenantSlug}&branch=${branchId}`
  }

  function branchQrImgSrc(branchId, size = 200) {
    const data = encodeURIComponent(branchCheckUrl(branchId))
    return `https://api.qrserver.com/v1/create-qr-code/?data=${data}&size=${size}x${size}&bgcolor=0d0d0d&color=3DFFA0&qzone=2`
  }

  function copyBranchUrl(branchId) {
    navigator.clipboard.writeText(branchCheckUrl(branchId)).then(() => toast.success('URL copiada'))
  }

  function printBranchQr(branchId, branchName) {
    const imgSrc = `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(branchCheckUrl(branchId))}&size=600x600&bgcolor=ffffff&color=000000&qzone=2`
    const win = window.open('', '_blank')
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/><title>QR ${branchName}</title></head>
    <body style="text-align:center;font-family:Arial,sans-serif;padding:40px;background:#fff">
      <h2 style="font-size:22pt;margin-bottom:4px">${branchName}</h2>
      <p style="color:#555;font-size:12pt;margin-top:0">Escanea con tu celular para registrar asistencia</p>
      <img src="${imgSrc}" style="width:280px;height:280px;margin:20px auto;display:block;border:4px solid #000;border-radius:8px"/>
      <p style="font-size:9pt;color:#888;font-family:monospace;word-break:break-all;max-width:400px;margin:0 auto">${branchCheckUrl(branchId)}</p>
      <script>window.onload=function(){window.print()}</script>
    </body></html>`)
    win.document.close()
  }

  // ── Holidays / Rest days ──────────────────────────────────────────────────
  function addHoliday() {
    if (!newHol.name || !newHol.date) { toast.error('Ingresa nombre y fecha'); return }
    const holidays = [...(cfg.holidays || []), { id: crypto.randomUUID(), name: newHol.name, date: newHol.date }]
    setCfg(c => ({ ...c, holidays }))
    setNewHol({ name: '', date: '' })
  }

  function removeHoliday(id) { setCfg(c => ({ ...c, holidays: c.holidays.filter(h => h.id !== id) })) }

  function addRestDay() {
    if (!newRest.name || !newRest.date) { toast.error('Ingresa nombre y fecha'); return }
    const restDays = [...(cfg.restDays || []), { id: crypto.randomUUID(), name: newRest.name, date: newRest.date }]
    setCfg(c => ({ ...c, restDays }))
    setNewRest({ name: '', date: '' })
  }

  function removeRestDay(id) { setCfg(c => ({ ...c, restDays: c.restDays.filter(r => r.id !== id) })) }

  if (loading || !cfg) return <div className="p-6 text-gray-500 font-mono text-sm">Cargando...</div>

  const branches = cfg.branches || []

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-end justify-between mb-5">
        <div>
          <h1 className="text-2xl font-extrabold text-white">Configuración</h1>
          <p className="text-gray-500 text-xs font-mono mt-0.5">PARÁMETROS DEL SISTEMA</p>
        </div>
        <button onClick={save} disabled={saving}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40">
          {saving ? '...' : '✓ Guardar'}
        </button>
      </div>

      {/* ── Sucursales + QR ─────────────────────────────────────────────── */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Sucursales y Códigos QR</p>
      <div className="card mb-4">
        <p className="text-xs text-gray-400 mb-4">
          Cada sucursal tiene su propio código QR. Los empleados lo escanean con su celular para abrir el checador automáticamente.
        </p>

        {branches.length === 0 && (
          <div className="text-center py-6 text-gray-600 text-sm font-mono">
            <div className="text-3xl mb-2">🏢</div>
            Aún no hay sucursales. Agrega la primera abajo.
          </div>
        )}

        {branches.map(b => (
          <div key={b.id} className="mb-5 pb-5 border-b border-dark-border last:border-0 last:mb-0 last:pb-0">
            <div className="flex items-center justify-between mb-3">
              <span className="font-bold text-white">{b.name}</span>
              <button onClick={() => removeBranch(b.id)}
                className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg">🗑</button>
            </div>
            <div className="flex gap-4 items-start">
              {/* QR inline */}
              <div className="shrink-0 p-2 bg-dark-700 border border-dark-border rounded-xl">
                {tenantSlug
                  ? <img src={branchQrImgSrc(b.id)} alt={`QR ${b.name}`} width={112} height={112} className="rounded-lg" />
                  : <div className="w-28 h-28 flex items-center justify-center text-[10px] text-gray-600 text-center px-2">
                      Guarda para ver QR
                    </div>
                }
              </div>
              <div className="flex-1 min-w-0 space-y-2">
                {tenantSlug && (
                  <p className="text-[10px] text-gray-500 font-mono break-all leading-relaxed">
                    {branchCheckUrl(b.id)}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <button onClick={() => copyBranchUrl(b.id)}
                    className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-xs font-semibold text-white active:bg-dark-600">
                    📋 Copiar URL
                  </button>
                  <button onClick={() => printBranchQr(b.id, b.name)}
                    className="px-3 py-1.5 bg-dark-700 border border-dark-border rounded-lg text-xs font-semibold text-white active:bg-dark-600">
                    🖨️ Imprimir QR
                  </button>
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Add branch */}
        <div className="flex gap-2 mt-3">
          <input
            className="input text-sm flex-1"
            placeholder="Nombre de sucursal (ej. Centro, Norte...)"
            value={newBranch}
            onChange={e => setNewBranch(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && addBranch()}
          />
          <button onClick={addBranch}
            className="px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 shrink-0">
            + Agregar
          </button>
        </div>
        <p className="text-[10px] text-gray-600 font-mono mt-2">
          💾 Recuerda tocar "Guardar" para que las sucursales queden registradas.
        </p>
      </div>

      {/* ── Tiempo ─────────────────────────────────────────────────────────── */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Tiempo y tolerancia</p>
      <div className="card mb-4 space-y-3">
        <div>
          <label className="label">Tolerancia de entrada (minutos)</label>
          <input className="input" type="number" min="0" max="60"
            value={cfg.toleranceMinutes || 10} onChange={e => F('toleranceMinutes', parseInt(e.target.value) || 0)} />
        </div>
        <div>
          <label className="label">Alerta jornada abierta (horas)</label>
          <input className="input" type="number" min="1" max="24"
            value={cfg.alertHours || 8} onChange={e => F('alertHours', parseInt(e.target.value) || 8)} />
        </div>
        <div>
          <label className="label">Día de cierre de semana</label>
          <select className="input" value={cfg.weekClosingDay || 'dom'} onChange={e => F('weekClosingDay', e.target.value)}>
            {DAYS.map(d => <option key={d} value={d}>{DAY_FL[d]}</option>)}
          </select>
        </div>
      </div>

      {/* ── GPS ────────────────────────────────────────────────────────────── */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">Ubicación GPS autorizada</p>
      <div className="card mb-4 space-y-3">
        <div>
          <label className="label">Nombre del lugar</label>
          <input className="input" value={cfg.location?.name || ''} onChange={e => FL('name', e.target.value)} placeholder="Oficina Principal" />
        </div>
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
          <label className="label">Radio permitido (metros)</label>
          <input className="input" type="number" value={cfg.location?.radius || 300} onChange={e => FL('radius', parseInt(e.target.value) || 100)} />
        </div>
        <div className="bg-dark-700 border border-dark-border rounded-xl p-3 text-xs text-gray-500 font-mono">
          💡 Para obtener las coordenadas: abre maps.google.com desde la sucursal, haz clic derecho en el punto exacto y copia las coordenadas.
        </div>
      </div>

      {/* ── Horario del establecimiento ─────────────────────────────────────── */}
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

      {/* ── Días feriados ──────────────────────────────────────────────────── */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">
        Días feriados <span className="normal-case text-gray-600">(pago ×3)</span>
      </p>
      <div className="card mb-4">
        {(cfg.holidays || []).length === 0 && <p className="text-gray-600 text-xs font-mono mb-3">Sin feriados registrados</p>}
        {(cfg.holidays || []).map(h => (
          <div key={h.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
            <div>
              <div className="font-semibold text-sm text-white">{h.name}</div>
              <div className="text-xs text-gray-500 font-mono">{h.date} · ×3</div>
            </div>
            <button onClick={() => removeHoliday(h.id)} className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg">🗑</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <input className="input text-sm py-2" placeholder="Nombre" value={newHol.name} onChange={e => setNewHol(f => ({ ...f, name: e.target.value }))} />
          <input className="input text-sm py-2" type="date" value={newHol.date} onChange={e => setNewHol(f => ({ ...f, date: e.target.value }))} />
        </div>
        <button onClick={addHoliday} className="mt-2 w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white active:bg-dark-600">
          + Agregar feriado
        </button>
      </div>

      {/* ── Días de descanso colectivo ─────────────────────────────────────── */}
      <p className="text-xs font-mono text-gray-500 uppercase tracking-wider mb-2">
        Días de descanso colectivo <span className="normal-case text-gray-600">(día libre pagado)</span>
      </p>
      <div className="card mb-4">
        {(cfg.restDays || []).length === 0 && <p className="text-gray-600 text-xs font-mono mb-3">Sin días registrados</p>}
        {(cfg.restDays || []).map(r => (
          <div key={r.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
            <div>
              <div className="font-semibold text-sm text-white">{r.name}</div>
              <div className="text-xs text-gray-500 font-mono">{r.date}</div>
            </div>
            <button onClick={() => removeRestDay(r.id)} className="p-1.5 text-red-400 text-xs active:bg-red-500/10 rounded-lg">🗑</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <input className="input text-sm py-2" placeholder="Nombre" value={newRest.name} onChange={e => setNewRest(f => ({ ...f, name: e.target.value }))} />
          <input className="input text-sm py-2" type="date" value={newRest.date} onChange={e => setNewRest(f => ({ ...f, date: e.target.value }))} />
        </div>
        <button onClick={addRestDay} className="mt-2 w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white active:bg-dark-600">
          + Agregar día
        </button>
      </div>

      <p className="text-center text-xs font-mono text-gray-600 mb-4">CheckPro v1.0 · SaaS · Todos los derechos reservados</p>
    </div>
  )
}
