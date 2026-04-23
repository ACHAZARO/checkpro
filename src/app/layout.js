// src/app/layout.js
import { Outfit, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import { ThemeProvider } from '@/lib/ThemeContext'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400','500','600'] })

export const metadata = {
  title: 'CheckPro — Control de Asistencia',
  description: 'Sistema profesional de reloj checador con GPS, nomina y reportes.',
  manifest: '/manifest.json',
  themeColor: '#090b11',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${outfit.variable} ${jetbrains.variable}`}>
      <head>
        {/* Previene flash de tema incorrecto al cargar */}
        <script dangerouslySetInnerHTML={{ __html: `try{var t=localStorage.getItem('checkpro_theme')||'light';document.documentElement.classList.add(t)}catch(e){}` }} />
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CheckPro" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="font-sans antialiased">
        <ThemeProvider>
          {children}
          <Toaster
            position="top-center"
            toastOptions={{
              style: { background: '#171b24', color: '#dfe6f8', border: '1px solid #1f2636', fontFamily: 'var(--font-outfit)' },
              success: { iconTheme: { primary: '#3dffa0', secondary: '#000' } },
              error: { iconTheme: { primary: '#ff4466', secondary: '#fff' } },
            }}
          />
        </ThemeProvider>
      </body>
    </html>
  )
}
