'use client'
// src/components/BottomSheet.js
// Bottom sheet reusable con focus trap real (Tab/Shift+Tab), foco inicial al
// primer elemento focuseable al abrir, y restauracion al elemento previo al
// cerrar. Backdrop click + ESC cierran. Dark theme.
//
// Props: { open, onClose, title, children, footer }
//
// Extraido desde dashboard/employees/[id]/page.js en R7 para compartir con el
// resto del dashboard.
import { useEffect, useRef } from 'react'
import { useEscapeKey } from '@/hooks/useEscapeKey'

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(', ')

export function BottomSheet({ open, onClose, title, children, footer }) {
  const panelRef = useRef(null)
  const titleId = useRef('bs-title-' + Math.random().toString(36).slice(2, 9)).current

  useEscapeKey(open, onClose)

  // Body scroll lock + focus inicial + focus trap + restaurar focus previo
  useEffect(() => {
    if (!open) return undefined
    const prevFocused = typeof document !== 'undefined' ? document.activeElement : null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const panel = panelRef.current
    let cleanup = () => {}

    // Foco inicial al primer focuseable del panel (delay chico para que el
    // DOM termine de montar los hijos).
    const t = setTimeout(() => {
      if (!panel) return
      const focusables = panel.querySelectorAll(FOCUSABLE_SELECTOR)
      ;(focusables[0] || panel).focus?.()
    }, 30)

    // Focus trap: Tab / Shift+Tab dentro del modal.
    if (panel) {
      const trap = (e) => {
        if (e.key !== 'Tab') return
        const focusables = panel.querySelectorAll(FOCUSABLE_SELECTOR)
        if (focusables.length === 0) {
          e.preventDefault()
          panel.focus?.()
          return
        }
        const first = focusables[0]
        const last = focusables[focusables.length - 1]
        const active = document.activeElement
        if (e.shiftKey && (active === first || !panel.contains(active))) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
          e.preventDefault()
          first.focus()
        }
      }
      panel.addEventListener('keydown', trap)
      cleanup = () => panel.removeEventListener('keydown', trap)
    }

    return () => {
      document.body.style.overflow = prevOverflow
      clearTimeout(t)
      cleanup()
      // Restaurar focus al elemento previo (si sigue en DOM)
      if (prevFocused && typeof prevFocused.focus === 'function') {
        try { prevFocused.focus() } catch { /* ignore */ }
      }
    }
  }, [open])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-black/75 z-50 flex flex-col justify-end"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="bg-dark-800 rounded-t-2xl flex flex-col focus:outline-none"
        style={{ maxHeight: '90dvh' }}
        onClick={e => e.stopPropagation()}
      >
        <div className="w-8 h-1 bg-dark-500 rounded-full mx-auto mt-3 mb-2 shrink-0" />
        <div className="px-5 pb-10 overflow-y-auto overscroll-contain" style={{ touchAction: 'pan-y' }}>
          <div className="flex items-center justify-between mb-4">
            <h3 id={titleId} className="text-lg font-bold text-white">{title}</h3>
            <button
              onClick={onClose}
              aria-label="Cerrar"
              className="text-gray-500 text-2xl leading-none active:text-white">×</button>
          </div>
          {children}
          {footer && <div className="mt-4">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

export default BottomSheet
