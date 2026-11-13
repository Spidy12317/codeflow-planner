import { useCallback, useEffect, useRef, useState } from 'react'
import { subscribe } from './events.js'

// A plan document (classes, execution): loaded from the API, live-updated over SSE, and
// saved (debounced) when the canvas changes it.
export function useDoc(name, { saveDelay = 300 } = {}) {
  const [doc, setDoc] = useState(undefined)
  const [error, setError] = useState(null)
  const timer = useRef(null)

  useEffect(() => {
    fetch(`/api/doc/${name}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(r.statusText))))
      .then(setDoc)
      .catch((e) => setError(e.message))
    return subscribe(name, setDoc)
  }, [name])

  const save = useCallback(
    (next) => {
      setDoc(next)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => {
        fetch(`/api/doc/${name}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(next) }).catch((e) => setError(e.message))
      }, saveDelay)
    },
    [name, saveDelay],
  )

  return { doc, setDoc, save, error }
}
