import { useCallback, useEffect, useRef, useState } from 'react'
import { indexTab, normalizeTab } from '../../domain/plan/model.js'
import { connectionStatus, subscribe } from './events.js'

// Plan state: loads from the local API, applies edits immutably with undo/redo,
// debounces saves per folder, and picks up external file changes (e.g. from Claude).

const SAVE_DELAY = 350
const HISTORY_MAX = 200
const COALESCE_MS = 1200

export function usePlan() {
  const [project, setProject] = useState(null)
  const [tabs, setTabs] = useState({})
  const [loadError, setLoadError] = useState(null)
  const [saveState, setSaveState] = useState('saved')
  const [, setHistoryTick] = useState(0)

  const tabsRef = useRef({})
  const undoStack = useRef([])
  const redoStack = useRef([])
  const lastEdit = useRef(null)
  const timers = useRef({})
  const inflight = useRef(0)

  const commit = useCallback((next) => {
    tabsRef.current = next
    setTabs(next)
  }, [])

  const persist = useCallback((folder) => {
    clearTimeout(timers.current[folder])
    setSaveState('saving')
    timers.current[folder] = setTimeout(async () => {
      delete timers.current[folder]
      inflight.current++
      try {
        const res = await fetch('/api/tab', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(tabsRef.current[folder]),
        })
        if (!res.ok) throw new Error((await res.json()).error || res.statusText)
        inflight.current--
        if (!inflight.current && !Object.keys(timers.current).length) setSaveState('saved')
      } catch {
        inflight.current--
        setSaveState('error')
      }
    }, SAVE_DELAY)
  }, [])

  useEffect(() => {
    fetch('/api/plan')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Could not load the plan (${r.status})`))))
      .then(({ project, tabs }) => {
        const fixed = Object.entries(tabs).filter(([, t]) => normalizeTab(t)).map(([f]) => f)
        setProject(project)
        commit(tabs)
        fixed.forEach(persist)
      })
      .catch((e) => setLoadError(String(e.message || e)))
  }, [commit, persist])

  // A plan file changed on disk outside the canvas.
  useEffect(
    () =>
      subscribe('tab', (tab) => {
        normalizeTab(tab)
        commit({ ...tabsRef.current, [tab.folder]: tab })
      }),
    [commit],
  )
  useEffect(() => subscribe('project', (p) => setProject((cur) => ({ ...p, root: cur?.root }))), [])

  // 'live' | 'connecting' | 'ended' (the agent session that owns this canvas is over)
  const [connection, setConnection] = useState(connectionStatus)
  useEffect(() => subscribe('status', setConnection), [])

  // ── message threads ──────────────────────────────────────────────────────
  const [threads, setThreads] = useState([])

  useEffect(() => {
    fetch('/api/threads')
      .then((r) => (r.ok ? r.json() : []))
      .then(setThreads)
      .catch(() => {})
    return subscribe('threads', setThreads)
  }, [])

  const upsertThread = (t) => setThreads((ts) => (ts.some((x) => x.id === t.id) ? ts.map((x) => (x.id === t.id ? t : x)) : [...ts, t]))

  const post = async (url, body) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const data = await res.json()
    if (!res.ok) throw new Error(data.error || res.statusText)
    upsertThread(data)
    return data
  }
  const sendMessage = useCallback((msg) => post('/api/messages', msg), [])
  const setThreadStatus = useCallback((threadId, status) => post('/api/threads/status', { threadId, status }), [])

  // fn(draftTab, index) mutates a clone. Edits sharing `coalesce` within a second
  // (typing in one field) collapse into a single undo step. Returns fn's result.
  const update = useCallback(
    (folder, fn, coalesce) => {
      const cur = tabsRef.current[folder] ?? { folder, flows: [] }
      const next = structuredClone(cur)
      const result = fn(next, indexTab(next))
      normalizeTab(next) // items added by the edit (e.g. generated flows) need ids before layout
      const now = Date.now()
      const prev = lastEdit.current
      const merge = coalesce && prev && prev.key === coalesce && prev.folder === folder && now - prev.t < COALESCE_MS
      if (!merge) {
        undoStack.current.push({ folder, tab: cur })
        if (undoStack.current.length > HISTORY_MAX) undoStack.current.shift()
      }
      lastEdit.current = coalesce ? { key: coalesce, folder, t: now } : null
      redoStack.current = []
      commit({ ...tabsRef.current, [folder]: next })
      persist(folder)
      setHistoryTick((n) => n + 1)
      return result
    },
    [commit, persist],
  )

  const step = useCallback(
    (from, to) => {
      const entry = from.current.pop()
      if (!entry) return null
      to.current.push({ folder: entry.folder, tab: tabsRef.current[entry.folder] ?? { folder: entry.folder, flows: [] } })
      lastEdit.current = null
      commit({ ...tabsRef.current, [entry.folder]: entry.tab })
      persist(entry.folder)
      setHistoryTick((n) => n + 1)
      return entry.folder
    },
    [commit, persist],
  )

  const undo = useCallback(() => step(undoStack, redoStack), [step])
  const redo = useCallback(() => step(redoStack, undoStack), [step])

  return {
    project,
    tabs,
    connection,
    loadError,
    saveState,
    update,
    undo,
    redo,
    canUndo: undoStack.current.length > 0,
    canRedo: redoStack.current.length > 0,
    threads,
    sendMessage,
    setThreadStatus,
  }
}
