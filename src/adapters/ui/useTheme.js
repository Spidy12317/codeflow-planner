import { useEffect, useState } from 'react'

// Light / dark / system theme, from ?theme= or the last choice.

export const THEMES = ['system', 'light', 'dark']

export function useTheme() {
  const [mode, setMode] = useState(() => {
    const q = new URLSearchParams(location.search).get('theme')
    if (THEMES.includes(q)) return q
    try {
      return localStorage.getItem('codeflow-theme') || 'system'
    } catch {
      return 'system'
    }
  })
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches)

  useEffect(() => {
    const mq = matchMedia('(prefers-color-scheme: dark)')
    const on = (e) => setSystemDark(e.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])

  useEffect(() => {
    if (mode === 'system') document.documentElement.removeAttribute('data-theme')
    else document.documentElement.setAttribute('data-theme', mode)
    try {
      localStorage.setItem('codeflow-theme', mode)
    } catch {
      /* storage unavailable: theme still applies for this session */
    }
  }, [mode])

  return { mode, setMode, resolved: mode === 'system' ? (systemDark ? 'dark' : 'light') : mode }
}

