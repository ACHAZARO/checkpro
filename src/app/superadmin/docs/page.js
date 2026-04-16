'use client'
// src/app/superadmin/docs/page.js
// Central access to all CheckPro documentation.
import Link from 'next/link'

const DOCS = [
  {
    title: 'Manual del Administrador',
    file: '/manuals/CheckPro_Manual_Administrador.pdf',
    icon: '👑',
    audience: 'Dueños y gerentes',
    pages: '≈23 páginas',
    desc: 'Guía completa para propietarios: registro, configuración de empresa, sucursales, invitar gerentes, gestionar empleados, nómina, cortes semanales, reportes.'
  },
  {
    title: 'Manual de Empleados',
    file: '/manuals/CheckPro_Manual_Empleados.pdf',
    icon: '👥',
    audience: 'Empleados de campo',
    pages: '≈15 páginas',
    desc: 'Paso a paso para usar el checador: escanear QR, ingresar PIN, registrar entrada, salida, validar ubicación GPS, qué hacer ante errores comunes.'
  }
]

export default function SuperAdminDocsPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Manuales de CheckPro</h1>
        <p className="text-gray-400 text-sm mt-1">
          Documentos oficiales que puedes compartir con clientes o colaboradores.
          Haz clic para ver o descargar.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        {DOCS.map(d => (
          <div key={d.file} className="bg-dark-800 border border-dark-border rounded-xl p-5 hover:border-brand-400 transition-colors">
            <div className="text-4xl mb-3">{d.icon}</div>
            <div className="text-white font-bold">{d.title}</div>
            <div className="text-gray-500 text-xs font-mono uppercase tracking-wider mt-0.5">
              {d.audience} · {d.pages}
            </div>
            <p className="text-gray-400 text-sm mt-3">{d.desc}</p>
            <div className="mt-4 flex gap-2">
              <Link href={d.file} target="_blank"
                className="flex-1 text-center px-3 py-2 bg-brand-500 hover:bg-brand-400 text-white text-sm font-semibold rounded-lg transition-colors">
                📖 Ver PDF
              </Link>
              <Link href={d.file} download
                className="px-3 py-2 border border-dark-border text-gray-300 hover:text-white text-sm rounded-lg transition-colors">
                ⬇
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-dark-800 border border-dark-border rounded-xl p-5">
        <h2 className="text-white font-semibold mb-2">💡 Cómo compartirlos</h2>
        <ul className="text-gray-300 text-sm space-y-1.5 list-disc pl-5">
          <li>Copia el enlace del botón "Ver PDF" para enviarlo por WhatsApp o correo.</li>
          <li>Los enlaces son públicos: funcionan desde cualquier dispositivo.</li>
          <li>Para actualizar un manual, reemplaza el archivo en <code className="text-brand-400">/public/manuals/</code> del repo y haz push.</li>
        </ul>
      </div>
    </div>
  )
}
