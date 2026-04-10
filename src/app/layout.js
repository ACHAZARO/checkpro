// src/app/layout.js
import { Outfit, JetBrains_Mono } from 'next/font/google'
import { Toaster } from 'react-hot-toast'
import './globals.css'

const outfit = Outfit({ subsets: ['latin'], variable: '--font-outfit' })
const jetbrains = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains', weight: ['400','500','600'] })

export const metadata = { title: 'CheckPro', description: 'Simstema de control de asistencia' }

export default function RootLayout({ children }) {
  return (
    <html lang="es" className={`${outfit.variable} ${jetbrains.variable}`}>
      <body className="bg-dark-900 text-white font-sans antialiased">
        {children}
        <Toaster position="top-center" toastOptions={{ style: { background: '#171b24', color: '#dfe6f8', border: '1px solid #1f2636' } }} />
      </body>
    </html>
  )
}
