'use client'
// src/lib/ThemeContext.js
import { createContext, useContext, useEffect, useState } from 'react'

const ThemeContext = createContext({ theme: 'light', setTheme: () => {} })

export function ThemeProvider({ children }) {
  const [theme, setThemeState] = useState('light')

  useEffect(() => {
    const saved = localStorage.getItem('checkpro_theme') || 'light'
    setThemeState(saved)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(saved)
  }, [])

  function setTheme(t) {
    setThemeState(t)
    localStorage.setItem('checkpro_theme', t)
    document.documentElement.classList.remove('dark', 'light')
    document.documentElement.classList.add(t)
  }

  return (
    <ThemeContext.Provider value={{ theme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  return useContext(ThemeContext)
}
