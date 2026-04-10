'use client'
import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase'
import Link from 'next/link'

export default function Home() {
  const router = useRouter()
  useEffect(() => {
    createClient().auth.getSession().then(({ data: { session } }) => {
      if (session) router.push('/dashboard')
    })
  }, [router])
  return (
    <main className="min-h-dvh bg-dark-900 flex flex-col items-center justify-center px-6">
      <div className="text-center max-w-md">
        <div className="text-brand-400 font-mono text-sm font-bold tracking-widest mb-4">⬡ CHECKPRO</div>
        <h1 className="text-4xl font-extrabold text-white mb-4">Control de asistencia profesional</h1>
        <div className="space-y-3">
          <Link href="/register" className="btn-primary block">Crear cuenta gratis</Link>
          <Link href="/login" className="btn-ghost block">Ya tengo cuenta</Link>
        </div>
      </div>
    </main>
  )
}
