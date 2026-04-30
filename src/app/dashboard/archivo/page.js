// src/app/dashboard/archivo/page.js
'use client'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase'

const KIND_LABEL = {
  employee: 'Por empleado',
  branch: 'Por sucursal',
  manifest: 'PDF maestro',
}

const KIND_ICON = {
  employee: 'EMP',
  branch: 'SUC',
  manifest: 'PDF',
}

// Devuelve {start, end} de la semana ISO que contiene la fecha (lunes a domingo)
function getWeekRange(d = new Date()) {
  const date = new Date(d)
  const day = date.getDay() // 0=dom, 1=lun
  const diffToMonday = (day + 6) % 7 // lun=0, dom=6
  const monday = new Date(date)
  monday.setDate(date.getDate() - diffToMonday)
  const sunday = new Date(monday)
  sunday.setDate(monday.getDate() + 6)
  const fmt = (x) => x.toISOString().slice(0, 10)
  return { start: fmt(monday), end: fmt(sunday) }
}

export default function ArchivoPage() {
  const [files, setFiles] = useState([])
  const [employees, setEmployees] = useState([])
  const [loading, setLoading] = useState(true)
  const [year, setYear] = useState(new Date().getFullYear())
  const [kind, setKind] = useState('')
  const [employeeId, setEmployeeId] = useState('')
  const [busyPath, setBusyPath] = useState('')
  const [error, setError] = useState('')
  const [isManager, setIsManager] = useState(false)

  const lastWeek = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 7)
    return getWeekRange(d)
  })()

  const [weekStart, setWeekStart] = useState(lastWeek.start)
  const [weekEnd, setWeekEnd] = useState(lastWeek.end)
  const [generating, setGenerating] = useState(false)
  const [genResult, setGenResult] = useState(null)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, kind, employeeId])

  async function load() {
    setLoading(true)
    setError('')
    try {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      if (!user) {
        setError('Sesion expirada')
        return
      }
      const { data: profile } = await supabase
        .from('profiles')
        .select('tenant_id, role, branch_id')
        .eq('id', user.id)
        .single()
      if (!profile) {
        setError('Perfil no encontrado')
        return
      }

      const managerScoped = profile.role === 'manager' && !!profile.branch_id
      setIsManager(managerScoped)

      let empQuery = supabase
        .from('employees')
        .select('id, name, employee_code')
        .eq('tenant_id', profile.tenant_id)
        .order('employee_code')
      // FIX: gerente solo ve empleados de su sucursal.
      if (managerScoped) empQuery = empQuery.eq('branch_id', profile.branch_id)
      const { data: emps } = await empQuery
      setEmployees(emps || [])

      if (managerScoped) {
        // FIX: archive_files es tenant-wide y no trae branch_id; no exponer paquetes globales al gerente.
        setFiles([])
        return
      }

      let q = supabase
        .from('archive_files')
        .select('*')
        .eq('tenant_id', profile.tenant_id)
        .eq('year', year)
        .order('week', { ascending: false })
        .order('kind')
        .limit(500)
      if (kind) q = q.eq('kind', kind)
      if (employeeId) q = q.eq('employee_id', employeeId)

      const { data, error: qErr } = await q
      if (qErr) throw qErr
      setFiles(data || [])
    } catch (err) {
      setError(err?.message || 'Error cargando archivos')
    } finally {
      setLoading(false)
    }
  }

  async function generate() {
    setGenerating(true)
    setGenResult(null)
    setError('')
    try {
      const res = await fetch('/api/archive/generate-week', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ weekStart, weekEnd }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || `Error ${res.status}`)
      setGenResult(json)
      await load()
    } catch (err) {
      setError(err?.message || 'Error generando paquete')
    } finally {
      setGenerating(false)
    }
  }

  async function download(path) {
    setBusyPath(path)
    try {
      const res = await fetch(`/api/archive/download?path=${encodeURIComponent(path)}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error || 'Error')
      window.open(json.url, '_blank')
    } catch (err) {
      setError(err?.message || 'Error generando link')
    } finally {
      setBusyPath('')
    }
  }

  const byWeek = files.reduce((acc, f) => {
    const key = `${f.year}-W${String(f.week).padStart(2, '0')}`
    if (!acc[key]) acc[key] = { key, year: f.year, week: f.week, weekStart: f.week_start, weekEnd: f.week_end, items: [] }
    acc[key].items.push(f)
    return acc
  }, {})
  const weeks = Object.values(byWeek).sort((a, b) => b.week - a.week)

  return (
    <div className="bg-dark-900 text-white p-4 sm:p-6 min-h-screen">
      <div className="max-w-6xl mx-auto">
        <div className="mb-6">
          <h1 className="text-2xl font-bold mb-1">Archivo histórico</h1>
          <p className="text-sm text-slate-400">
            Registros laborales firmados con SHA-256. Retención 5 años (CFF art. 30).
          </p>
        </div>

        {error && (
          <div className="mb-4 rounded-lg bg-red-500/10 border border-red-500/30 p-3 text-red-300 text-sm">
            {error}
          </div>
        )}

        {/* Generador */}
        {!isManager && <div className="rounded-xl bg-slate-800/60 border border-slate-700 p-4 mb-6">
          <div className="font-semibold mb-2">Archivar semana</div>
          <p className="text-xs text-slate-400 mb-3">
            Genera un paquete con XLSX por empleado + XLSX por sucursal + PDF maestro con hash SHA-256.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Semana desde</label>
              <input
                type="date"
                value={weekStart}
                onChange={(e) => setWeekStart(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Hasta</label>
              <input
                type="date"
                value={weekEnd}
                onChange={(e) => setWeekEnd(e.target.value)}
                className="rounded-lg bg-slate-900 border border-slate-700 px-3 py-2 text-sm"
              />
            </div>
            <button
              onClick={generate}
              disabled={generating}
              className="rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 text-sm font-medium"
            >
              {generating ? 'Generando...' : 'Archivar semana'}
            </button>
          </div>
          {genResult && (
            <div className="mt-3 text-sm text-emerald-300">
              Paquete creado: {genResult.filesGenerated} archivos en {genResult.basePath}
            </div>
          )}
        </div>}

        {/* Filtros */}
        <div className="flex flex-wrap gap-3 mb-4">
          <select
            value={year}
            onChange={(e) => setYear(Number(e.target.value))}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
          >
            {[0, 1, 2, 3, 4].map((offset) => {
              const y = new Date().getFullYear() - offset
              return <option key={y} value={y}>{y}</option>
            })}
          </select>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value)}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
          >
            <option value="">Todos los tipos</option>
            <option value="employee">Por empleado</option>
            <option value="branch">Por sucursal</option>
            <option value="manifest">PDF maestro</option>
          </select>
          <select
            value={employeeId}
            onChange={(e) => setEmployeeId(e.target.value)}
            className="rounded-lg bg-slate-800 border border-slate-700 px-3 py-2 text-sm"
          >
            <option value="">Todos los empleados</option>
            {employees.map((e) => (
              <option key={e.id} value={e.id}>
                {e.employee_code} · {e.name}
              </option>
            ))}
          </select>
          <button
            onClick={load}
            className="rounded-lg bg-slate-700 hover:bg-slate-600 px-3 py-2 text-sm"
          >
            Refrescar
          </button>
        </div>

        {loading ? (
          <div className="text-slate-400">Cargando...</div>
        ) : isManager ? (
          <div className="text-slate-400 text-center py-12">
            Archivo historico disponible solo para propietario. Los paquetes actuales no tienen alcance por sucursal.
          </div>
        ) : weeks.length === 0 ? (
          <div className="text-slate-400 text-center py-12">
            No hay archivos para estos filtros. Genera el primero arriba.
          </div>
        ) : (
          <div className="space-y-4">
            {weeks.map((w) => (
              <div key={w.key} className="rounded-xl bg-slate-800/60 border border-slate-700 p-4">
                <div className="flex items-center justify-between mb-3">
                  <div>
                    <div className="font-semibold">Semana {w.week} · {w.year}</div>
                    <div className="text-xs text-slate-400">
                      {w.weekStart} a {w.weekEnd} · {w.items.length} archivos
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
                  {w.items.map((f) => (
                    <button
                      key={f.id}
                      onClick={() => download(f.path)}
                      disabled={busyPath === f.path}
                      className="text-left rounded-lg bg-slate-900/60 border border-slate-700 hover:border-slate-500 p-3 text-sm disabled:opacity-50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-mono text-xs text-slate-400 mb-1">
                            {KIND_ICON[f.kind]} · {KIND_LABEL[f.kind]}
                          </div>
                          <div className="truncate font-medium">
                            {f.path.split('/').slice(-2).join('/')}
                          </div>
                          <div className="text-xs text-slate-500 mt-1">
                            {(f.size_bytes / 1024).toFixed(1)} KB
                          </div>
                        </div>
                        <span className="text-xs text-blue-400 whitespace-nowrap">
                          {busyPath === f.path ? '...' : 'Descargar'}
                        </span>
                      </div>
                      <div className="font-mono text-[10px] text-slate-600 mt-2 truncate">
                        {f.sha256}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
