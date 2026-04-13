'use client'
import { useState, useEffect, useCallback } from 'react'
import { createClient } from '@/lib/supabase'
import { DAYS, DAY_L, monthlyToHourly, generateEmployeeCode } from '@/lib/utils'
import toast from 'react-hot-toast'

const DEF_SCHED = DAYS.reduce((a,d) => ({...a, [d]: { work: !['sab','dom'].includes(d), start: '09:00', end: '18:00' }}), {})

export default function EmployeesPage() {
  const [emps, setEmps] = useState([])
  const [loading, setLoading] = useState(true)
  const [tenantId, setTenantId] = useState(null)
  const [sheet, setSheet] = useState(null)
  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const F = (k,v) => setForm(f => ({...f,[k]:v}))
  const FS = (day,k,v) => setForm(f => ({...f,schedule: {...f.schedule,[day]:{...f.schedule?.[day],[k]:v}}}))

  const load = useCallback(async () => {
    const supabase = createClient()
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return
    const { data: prof } = await supabase.from('profiles').select('tenant_id').eq('id', session.user.id).single()
    if (!prof?.tenant_id) return
    setTenantId(prof.tenant_id)
    const { data } = await supabase.from('employees').select('*').eq('tenant_id', prof.tenant_id).neq('status','deleted').order('employee_code')
    setEmps(data||[])
    setLoading(false)
  }, [])
  useEffect(() => { load() }, [load])

  async function save() {
    if (!form.name || !form.pin) { toast.error('Nombre y PIN son obligatorios'); return }
    if (form.pin.length !== 4 || !/^\d{4}$/.test(form.pin)) { toast.error('PIN debe ser 4 dígitos'); return }
    setSaving(true)
    const supabase = createClient()
    const payload = { name: form.name, department: form.department||'', pin: form.pin, role_label: form.role_label||'Empleado', can_manage: form.can_manage||false, has_shift: form.has_shift!==false, monthly_salary: parseFloat(form.monthly_salary)||0, schedule: form.schedule||DEF_SCHED }
    try {
      if (sheet === 'add') {
        const code = generateEmployeeCode(emps)
        await supabase.from('employees').insert({ ...payload, tenant_id: tenantId, employee_code: code, status: 'active' })
        toast.success(`Empleado ${code} creado`)
      } else {
        await supabase.from('employees').update({ ...payload, status: form.status||'active' }).eq('id', form.id)
        toast.success('Empleado actualizado')
      }
      await load(); setSheet(null)
    } catch { toast.error('Error al guardar') }
    finally { setSaving(false) }
  }

  async function deactivate(emp) {
    if (!confirm(`¿Dar de baja a ${emp.name}?`)) return
    await createClient().from('employees').update({ status: 'deleted' }).eq('id', emp.id)
    toast.success('Baja registrada')
    await load()
  }

  return (
    <div className="p-4 md:p-6 max-w-2xl">
      <div className="flex items-end justify-between mb-5">
        <div><h1 className="text-2xl font-extrabold text-white">Empleados</h1></div>
        <button onClick={() => { setForm({ schedule: {...DEF_SCHED}, has_shift: true, can_manage: false, role_label: 'Empleado' }); setSheet('add') }} className="px-4 py-2 bg-brand-400 text-black text-sm font-bold rounded-xl">+ Agregar</button>
      </div>
      {loading ? <p className="text-gray-500 font-mono text-sm">Cargando...</p> : (
        <div className="space-y-2">
          {emps.length === 0 && <div className="card text-center py-10"><p className="text-gray-500">Sin empleados</p></div>}
          {emps.map(emp => (
            <div key={emp.id} className="card-sm flex items-center gap-3">
              <div className="w10 h-10 rounded-full bg-brand-400/10 text-brand-400 border border-brand-400/20 flex items-center justify-center text-sm font-bold shrink-0">{emp.name.split(' ').slice(0,2).map(w=>w[0]).join('')}</div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-sm text-white">{emp.name} <span className="text-xs font-mono text-gray-600">{emp.employee_code}</span></div>
                <div className="text-xs text-gray-500">{emp.department} · ${(emp.monthly_salary||0).toLocaleString()}/mes · ${monthlyToHourly(emp).toFixed(2)}/h</div>
              </div>
              <div className="flex gap-1.5">
                <button onClick={() => { setForm({...emp}); setSheet('edit') }} className="p-2 bg-dark-700 border border-dark-border rounded-lg text-gray-400">✏️</button>
                <button onClick={() => deactivate(emp)} className="p-2 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">🗑</button>
              </div>
            </div>
          ))}
        </div>
      )}
      {sheet && (
        <div className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end">
          <div className="bg-dark-800 rounded-t-2xl overflow-y-scroll no-scrollbar" style={{height:'85vh'}}>
            <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-4"/>
            <div className="px-5 pb-10">
              <h3 className="text-lg font-bold text-white mb-4">{sheet==='add'?'Nuevo Empleado':'Editar Empleado'}</h3>
              <div className="space-y-3">
                <div><label className="label">Nombre completo</label><input className="input" value={form.name||''} onChange={e=>F('name',e.target.value)} placeholder="Juan Pérez"/></div>
                <div><label className="label">Departamento</label><input className="input" value={form.department||''} onChange={e=>F('department',e.target.value)} placeholder="Cocina,Caja..."/></div>
                <div><label className="label">PIN (4 dígitos)</label><input className="input" inputMode="numeric" maxLength={4} value={form.pin||''} onChange={e=>F('pin',e.target.value)} placeholder="1234"/></div>
                <div><label className="label">Salario mensual ($)</label><input className="input" type="number" value={form.monthly_salary||''} onChange={e=>F('monthly_salary',e.target.value)} placeholder="15000"/></div>
                <div className="flex items-center justify-between py-2">
                  <span className="text-sm text-white">Puede gestionar</span>
                  <button onClick={()=>F('can_manage',!form.can_manage)} className={`w-10 h-6 rounded-full relative ${form.can_manage?'bg-brand-400':'bg-dark-600'}`}><div className={`w-4 h-4 bg-white rounded-full absolute top-1 ${form.can_manage?'left-5':'left-1'}`}/></button>
                </div>
                <div className="border-t border-dark-border pt-3">
                  <p className="label mb-3">Horario semanal</p>
                  {DAYS.map(day => {
                    const s = form.schedule?.[day] || { work: false, start: '09:00', end: '18:00' }
                    return (
                      <div key={day} className="flex items-center gap-2 mb-2">
                        <span className="font-mono text-xs w-7">{DAY_L[day]}</span>
                        <button onClick={()=>FS(day,'work',!s.work)} className={`w-9 h-5 rounded-full relative shrink-0 ${s.work?'bg-brand-400':'bg-dark-600'}`}><div className={`w-3.5 h-3.5 bg-white rounded-full absolute top-0.5 ${s.work?'left-5':'left-0.5'}`}/></button>
                        {s.work ? <><in-put type="time" className="input py-1.5 px-2 text-xs flex-1" value={s.start} onChange={e=>FS(day,'start',e.target.value)}/><span className="text-gray-600 text-xs">–</span><in-put type="time" className="input py-1.5 px-2 text-xs flex-1" value={s.end} onChange={e=>FS(day,'end',e.target.value)}/></> : <span className="text-xs text-gray-600 flex-1">Descanso</span>}
                      </div>
                    )
                  })}
                </div>
                <div className="flex gap-2 pt-2">
                  <button onClick={save} disabled={saving} className="btn-primary">{saving?'Guardando...':'Guardar'}</button>
                  <button onClick={()=>setSheet(null)} className="btn-ghost">Cancelar</button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
