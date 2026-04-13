'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { DAYS, DAY_L, DAY_FL } from '@/lib/utils'
import toast from 'react-hot-toast'

export default function SettingsPage() {
  const [cfg, setCfg] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [tenantSlug, setTenantSlug] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [newHol, setNewHol] = useState({ name: '', date: '' })

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
  const FD7L = (k, v) => setCfg(c => ({ ...c, location: { ...c.location, [k]: v } }))

  async function save() {
    setSaving(true)
    await createClient().from('tenants').update({ config: cfg }).eq('id', tenantId)
    toast.success('Configuración guardada')
    setSaving(false)
  }

  function setupKiosk() {
    if (!tenantId || !cfg) { toast.error('Guarda la configuración primero'); return }
    localStorage.setItem('checkpro_tenant', JSON.stringify({ id: tenantId, config: cfg, slug: tenantSlug }))
    toast.success('Este dispositivo configurado como checador ✓')
  }

  function addHoliday() {
    if (!newHol.name || !newHol.date) { toast.error('Ingresa nombre y fecha'); return }
    setCfg(c => ({ ...c, holidays: [...(c.holidays||[]), { id: crypto.randomUUID(), ...newHol }] }))
    setNewHol({ name: '', date: '' })
  }

  if (loading || !cfg) return <div className="p-6 text-gray-500 font-mono">Cargando...</div>

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-end justify-between mb-5">
        <h1 className="text-2xl font-extrabold text-white">Configuración</h1>
        <button onClick={save} disabled={saving} className="px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl">{saving?'...':'✓ Guardar'}</button>
      </div>

      <p className="text-xs font-mono text-gray-500 uppercase mb-2">Sucursal</p>
      <div className="card mb-4">
        <label className="label">Nombre de la sucursal</label>
        <input className="input" value={cfg.branchName||''} onChange={e=>F('branchName',e.target.value)} placeholder="Mi Empresa"/>
      </div>

      <p className="text-xs font-mono text-gray-500 uppercase mb-2">Ubicación GPS</p>
      <div className="card mb-4 space-y-3">
        <div><label className="label">Nombre del lugar</label><input className="input" value={cfg.location?.name||''} onChange={e=>F1=('name',e.target.value)} placeholder="Oficina Principal"/></div>
        <div className="grid grid-cols-2 gap-2">
          <div><label className="label">Latitud</label><input className="input" type="number" step="any" value={cfg.location?.lat||''} onChange={e=>FL1('lat',parseFloat(e.target.value)||0)}/></div>
          <div><label className="label">Longitud</label><input className="input" type="number" step="any" value={cfg.location?.lng||''} onChange={e=>FL1('lng',parseFloat(e.target.value)||0)}/></div>
        </div>
        <div><label className="label">Radio (metros)</label><input className="input" type="number" value={cfg.location?.radius||300} onChange={e=>FL1('radius',parseInt(e.target.value)||300)}/></div>
        <p className="text-xs text-gray-500 font-mono">💡 Abre maps.google.com en la sucursal, haz clic derecho y copia las coordenadas</p>
      </div>

      <p className="text-xs font-mono text-gray-500 uppercase mb-2">Tiempo y tolerancia</p>
      <div className="card mb-4">
        <label className="label">Tolerancia de entrada (minutos)</label>
        <input className="input" type="number" min="0" max="60" value={cfg.toleranceMinutes||10} onChange={e=>F('toleranceMinutes',parseInt(e.target.value)||0)}/>
      </div>

      <p className="text-xs font-mono text-gray-500 uppercase mb-2">Días feriados (pago ×3)</p>
      <div className="card mb-4">
        {(cfg.holidays||[]).length === 0 && <p className="text-gray-600 text-xs font-mono mb-3">Sin feriados</p>}
        {(cfg.holidays||[]).map(h => (
          <div key={h.id} className="flex items-center justify-between py-2 border-b border-dark-border last:border-0">
            <div><div className="font-semibold text-sm text-white">{h.name}</div><div className="text-xs text-gray-500 font-mono">{h.date}</div></div>
            <button onClick={()=>setCfg(c => ({...c, holidays: c.holidays.filter(x => x.id !== h.id)}))} className="text-red-400 p-1.5">🗑</button>
          </div>
        ))}
        <div className="grid grid-cols-2 gap-2 mt-3">
          <input className="input text-sm py-2" placeholder="Nombre" value={newHol.name} onChange={e=>setNewHol(f=>({...f,name:e.target.value}))}/>
          <input className="input text-sm py-2" type="date" value={newHol.date} onChange={e=>setNewHol(f=>({...f,date:e.target.value}))}/>
        </div>
        <button onClick={addHoliday} className="mt-2 w-full py-2 bg-dark-700 border border-dark-border rounded-xl text-xs font-bold text-white">+ Agregar feriado</button>
      </div>

      <p className="text-xs font-mono text-gray-500 uppercase mb-2">Configurar checador (kiosk)</p>
      <div className="card mb-6">
        <p className="text-sm text-gray-400 mb-3">Abre esta pantalla en el dispositivo de checada y toca el botón.</p>
        <button onClick={setupKiosk} className="btn-primary">📍 Usar este dispositivo como checador</button>
        <div className="mt-3 p-3 bg-dark-700 border border-dark-border rounded-xl">
          <p className="text-xs font-mono text-gray-500 mb-1">URL del checador:</p>
          <p className="text-xs text-brand-400 font-mono break-all">{typeof window !== 'undefined' ? window.location.origin : ''}/check</p>
        </div>
      </div>
    </div>
  )
}
