'use client'
// src/app/page.js
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()

  useEffect(() => {
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/dashboard')
    })
  }, [router])

  return (
    <main className="min-h-dvh bg-dark-900 flex flex-col items-center justify-center px-6">
      <div className="max-w-md w-full text-center">
        {/* Logo */}
        <div className="mb-8">
          <div className="text-brand-400 font-mono text-sm font-bold tracking-widest uppercase mb-2">⬡ CheckPro</div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight leading-tight">
            Control de asistencia<br/>
            <span className="text-brand-400">profesional</span>
          </h1>
          <p className="mt-4 text-gray-400 text-base">
            GPS real · Nómina automática · Reportes imprimibles · Multi-sucursal
          </p>
        </div>

        {/* Features */}
        <div className="grid grid-cols-2 gap-3 mb-8 text-left">
          {[
            ['📍','Validación GPS','Checada verificada por ubicación'],
            ['🕐','Retardos automáticos','Tolerancia configurable'],
            ['💰','Cálculo de nómina','Horas × tarifa automático'],
            ['🖨️','Reporte imprimible','Formato carta con firmas'],
            ['📊','Historial completo','Filtros por fecha y empleado'],
            ['🔒','Roles y permisos','Propietario, gerente, empleado'],
          ].map(([icon, title, desc]) => (
            <div key={title} className="card-sm">
              <div className="text-xl mb-1">{icon}</div>
              <div className="text-white font-bold text-sm">{title}</div>
              <div className="text-gray-500 text-xs mt-0.5">{desc}</div>
            </div>
          ))}
        </div>

        {/* CTA */}
        <div className="space-y-3">
          <Link href="/register" className="btn-primary">
            Crear cuenta gratis →
          </Link>
          <Link href="/login" className="btn-ghost w-full">
            Ya tengo cuenta — Iniciar sesión
          </Link>
        </div>

        <p className="mt-6 text-gray-600 text-xs font-mono">
          CheckPro · Sistema profesional de asistencia
        </p>
      </div>
    </main>
  )
}
