// src/app/layout.js
import { Outfit, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400','500','600'] })

export const metadata = {
  title: 'CheckPro — Control de Asistencia',
  description: 'Sistem profesional de reloj �hecador ú GPS, ílmina y reportes.',
  manifest: '/manifest.json',
  themeColor: '#090b11',
  viewport: 'width=device-width, initial-scale=1, maximum-scale=1',
}

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${outfit.variable} ${jetbrains.variable}`}>
      <head>
        <meta name="apple-mobile-web-app-capable" content="yes" />
        <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
        <meta name="apple-mobile-web-app-title" content="CheckPro" />
        <link rel="apple-touch-icon" href="/icon-192.png" />
      </head>
      <body className="bg-dark-900 text-white font-sans antialiased">
        {children}
        <Toaster
          position="top-center"
          toastOptions={{
            style: { background: '#171b24', color: '#dfe6f8', border: '1px solid #1f2636', fontFamily: 'var(--font-outfit)' },
            success: { iconTheme: { primary: '#3dffa0', secondary: '#000' } },
            error: { iconTheme: { primary: '#ff4466', secondary: '#fff' } },
          }}
        />
      </body>
    </html>
  )
}
