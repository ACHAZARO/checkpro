'use client'
// src/components/ConfirmSheet.js
// Modal de confirmacion dark-theme que reemplaza window.confirm() nativo.
// Usa BottomSheet/ESC-stack internamente a traves de useEscapeKey.
//
// Uso "state-driven" (el mismo patron que empleados/[id]/page.js):
//   const [confirmState, setConfirmState] = useState(null)
//   setConfirmState({ title, message, onConfirm, danger: true, loading })
//   <ConfirmSheet state={confirmState} onCancel={() => setConfirmState(null)} />
//
// Uso controlado (props explicitos):
//   <ConfirmSheet
//     open={open}
//     onClose={...}
//     onConfirm={...}
//     title="..."
//     message="..."
//     confirmLabel="..."
//     cancelLabel="..."
//     variant="danger"
//   />
import { useEffect } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

export function ConfirmSheet(props) {
  // Normaliza ambos modos de uso en una sola forma interna.
  const state = props.state || (props.open
    ? {
        title: props.title,
        message: props.message,
        onConfirm: props.onConfirm,
        danger: props.variant === 'danger',
        confirmLabel: props.confirmLabel,
        cancelLabel: props.cancelLabel,
        loading: props.loading,
      }
    : null)
  const onCancel = props.onCancel || props.onClose
  const variant = props.variant || (state?.danger ? 'danger' : 'default')

  const open = !!state
  const loading = !!state?.loading

  useEscapeKey(open && !loading, onCancel)

  useEffect(() => {
    if (!open) return undefined
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [open])

  if (!open) return null

  const danger = variant === 'danger' || state.danger

  return (
    <div
      className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-5"
      onClick={loading ? undefined : onCancel}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="cs-title"
        className="bg-dark-800 border border-dark-border rounded-2xl p-5 w-full max-w-sm max-h-[90dvh] overflow-y-auto"
        onClick={e => e.stopPropagation()}
      >
        <h3 id="cs-title" className="text-white font-bold text-base mb-2">
          {state.title || 'Confirmar'}
        </h3>
        <p className="text-gray-400 text-sm mb-5">{state.message}</p>
        <div className="flex gap-2">
          <button
            onClick={() => { if (!loading) state.onConfirm?.() }}
            disabled={loading}
            className={`flex-1 py-2.5 rounded-xl font-bold text-sm border active:brightness-90 disabled:opacity-60 disabled:cursor-not-allowed ${
              danger
                ? 'bg-red-500/20 border-red-500/40 text-red-300'
                : 'bg-brand-400 border-brand-400 text-black'
            }`}>
            {loading ? 'Procesando…' : (state.confirmLabel || 'Confirmar')}
          </button>
          <button
            onClick={onCancel}
            disabled={loading}
            className="flex-1 py-2.5 bg-dark-700 border border-dark-border rounded-xl text-gray-400 font-bold text-sm active:bg-dark-600 disabled:opacity-60 disabled:cursor-not-allowed">
            {state.cancelLabel || 'Cancelar'}
          </button>
        </div>
      </div>
    </div>
  )
}

export default ConfirmSheet
