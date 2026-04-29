'use client'
// src/components/HelpCenter.js
// Centro de ayuda reutilizable: buscador del manual (sin IA) + form de reporte.
// Lo usamos en /dashboard/settings (pestaña "Ayuda") y en /dashboard/help (ruta directa).
import { useState, useMemo, useRef, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import toast from 'react-hot-toast'
import { MANUAL_SECTIONS } from '@/lib/manual-sections'
import { useTheme } from '@/lib/ThemeContext'

// ── helpers de busqueda ────────────────────────────────────────────────────
function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // quita acentos para buscar "nómina" con "nomina"
}

function scoreSection(s, tokens) {
  if (tokens.length === 0) return 0
  const titleN = normalize(s.title)
  const bodyN = normalize(s.body)
  let score = 0
  for (const t of tokens) {
    if (!t) continue
    if (titleN.includes(t)) score += 10
    const matches = bodyN.split(t).length - 1
    score += matches
  }
  return score
}

function highlight(text, tokens) {
  if (!tokens.length) return text
  const pattern = tokens
    .filter(Boolean)
    .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('|')
  if (!pattern) return text
  const re = new RegExp(`(${pattern})`, 'gi')
  const parts = text.split(re)
  return parts.map((p, i) =>
    re.test(p)
      ? <mark key={i} className="bg-brand-400/30 text-brand-400 rounded px-0.5">{p}</mark>
      : <span key={i}>{p}</span>
  )
}

export default function HelpCenter() {
  const pathname = usePathname()
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  const [q, setQ] = useState('')
  const [audience, setAudience] = useState('todas') // 'todas' | 'admin' | 'empleado'
  const [expanded, setExpanded] = useState(() => new Set())

  const tokens = useMemo(
    () => normalize(q).split(/\s+/).filter(t => t.length >= 2),
    [q]
  )

  const filtered = useMemo(() => {
    let list = MANUAL_SECTIONS
    if (audience !== 'todas') list = list.filter(s => s.audience === audience)
    if (tokens.length === 0) return list
    return list
      .map(s => ({ ...s, _score: scoreSection(s, tokens) }))
      .filter(s => s._score > 0)
      .sort((a, b) => b._score - a._score)
  }, [tokens, audience])

  function toggle(key) {
    setExpanded(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }

  // ── formulario de reporte ───────────────────────────────────────────────
  const [kind, setKind] = useState('pregunta')
  const [title, setTitle] = useState('')
  const [desc, setDesc] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const formRef = useRef(null)

  useEffect(() => {
    if (!submitted && tokens.length > 0 && filtered.length === 0 && q.length > 3 && !title) {
      setTitle(q)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtered.length, q])

  async function submit(e) {
    e.preventDefault()
    if (submitting) return
    const t = title.trim()
    const d = desc.trim()
    if (t.length < 3) { toast.error('Escribe un titulo corto (min 3 caracteres)'); return }
    if (d.length < 10) { toast.error('Agrega mas detalle (min 10 caracteres)'); return }
    setSubmitting(true)
    try {
      const res = await fetch('/api/help/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          title: t,
          description: d,
          page_context: pathname,
          user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'No se pudo enviar')
        return
      }
      toast.success('Mensaje enviado. Gracias por ayudarnos a mejorar.')
      setSubmitted(true)
      setTitle(''); setDesc(''); setKind('pregunta')
    } finally {
      setSubmitting(false)
    }
  }

  const jumpToForm = () => {
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    setTimeout(() => formRef.current?.querySelector('input, select')?.focus(), 400)
  }

  const hasQuery = tokens.length > 0
  const showNothingFound = hasQuery && filtered.length === 0

  return (
    <div className="space-y-5">
      {/* ── Buscador del manual ────────────────────────────────────────── */}
      <div className="card space-y-4">
        <div>
          <label className="label">Busca en los manuales</label>
          <input
            className="input"
            type="search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Escribe tu duda: nómina, retardo, PIN, vacaciones…"
          />
          <div className="flex items-center gap-2 mt-3">
            {[
              ['todas', 'Todo'],
              ['admin', 'Manual del admin'],
              ['empleado', 'Manual del empleado'],
            ].map(([id, label]) => (
              <button
                key={id}
                onClick={() => setAudience(id)}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold border transition-colors ${
                  audience === id
                    ? 'bg-brand-400/10 border-brand-400/40 text-brand-400'
                    : `bg-transparent ${isDark ? 'border-dark-border text-gray-500 hover:text-white' : 'border-gray-300 text-gray-600 hover:text-gray-900'}`
                }`}
              >
                {label}
              </button>
            ))}
            <span className="ml-auto text-xs font-mono text-gray-600">
              {filtered.length} / {MANUAL_SECTIONS.length}
            </span>
          </div>
        </div>

        {/* Resultados */}
        <div className="space-y-2">
          {filtered.map((s, i) => {
            const key = `${s.audience}-${s.number}`
            const open = expanded.has(key) || (hasQuery && i < 2)
            return (
              <div
                key={key}
                className={`border rounded-xl overflow-hidden ${isDark ? 'border-dark-border bg-dark-900/40' : 'border-gray-200 bg-white'}`}
              >
                <button
                  onClick={() => toggle(key)}
                  className={`w-full text-left px-4 py-3 flex items-center justify-between gap-3 transition-colors ${isDark ? 'hover:bg-dark-700/40' : 'hover:bg-gray-50'}`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full shrink-0 ${
                      s.audience === 'admin'
                        ? 'bg-brand-400/10 text-brand-400'
                        : (isDark ? 'bg-purple-500/10 text-purple-300' : 'bg-purple-500/15 text-purple-700')
                    }`}>
                      {s.audience === 'admin' ? 'ADMIN' : 'EMPLEADO'}
                    </span>
                    <span className={`text-sm font-semibold truncate ${isDark ? 'text-white' : 'text-gray-900'}`}>
                      {highlight(s.title, tokens)}
                    </span>
                  </div>
                  <span className={`text-xs shrink-0 ${isDark ? 'text-gray-500' : 'text-gray-400'}`}>
                    {open ? '▾' : '▸'}
                  </span>
                </button>
                {open && (
                  <div className={`px-4 pb-4 pt-0 text-sm whitespace-pre-wrap leading-relaxed ${isDark ? 'text-gray-300' : 'text-gray-700'}`}>
                    {highlight(s.body, tokens)}
                  </div>
                )}
              </div>
            )
          })}

          {showNothingFound && (
            <div className={`px-4 py-6 text-center rounded-xl border border-dashed ${isDark ? 'border-dark-border bg-dark-900/40' : 'border-gray-300 bg-gray-50'}`}>
              <p className={`text-sm mb-1 ${isDark ? 'text-gray-400' : 'text-gray-700'}`}>
                No encontramos nada para <span className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>&ldquo;{q}&rdquo;</span>.
              </p>
              <p className={`text-xs mb-3 ${isDark ? 'text-gray-500' : 'text-gray-500'}`}>
                Mandanos tu pregunta y la resolvemos.
              </p>
              <button
                onClick={jumpToForm}
                className="btn-primary max-w-xs mx-auto"
              >
                Escribir mi pregunta
              </button>
            </div>
          )}
        </div>
      </div>

      {/* ── Formulario de reporte ──────────────────────────────────────── */}
      <div ref={formRef} className="card space-y-3">
        <div>
          <h2 className={`text-lg font-bold ${isDark ? 'text-white' : 'text-gray-900'}`}>¿No encontraste tu respuesta?</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Cuentanos tu duda, reporta un bug o mandanos una sugerencia. Revisamos los mensajes cada semana y te avisamos si aplicamos un arreglo.
          </p>
        </div>

        {submitted ? (
          <div className="px-4 py-4 rounded-xl bg-brand-400/10 border border-brand-400/30 text-center">
            <p className="text-brand-400 font-bold text-sm">¡Gracias! Ya tenemos tu mensaje.</p>
            <p className={`text-xs mt-1 ${isDark ? 'text-gray-400' : 'text-gray-600'}`}>Lo revisamos en el proximo corte semanal.</p>
            <button
              onClick={() => setSubmitted(false)}
              className={`mt-3 text-xs underline ${isDark ? 'text-gray-500 hover:text-white' : 'text-gray-600 hover:text-gray-900'}`}
            >
              Enviar otro mensaje
            </button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <div>
              <label className="label">Tipo de mensaje</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  ['pregunta',  '❓ Pregunta',   'No entiendo algo'],
                  ['sugerencia','💡 Sugerencia', 'Propongo una mejora'],
                  ['bug',       '🐞 Bug',        'Algo no funciona bien'],
                ].map(([id, label, sub]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setKind(id)}
                    className={`px-3 py-2.5 rounded-xl border text-left transition-colors ${
                      kind === id
                        ? 'bg-brand-400/10 border-brand-400/40'
                        : (isDark
                            ? 'bg-dark-700 border-dark-border hover:border-gray-500'
                            : 'bg-gray-50 border-gray-300 hover:border-gray-400')
                    }`}
                  >
                    <div className={`text-xs font-bold ${kind === id ? 'text-brand-400' : (isDark ? 'text-white' : 'text-gray-900')}`}>{label}</div>
                    <div className={`text-[10px] mt-0.5 ${isDark ? 'text-gray-500' : 'text-gray-600'}`}>{sub}</div>
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="label">Titulo</label>
              <input
                className="input"
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'Ej: El PDF de nomina sale en blanco'
                    : kind === 'sugerencia'
                      ? 'Ej: Me gustaria exportar a Excel'
                      : 'Ej: Como cambio la tolerancia de retardo?'
                }
                maxLength={200}
              />
            </div>

            <div>
              <label className="label">Detalle</label>
              <textarea
                className="input min-h-[120px]"
                value={desc}
                onChange={e => setDesc(e.target.value)}
                placeholder={
                  kind === 'bug'
                    ? 'Que intentaste hacer, que esperabas, y que paso. Si sabes, incluye la pantalla donde ocurre.'
                    : kind === 'sugerencia'
                      ? 'Que te gustaria que hiciera CheckPro, y para que.'
                      : 'Explica tu duda con el mayor detalle posible.'
                }
                maxLength={5000}
              />
              <p className="text-[10px] text-gray-600 font-mono mt-1">
                {desc.length} / 5000
              </p>
            </div>

            <button type="submit" className="btn-primary" disabled={submitting}>
              {submitting ? 'Enviando…' : 'Enviar mensaje'}
            </button>
          </form>
        )}
      </div>

      <p className="text-[10px] font-mono text-gray-600 text-center">
        Tus mensajes se guardan en tu empresa. Solo tu equipo y el soporte de CheckPro los ven.
      </p>
    </div>
  )
}
