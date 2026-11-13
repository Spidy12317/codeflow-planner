import { useContext, useState } from 'react'
import { ThreadsContext } from './links.js'
import { describeRef } from '../../domain/plan/model.js'

// Message threads between you and Claude, attached to a node (folder + ref) or general.
// Claude has no push channel, so it reads them when asked to "check the canvas".

export const threadState = (t) =>
  t.status === 'resolved' ? 'resolved' : t.messages.at(-1)?.author === 'claude' ? 'replied' : 'waiting'

const STATE_LABEL = { replied: 'Claude replied', waiting: 'Waiting for Claude', resolved: 'Resolved' }
const RANK = { replied: 3, waiting: 2, resolved: 1 }

// Threads without a view belong to the flows canvas (older plans).
export const viewOf = (t) => t.view || 'flows'

// ref → { count, state } for the badges on nodes (highest-priority state wins).
// folder null: every folder (class ids are unique across the repo).
export function badgeMap(threads, folder, view = 'flows') {
  const map = {}
  for (const t of threads) {
    if (viewOf(t) !== view || (folder && t.folder !== folder) || !t.ref) continue
    const s = threadState(t)
    const cur = map[t.ref]
    map[t.ref] = { count: (cur?.count || 0) + 1, state: !cur || RANK[s] > RANK[cur.state] ? s : cur.state }
  }
  return map
}

export function ThreadBadge({ refId }) {
  return <ThreadBadgeFor badge={useContext(ThreadsContext)[refId]} />
}

export function ThreadBadgeFor({ badge: b }) {
  if (!b) return null
  return (
    <div className={`tbadge tb-${b.state}`} title={`${b.count} thread${b.count > 1 ? 's' : ''} · ${STATE_LABEL[b.state]}`}>
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" fill="currentColor" />
      </svg>
      {b.count}
    </div>
  )
}

function ago(iso) {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return 'just now'
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function Composer({ id, placeholder, onSend }) {
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const send = async () => {
    if (!text.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onSend(text)
      setText('')
    } catch (e) {
      setError(`Not sent: ${e.message}`)
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="composer">
      <textarea
        id={id}
        className="ins-input"
        rows={3}
        placeholder={placeholder}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            send()
          }
        }}
      />
      <div className="composer-row">
        <span className="composer-hint">⌘↵ to send</span>
        <button className="ins-btn tone-primary" disabled={!text.trim() || busy} onClick={send}>
          {busy ? 'Sending…' : 'Send'}
        </button>
      </div>
      {error && <div className="composer-error">{error}</div>}
    </div>
  )
}

function Thread({ t, onStatus }) {
  const state = threadState(t)
  return (
    <div className={`thread th-${state}`}>
      {t.messages.map((m) => (
        <div key={m.id} className={`msg from-${m.author}`}>
          <div className="msg-meta">
            <span className="msg-who">{m.author === 'claude' ? 'Claude' : 'You'}</span>
            <span className="msg-at">{ago(m.at)}</span>
          </div>
          <div className="msg-text">{m.text}</div>
        </div>
      ))}
      <div className="thread-foot">
        <span className={`tstate ts-${state}`}>{STATE_LABEL[state]}</span>
        <button className="link-btn" onClick={() => onStatus(t.id, state === 'resolved' ? 'open' : 'resolved')}>
          {state === 'resolved' ? 'Reopen' : 'Resolve'}
        </button>
      </div>
    </div>
  )
}

// Inspector section for the selected item.
export function Discussion({ folder, refId, view = 'flows', threads, onSend, onStatus }) {
  const mine = threads.filter((t) => viewOf(t) === view && t.folder === folder && t.ref === refId)
  const open = [...mine].reverse().find((t) => t.status === 'open')
  return (
    <div className="disc">
      <div className="ins-label">Discussion with Claude</div>
      {mine.map((t) => (
        <Thread key={t.id} t={t} onStatus={onStatus} />
      ))}
      <Composer
        id={`composer-${refId}`}
        placeholder={open ? 'Reply…' : 'Tell Claude what to change here…'}
        onSend={(text) => onSend({ threadId: open?.id, folder, ref: refId, text, ...(view !== 'flows' && { view }) })}
      />
      <p className="disc-hint">Claude reads these when you ask it to check the canvas.</p>
    </div>
  )
}

// What a thread is about, across views.
export function aboutThread(t, tabs) {
  if (!t.ref) return 'General'
  if (viewOf(t) === 'classes') return `class ${t.ref.split('.').pop()}`
  if (viewOf(t) === 'execution') return `task ${t.ref}`
  return describeRef(tabs[t.folder], t.ref)
}

// Every thread in the project, newest activity first. Shown as the Messages side bar.
export function MessagesPanel({ threads, tabs, onOpen, onSend, onStatus }) {
  const [showResolved, setShowResolved] = useState(false)
  const sorted = [...threads].sort((a, b) => (b.messages.at(-1)?.at || '').localeCompare(a.messages.at(-1)?.at || ''))
  const groups = ['replied', 'waiting', 'resolved'].map((s) => [s, sorted.filter((t) => threadState(t) === s)])
  return (
    <div className="mpanel" aria-label="Messages">
      <div className="mp-body">
        {threads.length === 0 && <p className="mp-empty">No messages yet. Select any node and write to Claude in the inspector, or send a general message below.</p>}
        {groups.map(([state, list]) =>
          !list.length || (state === 'resolved' && !showResolved) ? null : (
            <div key={state} className="mp-group">
              <div className="side-label">{STATE_LABEL[state]} · {list.length}</div>
              {list.map((t) => {
                const last = t.messages.at(-1)
                return (
                  <div key={t.id} className={`mp-row th-${state}`}>
                    <button className="mp-open" onClick={() => onOpen(t)}>
                      <span className="mp-about">{aboutThread(t, tabs)}</span>
                      {t.folder && <span className="mp-folder">{t.folder}</span>}
                      <span className="mp-last">
                        <b>{last.author === 'claude' ? 'Claude' : 'You'}:</b> {last.text}
                      </span>
                    </button>
                    {state !== 'resolved' && (
                      <button className="link-btn" onClick={() => onStatus(t.id, 'resolved')}>Resolve</button>
                    )}
                  </div>
                )
              })}
            </div>
          ),
        )}
        {groups[2][1].length > 0 && (
          <button className="link-btn" onClick={() => setShowResolved((v) => !v)}>
            {showResolved ? 'Hide resolved' : `Show resolved (${groups[2][1].length})`}
          </button>
        )}
        <div className="mp-general">
          <div className="ins-label">General message</div>
          <Composer id="composer-general" placeholder="Anything not tied to one node…" onSend={(text) => onSend({ text })} />
        </div>
        <p className="disc-hint">Claude can't see new messages on its own. Tell it to check the canvas.</p>
      </div>
    </div>
  )
}
