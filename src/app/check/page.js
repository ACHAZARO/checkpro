'use client'
import { useState, useEffect, useCallback } from 'react'
import { haversineMeters, fmtTime, fmtDate, classifyEntry, isoDate } from '@/lib/utils'
import toast from 'react-hot-toast'
import Link from 'next/link'

export default function CheckPage() {
  const [cfg, setCfg] = useState(null)
  const [tenantId, setTenantId] = useState(null)
  const [step, setStep] = useState('id')
  const [empCode, setEmpCode] = useState('')
  const [foundEmp, setFoundEmp] = useState(null)
  const [openShift, setOpenShift] = useState(null)
  const [msg, setMsg] = useState(null)
  const [busy, setBusy] = useState(false)
  const [gps, setGps] = useState({ status: 'idle', valid: false, simulated: false })
  const [simMode, setSimMode] = useState(false)
  const [pin, setPin] = useState('')
  const [t, setT] = useState(new Date())

  useEffect(() => { const i = setInterval(()=>setT(new Date()),1000); return ()=>clearInterval(i) }, [])
  useEffect(() => {
    try { const d = JSON.parse(localStorage.getItem('checkpro_tenant')||'null'); if (d) { setTenantId(d.id); setCfg(d.config) } } catch {}
  }, [])

  const verifyGps = useCallback(() => {
    if (simMode && cfg) { setGps({ status:'ok', lat:cfg.location.lat, lng:cfg.location.lng, accuracy:5, dist:0, valid:true, simulated:true }); return }
    if (!navigator.geolocation) { setGps(g=>({...g,status:'error',error:'GPS no disponible'})); return }
    setGps(g=>({...g,status:'loading'}))
    navigator.geolocation.getCurrentPosition(
      pos => {
        if (!cfg) { setGps(g=>({...g,status:'error',error:'Sin configuracion'})); return }
        const { latitude:lat, longitude:lng, accuracy } = pos.coords
        const dist = Math.round(haversineMeters(lat, lng, cfg.location.lat, cfg.location.lng))
        setGps({ status:'ok', lat, lng, accuracy:Math.round(accuracy), dist, valid:dist<=cfg.location.radius, simulated:false })
      },
      err => setGps(g=>({...g,status:'error',error:'Error GPS'})),
      { enableHighAccuracy:true, timeout:10000, maximumAge:0 }
    )
  }, [simMode, cfg])

  const reset = () => { setStep('id'); setEmpCode(''); setFoundEmp(null); setOpenShift(null); setMsg(null); setPin('') }

  async function submitId() {
    if (!tenantId) { setMsg({type:'err',text:'Sistema no configurado'}); return }
    setBusy(true)
    try {
      const res = await fetch('/api/check/identify', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({tenantId, employeeCode:empCode.trim().toUpperCase()}) })
      const data = await res.json()
      if (!data.found) { setMsg({type:'err',text:'ID no encontrado'}); return }
      setFoundEmp(data.employee); setOpenShift(data.openShift); setStep('pin'); setMsg(null)
    } catch { setMsg({type:'err',text:'Error de conexion'}) }
    finally { setBusy(false) }
  }

  async function handlePin(currentPin) {
    if (!gps.valid) { setMsg({type:'warn',text:'Verifica tu ubicacion GPS primero'}); return }
    setBusy(true)
    try {
      const res = await fetch('/api/check/punch', { method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({ tenantId, employeeCode:empCode.trim().toUpperCase(), pin:currentPin, action:openShift?'out':'in', geo:{lat:gps.lat,lng:gps.lng,dist:gps.dist,accuracy:gps.accuracy,simulated:gps.simulated,valid:true} }) })
      const d = await res.json()
      if (d.ok) { toast.success(d.msg); setTimeout(reset, 3000) }
      else { toast.error(d.msg) }
      setMsg(d.ok ? {type:'ok',text:d.msg} : {type:'err',text:d.msg})
    } catch { toast.error('Error de conexion') }
    finally { setBusy(false); setPin('') }
  }

  if (!tenantId) return (
    <main className="min-h-dvh bg-dark-900 flex flex-col items-center justify-center px-5 text-center">
      <div className="text-4xl mb-4">⌚️</div>
      <h2 className="text-xl font-bold text-white mb-2">Checador no configurado</h2>
      <p className="text-gray-500 text-sm mb-6">El administrador debe configurar este dispositivo en Settings.</p>
      <Link href="/dashboard/settings" className="btn-primary max-w-xs">Ir a configuracion</Link>
    </main>
  )

  return (
    <main className="min-h-dvh bg-dark-900 flex flex-col max-w-[430px] mx-auto">
      <div className="flex-1 overflow-y-auto no-scrollbar pb-8">
        <div className="mx-3.5 mt-3.5 border border-brand-400/15 rounded-2xl text-center py-5">
          <div className="font-mono text-6xl font-semibold text-brand-400">{t.toLocaleTimeString('es-MX',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}</div>
          <div className="font-mono text-xs text-gray-500 mt-2">{fmtDate(t)}</div>
          {cfg?.location?.name && <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-dark-700 border border-dark-border rounded-full text-xs text-gray-500 font-mono">📍 {cfg.location.name}</div>}
        </div>
        <div className="px-4 pt-3">
          <div className="space-y-2 mb-4">
            <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border text-sm font-semibold ${gps.simulated?'bg-blue-500/10 border-blue-500/30 text-blue-400':gps.valid?'bg-brand-400/10 border-brand-400/20 text-brand-400':gps.status==='error'?'bg-red-500/10 border-red-500/20 text-red-400':'bg-dark-700 border-dark-border text-gray-500'}`}>
              <span>{gps.valid||gps.simulated?'✓':gps.status==='error'?'✗':gps.status==='loading'?'⏳':'📍'}</span>
              <span className="flex-1 text-xs">{gps.simulated?'Simulado - dentro del area':gps.status==='idle'?'Verifica tu ubicacion':gps.status==='loading'?'Obteniendo GPS...':gps.status==='error'?gps.error:gps.valid?`Dentro del area (${gps.dist}m)`:`Fuera del area (${gps.dist}m)`}</span>
              <button onClick={verifyGps} disabled={gps.status==='loading'} className="px-3 py-1.5 bg-dark-600 border border-dark-border rounded-lg text-xs font-bold text-white disabled:opacity-40">{gps.status==='loading'?'...':'↻'}</button>
            </div>
            <div className="flex items-center justify-between px-3 py-2 bg-dark-800 border border-dark-border rounded-lg">
              <span className="text-xs text-gray-500 font-mono">🧪 Modo simulacion</span>
              <button onClick={()=>setSimMode(m=>!m)} className={`w-10 h-6 rounded-full relative transition-colors ${simMode?'bg-brand-400':'bg-dark-600'}`}><div className={`w-4 h-4 bg-white rounded-full absolute top-1 transition-all ${simMode?'left-5':'left-1'}`}/></button>
            </div>
          </div>
          {step==='id' ? (
            <div className="card">
              <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">Identificacion</p>
              <label className="label">ID de Empleado</label>
              <input className="input text-center text-xl tracking-widest font-mono mb-3" placeholder="EMP001" value={empCode} onChange={e=>setEmpCode(e.target.value.toUpperCase())} onKeyDown={e=>e.key==='Enter'&&submitId()}/>
              <button onClick={submitId} disabled={busy||!empCode} className="btn-primary">{busy?'⏳ Buscando...':'Continuar →'}</button>
              {msg && <div className={`mt-3 px-4 py-3 rounded-xl text-sm ${msg.type==='err'?'bg-red-500/10 text-red-400':'bg-yellow-500/10 text-yellow-400'}`}>{msg.text}</div>}
            </div>
          ) : (
            <div className="card">
              <div className="text-center mb-5">
                <div className="w-14 h-14 rounded-full bg-brand-400/10 border-2 border-brand-400/20 flex items-center justify-center text-lg font-bold font-mono mx-auto mb-2.5 text-brand-400">{foundEmp?.name?.split(' ').slice(0,2).map(w=>w[0]).join('')}</div>
                <div className="font-bold text-lg text-white">{foundEmp?.name}</div>
                <div className="text-gray-500 text-xs mt-0.5">{foundEmp?.department} · {foundEmp?.role_label}</div>
                {openShift && <div className="inline-flex items-center gap-1.5 mt-2 px-3 py-1 bg-brand-400/10 border border-brand-400/20 rounded-full text-brand-400 text-xs font-semibold"><span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse"/>Jornada activa desde {fmtTime(openShift.entry_time)}</div>}
              </div>
              <p className="text-xs font-mono text-gray-500 uppercase tracking-widest mb-3">PIN de acceso</p>
              <div className="flex gap-3 justify-center mb-5">{[0,1,2,3].map(i=><div key={i} className={`w-3.5 h-3.5 rounded-full border-2 transition-all ${pin.length>i?'bg-brand-400 border-brand-400':'border-dark-500'}`}/>)}</div>
              <div className="grid grid-cols-3 gap-2 max-w-[220px] mx-auto">
                {[1,2,3,4,5,6,7,8,9].map(d=><button key={d} onClick={()=>{if(pin.length<4){const np=pin+d;setPin(np);if(np.length===4)handlePin(np)}}} className="bg-dark-700 border border-dark-border rounded-xl py-4 text-xl font-bold text-white active:scale-90 transition-all">{d}</button>)}
                <button onClick={()=>setPin('')} className="bg-dark-700 border border-dark-border rounded-xl py-4 text-xs font-bold text-gray-500">ESC</button>
                <button onClick={()=>{if(pin.length<4){const np=pin+'0';setPin(np);if(np.length===4)handlePin(np)}}} className="bg-dark-700 border border-dark-border rounded-xl py-4 text-xl font-bold text-white active:scale-90 transition-all">0</button>
                <button onClick={()=>setPin(p=>p.slice(0,-1))} className="bg-dark-700 border border-dark-border rounded-xl py-4 text-sm font-bold text-red-400 active:scale-90">⌫</button>
              </div>
              {!gps.valid && <div className="mt-4 px-4 py-3 bg-yellow-500/10 border border-yellow-500/20 rounded-xl text-yellow-400 text-xs font-semibold">⚠ Activa simulacion GPS o verifica tu ubicacion</div>}
              {busy && <div className="mt-3 text-center text-blue-400 text-sm font-mono">⏳ Procesando...</div>}
              {msg && <div className={`mt-3 px-4 py-3 rounded-xl text-sm font-semibold ${msg.type==='ok'?'bg-brand-400/10 text-brand-400':msg.type==='warn'?'bg-yellow-500/10 text-yellow-400':'bg-red-500/10 text-red-400'}`}>{msg.text}</div>}
              <button onClick={reset} className="mt-3 w-full py-2 text-xs text-gray-500 font-mono">Cancelar</button>
            </div>
          )}
        </div>
      </div>
    </main>
  )
}
