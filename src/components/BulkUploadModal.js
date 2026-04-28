'use client'
// src/components/BulkUploadModal.js
// Modal de 3 pasos para carga masiva de empleados:
//   Paso 1 — elegir sucursal + descargar plantilla + subir archivo
//   Paso 2 — preview de validación (server valida contra BD)
//   Paso 3 — confirmación + importación
//
// SheetJS (xlsx) se importa dinámicamente para no inflar el bundle inicial
// del dashboard (la librería pesa ~600KB minificada).

import { useState, useMemo, useRef } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  FileText,
  FolderOpen,
} from 'lucide-react'
import {
  TEMPLATE_COLUMNS,
  TEMPLATE_LABELS,
  TEMPLATE_HELP,
  TEMPLATE_EXAMPLE_ROW,
  parseSheetData,
  validateRows,
} from '@/lib/bulk-employees'

export default function BulkUploadModal({ branches, onClose, onImported }) {
  const [step, setStep] = useState(1)
  const [branchId, setBranchId] = useState('')
  const [fileName, setFileName] = useState('')
  const [rawRows, setRawRows] = useState([])          // filas normalizadas por header pero sin validar
  const [results, setResults] = useState([])          // salida de /api/employees/bulk-validate
  const [working, setWorking] = useState(false)
  const [summary, setSummary] = useState(null)        // { valid, errors, duplicates }
  const fileInputRef = useRef(null)

  const selectedBranch = useMemo(
    () => branches.find(b => b.id === branchId) || null,
    [branches, branchId]
  )

  // ── Paso 1: descargar plantilla ────────────────────────────────────────────
  async function downloadTemplate() {
    try {
      const XLSX = await import('xlsx')
      const wb = XLSX.utils.book_new()

      // Hoja 1: "Empleados" con header + 1 fila de ejemplo
      const header = TEMPLATE_COLUMNS.map(c => TEMPLATE_LABELS[c])
      const exampleRow = TEMPLATE_COLUMNS.map(c => TEMPLATE_EXAMPLE_ROW[c] ?? '')
      const ws1 = XLSX.utils.aoa_to_sheet([header, exampleRow])
      // Anchos aproximados para que se vea legible al abrir
      ws1['!cols'] = TEMPLATE_COLUMNS.map(c => ({ wch: Math.max(12, c.length + 2) }))
      XLSX.utils.book_append_sheet(wb, ws1, 'Empleados')

      // Hoja 2: "Instrucciones" con ayuda por columna
      const helpRows = [
        ['Columna', 'Descripción'],
        ...TEMPLATE_HELP,
        [],
        ['Notas generales', ''],
        ['', 'Borra la fila de ejemplo antes de subir el archivo.'],
        ['', 'Puedes dejar "codigo" vacío para que el sistema los genere en orden.'],
        ['', 'Los días sin horario (inicio y fin vacíos) se consideran descanso.'],
        ['', 'Formato de hora: HH:MM en 24h (ej. 09:00, 18:30).'],
        ['', 'Formato de fecha: YYYY-MM-DD (ej. 2026-04-21).'],
      ]
      const ws2 = XLSX.utils.aoa_to_sheet(helpRows)
      ws2['!cols'] = [{ wch: 22 }, { wch: 70 }]
      XLSX.utils.book_append_sheet(wb, ws2, 'Instrucciones')

      // Descargar
      XLSX.writeFile(wb, 'plantilla_empleados_checkpro.xlsx')
      toast.success('Plantilla descargada')
    } catch (e) {
      console.error('[bulk-upload] template error', e)
      toast.error('No se pudo generar la plantilla')
    }
  }

  // ── Paso 1 → 2: leer archivo, parsear y llamar al validador server ─────────
  async function handleFile(file) {
    if (!file) return
    if (!branchId) { toast.error('Selecciona una sucursal primero'); return }
    setFileName(file.name)
    setWorking(true)
    try {
      const XLSX = await import('xlsx')
      const buf = await file.arrayBuffer()
      // cellDates:true para que Excel Date cells lleguen como Date objects
      const wb = XLSX.read(buf, { type: 'array', cellDates: true })
      const firstSheet = wb.Sheets[wb.SheetNames[0]]
      if (!firstSheet) { toast.error('Archivo vacío'); setWorking(false); return }
      const aoa = XLSX.utils.sheet_to_json(firstSheet, { header: 1, raw: false, defval: '' })
      const { rows } = parseSheetData(aoa)

      if (rows.length === 0) {
        toast.error('El archivo no tiene filas de datos')
        setWorking(false)
        return
      }
      if (rows.length > 500) {
        toast.error('Máximo 500 empleados por archivo')
        setWorking(false)
        return
      }

      setRawRows(rows)

      // Llamar al validador server (comprueba duplicados contra BD)
      const res = await fetch('/api/employees/bulk-validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows, branch_id: branchId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Error validando archivo')
        setWorking(false)
        return
      }
      setResults(body.results || [])
      setSummary(body.summary || null)
      setStep(2)
    } catch (e) {
      console.error('[bulk-upload] parse error', e)
      toast.error('No se pudo leer el archivo')
    } finally {
      setWorking(false)
    }
  }

  // ── Paso 2 → 3: confirmar importación ─────────────────────────────────────
  async function confirmImport() {
    setWorking(true)
    try {
      const res = await fetch('/api/employees/bulk-create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rows: rawRows, branch_id: branchId }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(body.error || 'Error al importar')
        setWorking(false)
        return
      }
      toast.success(`${body.created || 0} empleados creados`)
      setStep(3)
      onImported?.(body)
    } catch (e) {
      console.error('[bulk-upload] create error', e)
      toast.error('Error al importar')
    } finally {
      setWorking(false)
    }
  }

  const hasBranches = branches && branches.length > 0

  return (
    <div className="fixed inset-0 bg-black/75 z-[60] flex flex-col justify-end">
      <div className="bg-dark-800 rounded-t-2xl overflow-y-auto overscroll-contain no-scrollbar"
        style={{ height: '90vh', touchAction: 'pan-y' }}>
        <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-4" />
        <div className="px-5 pb-10">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-bold text-white">Carga masiva de empleados</h3>
            <button onClick={onClose} className="text-gray-500 text-2xl leading-none px-2">×</button>
          </div>

          {/* Steps indicator */}
          <div className="flex items-center gap-2 mb-5 text-[10px] font-mono">
            <StepDot n={1} label="Archivo" active={step >= 1} done={step > 1} />
            <div className="flex-1 h-px bg-dark-border" />
            <StepDot n={2} label="Validar" active={step >= 2} done={step > 2} />
            <div className="flex-1 h-px bg-dark-border" />
            <StepDot n={3} label="Listo" active={step >= 3} done={step > 3} />
          </div>

          {/* ── PASO 1 ────────────────────────────────────────────────────── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="label" htmlFor="bulk-branch">
                  Sucursal de destino <span className="text-red-400">*</span>
                </label>
                {hasBranches ? (
                  <select id="bulk-branch" className="input" value={branchId} onChange={e => setBranchId(e.target.value)}>
                    <option value="">— Selecciona una sucursal —</option>
                    {branches.map(b => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                ) : (
                  <div className="input bg-dark-700 text-orange-400 text-xs flex items-center gap-1">
                    <AlertTriangle size={16} /> Configura sucursales primero
                  </div>
                )}
                <p className="text-[10px] text-gray-600 font-mono mt-1">
                  Todos los empleados del archivo se crearán en esta sucursal.
                </p>
              </div>

              <div className="p-4 bg-dark-700 border border-dark-border rounded-xl">
                <p className="text-sm font-semibold text-white mb-1">1. Descarga la plantilla</p>
                <p className="text-xs text-gray-500 mb-3">
                  Llena el Excel con tus empleados. La hoja "Instrucciones" explica cada columna.
                </p>
                <button onClick={downloadTemplate}
                  className="w-full px-4 py-2.5 bg-brand-400/15 border border-brand-400/30 rounded-xl text-brand-400 text-sm font-bold active:bg-brand-400/25">
                  <Download size={16} className="inline-block mr-1" /> Descargar plantilla .xlsx
                </button>
              </div>

              <div className="p-4 bg-dark-700 border border-dark-border rounded-xl">
                <p className="text-sm font-semibold text-white mb-1">2. Sube tu archivo lleno</p>
                <p className="text-xs text-gray-500 mb-3">
                  Aceptamos .xlsx, .xls y .csv. Máximo 500 empleados por archivo.
                </p>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={e => handleFile(e.target.files?.[0])}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={!branchId || working}
                  className="w-full px-4 py-2.5 bg-brand-400 text-black text-sm font-bold rounded-xl active:brightness-90 disabled:opacity-40 disabled:cursor-not-allowed">
                  {working ? 'Validando...' : (fileName
                    ? <span className="flex items-center justify-center gap-1"><FileText size={16} />{fileName}</span>
                    : <span className="flex items-center justify-center gap-1"><FolderOpen size={16} />Seleccionar archivo</span>
                  )}
                </button>
                {!branchId && (
                  <p className="text-[10px] text-orange-400 font-mono mt-2">Selecciona una sucursal antes de subir.</p>
                )}
              </div>
            </div>
          )}

          {/* ── PASO 2 ────────────────────────────────────────────────────── */}
          {step === 2 && (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <StatBox label="Válidos" value={summary?.valid ?? 0} color="green" />
                <StatBox label="Duplicados" value={summary?.duplicates ?? 0} color="yellow" />
                <StatBox label="Con errores" value={summary?.errors ?? 0} color="red" />
              </div>

              {selectedBranch && (
                <p className="text-xs text-gray-500 font-mono flex items-center gap-1">
                  Destino: <span className="text-brand-400 flex items-center gap-1"><Building2 size={16} />{selectedBranch.name}</span>
                </p>
              )}

              <div className="border border-dark-border rounded-xl overflow-hidden">
                <div className="max-h-[50vh] overflow-y-auto overflow-x-auto">
                  <table className="w-full min-w-[520px] text-xs">
                    <thead className="bg-dark-700 sticky top-0">
                      <tr>
                        <th className="text-left p-2 font-mono text-gray-500">#</th>
                        <th className="text-left p-2 font-mono text-gray-500">Nombre</th>
                        <th className="text-left p-2 font-mono text-gray-500">PIN</th>
                        <th className="text-left p-2 font-mono text-gray-500">Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {results.map((r, i) => {
                        const color =
                          r.status === 'valid'     ? 'bg-green-500/5 border-green-500/10' :
                          r.status === 'duplicate' ? 'bg-yellow-500/5 border-yellow-500/10' :
                                                     'bg-red-500/5 border-red-500/10'
                        const badge =
                          r.status === 'valid'     ? { bg:'bg-green-500/15 text-green-400 border-green-500/30', text:'Listo' } :
                          r.status === 'duplicate' ? { bg:'bg-yellow-500/15 text-yellow-400 border-yellow-500/30', text:'Duplicado · omitir' } :
                                                     { bg:'bg-red-500/15 text-red-400 border-red-500/30', text:'Error' }
                        return (
                          <tr key={i} className={`border-b border-dark-border ${color}`}>
                            <td className="p-2 font-mono text-gray-500">{r.rowIndex || i + 2}</td>
                            <td className="p-2 text-white">{r.normalized?.nombre || <span className="text-gray-600 italic">—</span>}</td>
                            <td className="p-2 font-mono text-gray-400">{r.normalized?.pin || '—'}</td>
                            <td className="p-2">
                              <span className={`inline-block px-2 py-0.5 rounded-full border text-[10px] font-bold ${badge.bg}`}>
                                {badge.text}
                              </span>
                              {r.errors?.length > 0 && (
                                <div className="text-[10px] text-red-400 mt-1">{r.errors.join(' · ')}</div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={confirmImport}
                  disabled={working || (summary?.valid ?? 0) === 0}
                  className="btn-primary">
                  {working ? 'Importando...' : `Importar ${summary?.valid ?? 0} empleados`}
                </button>
                <button onClick={() => { setStep(1); setResults([]); setSummary(null); setFileName('') }}
                  className="btn-ghost">
                  Atrás
                </button>
              </div>
            </div>
          )}

          {/* ── PASO 3 ────────────────────────────────────────────────────── */}
          {step === 3 && (
            <div className="text-center py-10">
              <div className="mb-3 flex justify-center"><CheckCircle2 size={48} className="text-green-400" /></div>
              <p className="text-white font-bold text-lg mb-1">Importación completada</p>
              <p className="text-gray-500 text-sm mb-6">
                Los empleados ya aparecen en tu lista.
              </p>
              <button onClick={onClose} className="btn-primary">Cerrar</button>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function StepDot({ n, label, active, done }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
        ${done ? 'bg-green-500/20 text-green-400 border border-green-500/40'
               : active ? 'bg-brand-400 text-black' : 'bg-dark-700 text-gray-600 border border-dark-border'}`}>
        {done ? '✓' : n}
      </div>
      <span className={active ? 'text-white' : 'text-gray-600'}>{label}</span>
    </div>
  )
}

function StatBox({ label, value, color }) {
  const palette = {
    green: 'bg-green-500/10 border-green-500/20 text-green-400',
    yellow: 'bg-yellow-500/10 border-yellow-500/20 text-yellow-400',
    red: 'bg-red-500/10 border-red-500/20 text-red-400',
  }[color]
  return (
    <div className={`px-3 py-2 rounded-xl border text-center ${palette}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-[10px] font-mono opacity-80">{label}</div>
    </div>
  )
}
