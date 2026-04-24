'use client'
// src/app/dashboard/bugs/page.js
// Panel del dueno para aprobar/rechazar los fixes que el pipeline semanal
// (Cowork, corriendo dominos 9pm) analizo. Todo en lenguaje de negocio.
//
// Estados:
//   open              -> recien llego, no analizado aun
//   analyzing         -> el pipeline esta trabajando en el
//   awaiting_approval -> el pipeline ya propuso un fix, espera tu decision
//   approved          -> aprobado, se aplicara en la proxima corrida
//   rejected          -> descartado
//   fixed             -> ya se aplico el fix
//   wont_fix          -> decidimos no hacerlo
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase'
import toast from 'react-hot-toast'
import { ConfirmSheet } from '@/components/ConfirmSheet'

const KIND_META = {
  pregunta:   { label: 'Pregunta',   emoji: '❓', cls: 'bg-blue-500/10 text-blue-300 border-blue-500/20' },
  sugerencia: { label: 'Sugerencia', emoji: '💡', cls: 'bg-yellow-500/10 text-yellow-300 border-yellow-500/20' },
  bug:        { label: 'Bug',        emoji: '🐞', cls: 'bg-red-500/10 text-red-300 border-red-500/20' },
}

const STATUS_META = {
  open:              { label: 'Sin analizar',        cls: 'bg-dark-700 text-gray-400' },
  analyzing:         { label: 'Analizando…',         cls: 'bg-brand-400/10 text-brand-400' },
  awaiting_approval: { label: 'Esperando tu decisión', cls: 'bg-orange-500/10 text-orange-400' },
  approved:          { label: 'Aprobado',             cls: 'bg-brand-400/10 text-brand-400' },
  rejected:          { label: 'Rechazado',            cls: 'bg-red-500/10 text-red-400' },
  fixed:             { label: 'Arreglado',            cls: 'bg-brand-400/20 text-brand-400' },
  wont_fix:          { label: 'No se arreglará',      cls: 'bg-dark-700 text-gray-500' },
}

const TABS = [
  ['awaiting_approval', 'Por revisar'],
  ['open',              'Recientes'],
  ['approved',          'Aprobados'],
  ['fixed',             'Listos'],
  ['rejected',          'Descartados'],
]

function fmtDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('es-MX', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export default function BugsPage() {
  const supabase = createClient()
  const [profile, setProfile] = useState(null)
  const [messages, setMessages] = useState([])
  const [tab, setTab] = useState('awaiting_approval')
  const [selected, setSelected] = useState(null)
  const [loading, setLoading] = useState(true)
  const [rejectSheet, setRejectSheet] = useState(null) // {id, title}

  const loadProfile = useCallback(async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (!session) return null
    const { data: prof } = await supabase.from('profiles').select('id, tenant_id, role, name').eq('id', session.user.id).single()
    setProfile(prof)
    return prof
  }, [supabase])

  const loadMessages = useCallback(async (prof) => {
    const p = prof || profile
    if (!p?.tenant_id) return
    setLoading(true)
    const { data, error } = await supabase
      .from('help_messages')
      .select('*')
      .eq('tenant_id', p.tenant_id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      console.error('[bugs] load error', error)
      toast.error('No se pudieron cargar los mensajes')
    } else {
      setMessages(data || [])
    }
    setLoading(false)
  }, [profile, supabase])

  useEffect(() => {
    (async () => {
      const p = await loadProfile()
      if (p) await loadMessages(p)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filtered = messages.filter(m => m.status === tab)
  const counts = TABS.reduce((acc, [s]) => {
    acc[s] = messages.filter(m => m.status === s).length
    return acc
  }, {})

  const isAdmin = profile && ['owner', 'manager', 'super_admin'].includes(profile.role)

  async function approve(m) {
    const { error } = await supabase
      .from('help_messages')
      .update({
        status: 'approved',
        approved_at: new Date().toISOString(),
        approved_by: profile.id,
      })
      .eq('id', m.id)
    if (error) { toast.error('No se pudo aprobar'); return }
    toast.success('Aprobado. Se aplicará en la próxima corrida.')
    setSelected(null)
    await loadMessages()
  }

  async function reject(m) {
    const { error } = await supabase
      .from('help_messages')
      .update({ status: 'rejected' })
      .eq('id', m.id)
    if (error) { toast.error('No se pudo rechazar'); return }
    toast.success('Descartado')
    setSelected(null)
    setRejectSheet(null)
    await loadMessages()
  }

  return (
    <div className="p-5 md:p-6 max-w-3xl mx-auto">
      <div className="mb-5 flex items-end justify-between gap-3">
        <div>
          <h1 className="page-title">Bugs y mejoras</h1>
          <p className="text-gray-500 text-xs font-mono mt-0.5">REVISIÓN DE REPORTES DE TU EQUIPO</p>
        </div>
        <Link href="/dashboard/help" className="text-xs text-gray-500 hover:text-brand-400 underline">
          Ir al centro de ayuda →
        </Link>
      </div>

      {!isAdmin && (
        <div className="card text-center text-sm text-gray-400">
          Esta sección solo la ven propietarios o gerentes.
        </div>
      )}

      {isAdmin && (
        <>
          {/* Tabs */}
          <div className="flex gap-1.5 mb-4 overflow-x-auto no-scrollbar">
            {TABS.map(([id, label]) => (
              <button
                key={id}
                onClick={() => { setTab(id); setSelected(null) }}
                className={`px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap border transition-colors ${
                  tab === id
                    ? 'bg-brand-400/10 border-brand-400/40 text-brand-400'
                    : 'bg-dark-700 border-dark-border text-gray-400 hover:text-white'
                }`}
              >
                {label}
                {counts[id] > 0 && (
                  <span className="ml-1.5 text-[10px] font-mono opacity-80">({counts[id]})</span>
                )}
              </button>
            ))}
          </div>

          {loading ? (
            <div className="text-center py-10 text-gray-500 text-sm font-mono animate-pulse">Cargando…</div>
          ) : filtered.length === 0 ? (
            <div className="card text-center py-8">
              <p className="text-gray-400 text-sm">No hay mensajes en esta sección.</p>
              <p className="text-gray-400 text-xs font-mono mt-1">
                {tab === 'awaiting_approval' && 'Cuando el análisis semanal termine, los fixes propuestos aparecerán aquí.'}
                {tab === 'open' && 'Nadie ha reportado nada nuevo.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filtered.map(m => {
                const k = KIND_META[m.kind] || KIND_META.pregunta
                const s = STATUS_META[m.status] || STATUS_META.open
                const isExpanded = selected?.id === m.id
                return (
                  <div key={m.id} className="card">
                    <button
                      onClick={() => setSelected(isExpanded ? null : m)}
                      className="w-full text-left"
                    >
                      <div className="flex items-start justify-between gap-3 mb-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full border ${k.cls}`}>
                            {k.emoji} {k.label}
                          </span>
                          <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full ${s.cls}`}>
                            {s.label}
                          </span>
                          {m.severity && (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-dark-700 text-gray-400">
                              Gravedad: {m.severity}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] font-mono text-gray-400 shrink-0">{fmtDate(m.created_at)}</span>
                      </div>
                      <h3 className="text-white font-bold text-sm">{m.title}</h3>
                      <p className="text-gray-400 text-xs mt-1 line-clamp-2">{m.description}</p>
                      {m.reporter_name && (
                        <p className="text-[10px] font-mono text-gray-400 mt-2">
                          👤 {m.reporter_name} {m.reporter_email && `· ${m.reporter_email}`}
                        </p>
                      )}
                    </button>

                    {isExpanded && (
                      <div className="mt-4 pt-4 border-t border-dark-border space-y-4">
                        <div>
                          <p className="label">Reporte original completo</p>
                          <p className="text-sm text-gray-300 whitespace-pre-wrap">{m.description}</p>
                          {m.page_context && (
                            <p className="text-[10px] font-mono text-gray-400 mt-2">
                              Pantalla: <span className="text-gray-300">{m.page_context}</span>
                            </p>
                          )}
                        </div>

                        {m.analysis_summary ? (
                          <div className="space-y-3">
                            <div>
                              <p className="label">Qué vamos a hacer</p>
                              <p className="text-sm text-white whitespace-pre-wrap">{m.analysis_summary}</p>
                            </div>
                            {m.analysis_impact && (
                              <div>
                                <p className="label">Qué va a cambiar para tu equipo</p>
                                <p className="text-sm text-gray-300 whitespace-pre-wrap">{m.analysis_impact}</p>
                              </div>
                            )}
                            {m.analyzed_at && (
                              <p className="text-[10px] font-mono text-gray-400">
                                Análisis: {fmtDate(m.analyzed_at)}
                              </p>
                            )}
                          </div>
                        ) : (
                          <div className="px-3 py-3 bg-dark-700 border border-dark-border rounded-lg">
                            <p className="text-xs text-gray-400">
                              Aún no se analiza. El pipeline corre cada domingo a las 9 pm y dejará la propuesta aquí mismo.
                            </p>
                          </div>
                        )}

                        {m.status === 'awaiting_approval' && (
                          <div className="flex gap-2">
                            <button
                              onClick={() => approve(m)}
                              className="btn-primary flex-1"
                            >
                              ✓ Aprobar fix
                            </button>
                            <button
                              onClick={() => setRejectSheet({ id: m.id, title: m.title })}
                              className="btn-ghost flex-1 !bg-red-500/10 !border-red-500/20 !text-red-400"
                            >
                              ✕ Descartar
                            </button>
                          </div>
                        )}

                        {m.status === 'approved' && (
                          <div className="text-xs font-mono text-brand-400 text-center py-2 bg-brand-400/5 rounded-lg border border-brand-400/20">
                            ✓ Aprobado el {fmtDate(m.approved_at)} · se aplica en la próxima corrida
                          </div>
                        )}

                        {m.status === 'fixed' && m.fix_commit_sha && (
                          <div className="text-xs font-mono text-gray-400 text-center py-2 bg-dark-700 rounded-lg">
                            Commit aplicado: <span className="text-brand-400">{m.fix_commit_sha.slice(0, 7)}</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      <ConfirmSheet
        open={!!rejectSheet}
        onClose={() => setRejectSheet(null)}
        title="Descartar este reporte"
        message={rejectSheet ? `"${rejectSheet.title}" se marcará como descartado. Puedes reabrirlo después editando el estado en la base.` : ''}
        confirmLabel="Descartar"
        variant="danger"
        onConfirm={() => reject({ id: rejectSheet.id })}
      />
    </div>
  )
}
