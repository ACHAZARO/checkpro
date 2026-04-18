'use client'
// src/app/dashboard/help/page.js
// Ruta directa al centro de ayuda. Se conserva por compat (links viejos, bookmarks).
// La entrada recomendada ahora es Configuracion -> pestaña Ayuda.
import HelpCenter from '@/components/HelpCenter'

export default function HelpPage() {
  return (
    <div className="p-5 md:p-6 max-w-3xl mx-auto">
      <div className="mb-5">
        <h1 className="text-2xl font-extrabold text-white">Centro de ayuda</h1>
        <p className="text-gray-500 text-xs font-mono mt-0.5">DUDAS, SUGERENCIAS Y REPORTES</p>
      </div>
      <HelpCenter />
    </div>
  )
}
