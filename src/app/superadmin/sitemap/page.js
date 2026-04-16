'use client'
// src/app/superadmin/sitemap/page.js
// Visual map of all app screens grouped by role / context.
// Clicking a card opens that screen in a new tab.
import Link from 'next/link'

const GROUPS = [
  {
    title: '🌐 Público',
    color: 'text-gray-300',
    desc: 'Pantallas accesibles sin iniciar sesión.',
    items: [
      { href: '/', label: 'Landing', desc: 'Página principal de CheckPro' },
      { href: '/login', label: 'Iniciar sesión', desc: 'Admin/Owner/Manager login' },
      { href: '/register', label: 'Registro de empresa', desc: 'Alta de un nuevo tenant (dueño)' }
    ]
  },
  {
    title: '📱 Empleado (kiosco)',
    color: 'text-emerald-400',
    desc: 'Pantalla del checador — no requiere cuenta, solo código + PIN.',
    items: [
      { href: '/check', label: 'Checador', desc: 'Registro de entrada/salida con GPS' }
    ]
  },
  {
    title: '🏢 Gerente de sucursal',
    color: 'text-indigo-400',
    desc: 'Acceso limitado a su sucursal asignada. Recibe invitación por correo.',
    items: [
      { href: '/dashboard', label: 'Hoy', desc: 'Empleados presentes / ausentes del día' },
      { href: '/dashboard/employees', label: 'Personal', desc: 'Alta, edición y baja de empleados' },
      { href: '/dashboard/attendance', label: 'Asistencia', desc: 'Historial, incidencias y vacaciones' },
      { href: '/dashboard/payroll', label: 'Nómina', desc: 'Cálculo y cierre semanal' },
      { href: '/accept-invite', label: 'Aceptar invitación', desc: 'Flujo de onboarding de gerente' }
    ]
  },
  {
    title: '👑 Propietario',
    color: 'text-brand-400',
    desc: 'Dueño de la empresa — acceso total a su tenant, sin cruzar con otras empresas.',
    items: [
      { href: '/dashboard/archivo', label: 'Archivo', desc: 'Histórico multi-sucursal' },
      { href: '/dashboard/settings', label: 'Configuración', desc: 'Empresa, sucursales y equipo (tabs)' }
    ]
  },
  {
    title: '⬢ Super Admin (tú)',
    color: 'text-red-400',
    desc: 'Acceso maestro a toda la plataforma.',
    items: [
      { href: '/superadmin', label: 'Panel', desc: 'Métricas consolidadas' },
      { href: '/superadmin/users', label: 'Usuarios', desc: 'Todas las cuentas — buscar, suspender, resetear' },
      { href: '/superadmin/tenants', label: 'Empresas', desc: 'Todas las empresas — eliminar, cambiar plan' },
      { href: '/superadmin/sitemap', label: 'Mapa', desc: 'Esta página' },
      { href: '/superadmin/docs', label: 'Manuales', desc: 'PDFs de ayuda' }
    ]
  },
  {
    title: '⚙️ API (interna)',
    color: 'text-yellow-400',
    desc: 'Endpoints del servidor — aquí para referencia, no abrir directamente.',
    items: [
      { href: '/api/bootstrap', label: '/api/bootstrap', desc: 'Rescate de usuarios huérfanos' },
      { href: '/api/branches', label: '/api/branches', desc: 'CRUD sucursales' },
      { href: '/api/invite', label: '/api/invite', desc: 'Crear/listar invitaciones' },
      { href: '/api/accept-invite', label: '/api/accept-invite', desc: 'Aceptar token' },
      { href: '/api/check/identify', label: '/api/check/identify', desc: 'Validar PIN del empleado' },
      { href: '/api/check/punch', label: '/api/check/punch', desc: 'Registrar entrada/salida' },
      { href: '/api/admin/stats', label: '/api/admin/stats', desc: 'Estadísticas super-admin' },
      { href: '/api/admin/users', label: '/api/admin/users', desc: 'Listar usuarios' },
      { href: '/api/admin/tenants', label: '/api/admin/tenants', desc: 'Listar tenants' }
    ]
  }
]

export default function SiteMapPage() {
  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <div className="mb-6">
        <h1 className="text-white text-2xl font-bold">Mapa del sitio</h1>
        <p className="text-gray-400 text-sm mt-1">
          Todas las pantallas y endpoints de CheckPro, agrupados por audiencia.
          Haz clic en cualquier tarjeta para abrirla en otra pestaña.
        </p>
      </div>

      <div className="space-y-6">
        {GROUPS.map(g => (
          <section key={g.title}>
            <div className="mb-2">
              <h2 className={`font-bold text-lg ${g.color}`}>{g.title}</h2>
              <p className="text-gray-500 text-xs">{g.desc}</p>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-2">
              {g.items.map(it => (
                <Link key={it.href} href={it.href} target="_blank"
                  className="block bg-dark-800 border border-dark-border hover:border-brand-400 rounded-lg p-3 transition-colors">
                  <div className="text-white text-sm font-semibold font-mono">{it.href}</div>
                  <div className="text-gray-400 text-xs mt-0.5">{it.label}</div>
                  <div className="text-gray-600 text-[11px] mt-0.5">{it.desc}</div>
                </Link>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-8 bg-dark-800 border border-dark-border rounded-xl p-5">
        <h3 className="text-white font-semibold mb-2">🔀 Flujo de un nuevo cliente</h3>
        <ol className="text-gray-300 text-sm space-y-1.5 list-decimal pl-5">
          <li>Dueño entra a <code className="text-brand-400">/register</code> y crea cuenta.</li>
          <li>Sistema genera tenant + sucursal principal automáticamente.</li>
          <li>Dueño configura empresa y sucursal(es) en <code className="text-brand-400">/dashboard/settings</code>.</li>
          <li>Dueño invita gerentes por sucursal (correo con magic link).</li>
          <li>Gerente acepta invitación en <code className="text-brand-400">/accept-invite</code> → entra al dashboard con permisos limitados.</li>
          <li>Empleados checan en <code className="text-brand-400">/check</code> con su código + PIN.</li>
        </ol>
      </div>
    </div>
  )
}
