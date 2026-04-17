// src/hooks/useEscapeKey.js
// Reusable ESC handler con "stack de modales": solo el modal top recibe el
// evento. Extraido desde dashboard/employees/[id]/page.js en R7.
import { useEffect } from 'react'

// Stack compartido entre todos los consumidores del hook.
let modalIdCounter = 0
const activeModals = []

export function useEscapeKey(enabled, onEscape) {
  useEffect(() => {
    if (!enabled) return undefined
    const id = ++modalIdCounter
    activeModals.push(id)
    const handler = (e) => {
      if (e.key !== 'Escape') return
      if (activeModals[activeModals.length - 1] !== id) return
      onEscape?.()
    }
    document.addEventListener('keydown', handler)
    return () => {
      document.removeEventListener('keydown', handler)
      const ix = activeModals.indexOf(id)
      if (ix >= 0) activeModals.splice(ix, 1)
    }
  }, [enabled, onEscape])
}

export default useEscapeKey
