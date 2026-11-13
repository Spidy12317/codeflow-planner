// One server-sent-events connection per page. The server pushes plan files changed outside
// the canvas (Claude via MCP, hand edits): event name = kind (tab | threads | project |
// classes | execution | diagram), data = the file's JSON. "bye" means the session ended.

const target = new EventTarget()
let source = null
let status = 'connecting'

function setStatus(s) {
  if (s === status) return
  status = s
  target.dispatchEvent(new CustomEvent('status', { detail: s }))
}

const KINDS = ['tab', 'threads', 'project', 'classes', 'execution', 'diagram']

function connect() {
  if (source) return
  source = new EventSource('/api/events')
  source.addEventListener('hello', () => setStatus('live'))
  source.addEventListener('bye', () => {
    source.close()
    setStatus('ended')
  })
  // The server is gone (session ended or crashed): EventSource retries; after a few failed
  // tries call it ended.
  let failures = 0
  source.onerror = () => {
    if (++failures >= 3 || source.readyState === EventSource.CLOSED) {
      source.close()
      setStatus('ended')
    }
  }
  source.onopen = () => (failures = 0)
  for (const kind of KINDS) {
    source.addEventListener(kind, (e) => {
      try {
        target.dispatchEvent(new CustomEvent(kind, { detail: JSON.parse(e.data) }))
      } catch {
        /* ignore malformed pushes */
      }
    })
  }
}

// subscribe('tab', fn) → unsubscribe
export function subscribe(kind, fn) {
  connect()
  const h = (e) => fn(e.detail)
  target.addEventListener(kind, h)
  return () => target.removeEventListener(kind, h)
}

export const connectionStatus = () => status
