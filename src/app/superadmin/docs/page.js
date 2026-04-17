'use client'
// src/app/superadmin/docs/page.js
// Central access to all CheckPro documentation.
import Link from 'next/link'

const DOCS = [
  {
    title: 'Manual del Administrador',
    file: '/manuals/CheckPro_Manual_Administrador.pdf',
    icon: '\uD83D\uDC51',
    audience: 'Due\u00f1os y gerentes',
    pages: '17 p\u00e1ginas',
    version: 'v2 \u00b7 Abril 2026',
    private: false,
    desc: 'Gu\u00eda completa para propietarios: registro, sucursales, invitar gerentes, configuraci\u00f3n global y por sucursal, empleados, asistencia, n\u00f3mina, identidad de empresa vs sucursal, roles y troubleshooting.'
  },
  {
    title: 'Manual del Empleado',
    file: '/manuals/CheckPro_Manual_Empleados.pdf',
    icon: '\uD83D\uDC65',
    audience: 'Empleados de campo',
    pages: '7 p\u00e1ginas',
    version: 'v2 \u00b7 Abril 2026',
    private: false,
    desc: 'Paso a paso para usar el checador: c\u00f3digo + PIN, flujo QR con celular, qu\u00e9 significa puntual/tolerancia/retardo, qu\u00e9 hacer en cada error, nota multi-sucursal.'
  },
  {
    title: 'Manual del Super Administrador',
    file: '/manuals/CheckPro_Manual_SuperAdmin.pdf',
    icon: '\uD83D\uDD12',
    audience: 'Solo operador del sistema',
    pages: '10 p\u00e1ginas',
    version: 'v1 \u00b7 Abril 2026',
    private: true,
    desc: 'Documento privado: acceso recovery-only, secciones del panel /superadmin, gesti\u00f3n de usuarios y empresas, incidentes conocidos (RLS recursion, middleware SSR), checks de salud semanales. No compartir.'
  }
]

export default function SuperAdminDocsPage() {
  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Manuales de CheckPro</h1>
        <p className="text-gray-400 text-sm mt-1">
          Documentos oficiales del sistema. Los p\u00fablicos puedes compartirlos con clientes;
          el privado se queda con el operador.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
        {DOCS.map(d => (
          <div key={d.file} className={"bg-dark-800 border rounded-xl p-5 transition-colors " + (d.private ? "border-red-500/40 hover:border-red-400" : "border-dark-border hover:border-brand-400")}>
            <div className="flex items-start justify-between">
              <div className="text-4xl mb-3">{d.icon}</div>
              {d.private && (
                <span className="text-xs font-mono uppercase tracking-wider text-red-400 border border-red-500/40 rounded px-2 py-0.5">
                  Privado
                </span>
              )}
            </div>
            <div className="text-white font-bold">{d.title}</div>
            <div className="text-gray-500 text-xs font-mono uppercase tracking-wider mt-0.5">
              {d.audience} \u00b7 {d.pages}
            </div>
            <div className="text-gray-600 text-[10px] font-mono uppercase tracking-wider mt-0.5">
              {d.version}
            </div>
            <p className="text-gray-400 text-sm mt-3">{d.desc}</p>
            <div className="mt-4 flex gap-2">
              <Link href={d.file} target="_blank"
                className={"flex-1 text-center px-3 py-2 text-white text-sm font-semibold rounded-lg transition-colors " + (d.private ? "bg-red-600 hover:bg-red-500" : "bg-brand-500 hover:bg-brand-400")}>
                Ver PDF
              </Link>
              <Link href={d.file} download
                className="px-3 py-2 border border-dark-border text-gray-300 hover:text-white text-sm rounded-lg transition-colors">
                \u2b07
              </Link>
            </div>
          </div>
        ))}
      </div>

      <div className="bg-dark-800 border border-dark-border rounded-xl p-5">
        <h2 className="text-white font-semibold mb-2">C\u00f3mo compartirlos</h2>
        <ul className="text-gray-300 text-sm space-y-1.5 list-disc pl-5">
          <li>El manual de administrador y el de empleados son p\u00fablicos: puedes enviarlos por WhatsApp o correo.</li>
          <li>El manual de super admin es <span className="text-red-400">privado</span>. No lo compartas con clientes ni empleados.</li>
          <li>Para actualizar un manual, reemplaza el archivo en <code className="text-brand-400">/public/manuals/</code> del repo y haz push.</li>
        </ul>
      </div>
    </div>
  )
}
