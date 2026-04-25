'use client'
import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'
import {
  MapPin, Clock, DollarSign, FileText, BarChart3, ShieldCheck,
  CheckCircle2, ArrowRight, Building2, Users, Zap,
} from 'lucide-react'
import HeroVisual from './HeroVisual'

const FEATURES = [
  { Icon: MapPin,       title: 'Validación GPS',        desc: 'Checada verificada por ubicación en tiempo real' },
  { Icon: Clock,        title: 'Retardos automáticos',  desc: 'Tolerancia configurable por turno y sucursal' },
  { Icon: DollarSign,   title: 'Cálculo de nómina',     desc: 'Horas trabajadas × tarifa, automático' },
  { Icon: FileText,     title: 'Reporte imprimible',    desc: 'Formato carta con firmas, listo para RR.HH.' },
  { Icon: BarChart3,    title: 'Historial completo',    desc: 'Filtros por fecha, empleado y sucursal' },
  { Icon: ShieldCheck,  title: 'Roles y permisos',      desc: 'Propietario, gerente y empleado' },
]

const STATS = [
  { value: 'GPS', label: 'Validación real', Icon: MapPin },
  { value: 'Multi', label: 'sucursal', Icon: Building2 },
  { value: '100%', label: 'en la nube', Icon: Zap },
]

export default function Home() {
  const router = useRouter()
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const supabase = createClient()
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/dashboard')
    })
  }, [router])

  return (
    <main className="min-h-dvh flex flex-col" style={{ backgroundColor: 'var(--cp-bg)', color: 'var(--cp-text)' }}>

      {/* ── NAV ── */}
      <header className="sticky top-0 z-20 border-b backdrop-blur-md" style={{ borderColor: 'var(--cp-border)', backgroundColor: 'color-mix(in srgb, var(--cp-bg) 85%, transparent)' }}>
        <div className="max-w-5xl mx-auto px-5 h-14 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/logo-icon.svg" alt="CheckPro" className="w-7 h-7" style={{ filter: 'drop-shadow(0 2px 6px rgba(61,255,160,0.4))' }} />
            <span className="font-bold text-[15px] tracking-tight" style={{ color: 'var(--cp-text)' }}>
              Check<span className="text-brand-400">Pro</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/login" className="text-sm font-medium px-3.5 py-1.5 rounded-lg transition-colors" style={{ color: 'var(--cp-text-muted)' }}>
              Iniciar sesión
            </Link>
            <Link href="/register" className="text-sm font-bold px-4 py-1.5 rounded-lg text-black" style={{ background: 'linear-gradient(135deg, #52ffb0, #00d97e)', boxShadow: '0 2px 12px -2px rgba(61,255,160,0.45)' }}>
              Crear cuenta
            </Link>
          </div>
        </div>
      </header>

      {/* ── HERO ── */}
      <section className="relative px-5 pt-12 pb-6 md:pt-16 md:pb-10 overflow-hidden">
        {/* Subtle ambient glow */}
        <div className="pointer-events-none absolute inset-0" aria-hidden>
          <div className="absolute top-0 left-0 w-full h-full opacity-[0.04]"
            style={{ background: 'radial-gradient(ellipse 70% 50% at 60% 40%, #3dffa0 0%, transparent 100%)' }} />
        </div>

        <div className="relative z-10 max-w-5xl mx-auto grid md:grid-cols-2 gap-8 md:gap-4 items-center">
          {/* Left — text content */}
          <div className="flex flex-col items-start text-left">
            {/* Eyebrow pill */}
            <div className="inline-flex items-center gap-2 mb-5 px-3 py-1 rounded-full border text-[11px] font-mono font-bold uppercase tracking-[0.18em]"
              style={{ borderColor: 'rgba(61,255,160,0.25)', backgroundColor: 'rgba(61,255,160,0.06)', color: 'var(--cp-text-muted)' }}>
              <span className="w-1.5 h-1.5 rounded-full bg-brand-400 animate-pulse" />
              Sistema profesional de asistencia
            </div>

            {/* Headline */}
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-[1.05] mb-4"
              style={{ letterSpacing: '-0.035em' }}>
              Control de asistencia
              <br />
              <span className="text-brand-400">inteligente</span>
            </h1>

            <p className="text-base sm:text-lg mb-7 max-w-md" style={{ color: 'var(--cp-text-muted)', lineHeight: '1.65' }}>
              GPS real, nómina automática y reportes imprimibles para tu empresa. Sin papel, sin excusas.
            </p>

            {/* CTAs */}
            <div className="flex flex-col sm:flex-row gap-3 w-full sm:w-auto">
              <Link href="/register" className="btn-primary sm:w-auto px-7">
                Comenzar gratis <ArrowRight size={16} />
              </Link>
              <Link href="/login" className="btn-ghost sm:w-auto px-7">
                Ya tengo cuenta
              </Link>
            </div>

            {/* Trust badges */}
            <div className="flex flex-wrap gap-x-5 gap-y-2 mt-6">
              {['Sin tarjeta requerida', 'Configuración en minutos', 'Soporte en español'].map(t => (
                <span key={t} className="flex items-center gap-1.5 text-[11px] font-medium" style={{ color: 'var(--cp-text-faint)' }}>
                  <CheckCircle2 size={12} className="text-brand-400 shrink-0" />
                  {t}
                </span>
              ))}
            </div>
          </div>

          {/* Right — animated visual */}
          <div className="flex items-center justify-center md:justify-end">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* ── STATS BAR ── */}
      <div className="border-y py-5" style={{ borderColor: 'var(--cp-border)', backgroundColor: 'var(--cp-surface)' }}>
        <div className="max-w-3xl mx-auto px-5 grid grid-cols-3 gap-4">
          {STATS.map(({ value, label, Icon }) => (
            <div key={label} className="flex flex-col items-center gap-1 text-center">
              <Icon size={16} className="text-brand-400 mb-0.5" />
              <span className="text-xl sm:text-2xl font-extrabold tracking-tight" style={{ color: 'var(--cp-text)' }}>{value}</span>
              <span className="text-[11px] font-mono uppercase tracking-wider" style={{ color: 'var(--cp-text-faint)' }}>{label}</span>
            </div>
          ))}
        </div>
      </div>

      {/* ── FEATURES ── */}
      <section className="py-14 px-5">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-10">
            <p className="page-eyebrow mb-3">Funcionalidades</p>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ letterSpacing: '-0.025em', color: 'var(--cp-text)' }}>
              Todo lo que necesitas, sin complicaciones
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
            {FEATURES.map(({ Icon, title, desc }) => (
              <div key={title} className="card group">
                <div className="w-9 h-9 rounded-xl flex items-center justify-center mb-3 transition-colors"
                  style={{ backgroundColor: 'rgba(61,255,160,0.1)', color: '#3dffa0' }}>
                  <Icon size={18} />
                </div>
                <div className="text-sm font-bold mb-1" style={{ color: 'var(--cp-text)' }}>{title}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--cp-text-muted)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="py-12 px-5 border-t" style={{ borderColor: 'var(--cp-border)', backgroundColor: 'var(--cp-surface)' }}>
        <div className="max-w-3xl mx-auto">
          <div className="text-center mb-10">
            <p className="page-eyebrow mb-3">Así funciona</p>
            <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight" style={{ letterSpacing: '-0.025em', color: 'var(--cp-text)' }}>
              Checada en 3 pasos
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
            {[
              { n: '1', title: 'Empleado llega',     desc: 'Abre el kiosk desde cualquier dispositivo en la sucursal' },
              { n: '2', title: 'Ingresa su código',  desc: 'Código de empleado + PIN de 4 dígitos — sin app que instalar' },
              { n: '3', title: 'GPS confirma',       desc: 'El servidor valida la ubicación y registra la entrada' },
            ].map(({ n, title, desc }) => (
              <div key={n} className="relative flex flex-col items-center text-center px-4">
                <div className="w-10 h-10 rounded-2xl flex items-center justify-center text-lg font-extrabold text-black mb-3 shrink-0"
                  style={{ background: 'linear-gradient(135deg, #52ffb0, #00d97e)', boxShadow: '0 4px 16px -4px rgba(61,255,160,0.5)' }}>
                  {n}
                </div>
                <div className="text-sm font-bold mb-1" style={{ color: 'var(--cp-text)' }}>{title}</div>
                <div className="text-xs leading-relaxed" style={{ color: 'var(--cp-text-muted)' }}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BOTTOM CTA ── */}
      <section className="py-16 px-5">
        <div className="max-w-lg mx-auto text-center">
          <div className="mb-6 flex justify-center">
            <img src="/logo-icon.svg" alt="CheckPro" className="w-14 h-14" style={{ filter: 'drop-shadow(0 4px 16px rgba(61,255,160,0.4))' }} />
          </div>
          <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight mb-3" style={{ letterSpacing: '-0.025em', color: 'var(--cp-text)' }}>
            Empieza hoy, gratis
          </h2>
          <p className="text-sm mb-8" style={{ color: 'var(--cp-text-muted)' }}>
            Configura tu empresa en minutos. Sin tarjeta de crédito.
          </p>
          <Link href="/register" className="btn-primary max-w-xs mx-auto">
            Crear cuenta gratis <ArrowRight size={16} />
          </Link>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="border-t py-6 px-5" style={{ borderColor: 'var(--cp-border)' }}>
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <img src="/logo-icon.svg" alt="" className="w-5 h-5 opacity-70" />
            <span className="text-xs font-mono" style={{ color: 'var(--cp-text-faint)' }}>CheckPro · Sistema profesional de asistencia</span>
          </div>
          <div className="flex items-center gap-4">
            <Link href="/check" className="text-xs transition-colors" style={{ color: 'var(--cp-text-faint)' }}>Abrir kiosk</Link>
            <Link href="/login" className="text-xs transition-colors" style={{ color: 'var(--cp-text-faint)' }}>Iniciar sesión</Link>
          </div>
        </div>
      </footer>

    </main>
  )
}
