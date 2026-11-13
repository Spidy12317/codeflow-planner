import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { tip } from './tooltip.jsx'
import { SHORTCUTS } from './keys.js'

// Workbench layout helpers: panel sizes remembered per browser, drag handles, and the
// ⌘K command palette and the ? shortcut list.

// A value kept in localStorage (per viewer; the page works the same without it).
export function usePersisted(key, initial) {
  const [value, setValue] = useState(() => {
    try {
      const v = localStorage.getItem(`codeflow:${key}`)
      return v === null ? initial : JSON.parse(v)
    } catch {
      return initial
    }
  })
  useEffect(() => {
    try {
      localStorage.setItem(`codeflow:${key}`, JSON.stringify(value))
    } catch {
      /* storage unavailable: keep it for this page only */
    }
  }, [key, value])
  return [value, setValue]
}

// Drag handle on a panel edge. edge 'left': the panel is left of the handle (side bar);
// 'right': the panel is right of it (inspector). Double-click resets.
export function Resizer({ edge, width, setWidth, min, max, initial, offset = 0, label }) {
  const onPointerDown = (e) => {
    e.preventDefault()
    const move = (ev) => {
      const w = edge === 'left' ? ev.clientX - offset : window.innerWidth - ev.clientX
      setWidth(Math.round(Math.max(min, Math.min(max, w))))
    }
    const up = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      document.body.classList.remove('resizing')
    }
    document.body.classList.add('resizing')
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }
  return (
    <div
      className={`resizer rz-${edge}`}
      style={edge === 'left' ? { left: width - 3 } : { right: width - 3 }}
      onPointerDown={onPointerDown}
      onDoubleClick={() => setWidth(initial)}
      role="separator"
      aria-orientation="vertical"
      aria-valuenow={width}
      aria-label={label}
      tabIndex={0}
      onKeyDown={(e) => {
        const step = e.key === 'ArrowLeft' ? -16 : e.key === 'ArrowRight' ? 16 : 0
        if (step) setWidth((w) => Math.max(min, Math.min(max, w + (edge === 'left' ? step : -step))))
      }}
      {...tip(label, { desc: 'Drag to resize · double-click to reset', side: edge === 'left' ? 'right' : 'left' })}
    />
  )
}

// Subsequence match with a bonus for word starts and consecutive letters. → score or -1
function score(query, text) {
  const q = query.toLowerCase()
  const t = text.toLowerCase()
  if (!q) return 0
  let s = 0
  let ti = 0
  let streak = 0
  for (const ch of q) {
    const i = t.indexOf(ch, ti)
    if (i < 0) return -1
    streak = i === ti ? streak + 1 : 0
    s += 1 + streak * 2 + (i === 0 || /[\s/._:-]/.test(t[i - 1]) ? 3 : 0)
    ti = i + 1
  }
  return s - t.length * 0.01
}

const GROUP_ORDER = ['Views', 'Actions', 'Folders', 'Flows', 'Classes', 'Tasks']

// items: [{ id, group?, label, hint?, run }]
export function CommandPalette({ items, placeholder = 'Go to a folder, flow, class, task, view or action…', onClose }) {
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const list = useRef(null)

  const results = useMemo(() => {
    const scored = items
      .map((it) => ({ it, s: Math.max(score(query, it.label), score(query, `${it.group || ''} ${it.label} ${it.hint || ''}`) - 2) }))
      .filter((r) => r.s >= 0)
    if (query) scored.sort((a, b) => b.s - a.s)
    else scored.sort((a, b) => GROUP_ORDER.indexOf(a.it.group) - GROUP_ORDER.indexOf(b.it.group))
    return scored.slice(0, 60).map((r) => r.it)
  }, [items, query])

  useEffect(() => setIndex(0), [query])
  useEffect(() => {
    list.current?.querySelector('.pal-item.on')?.scrollIntoView({ block: 'nearest' })
  }, [index])

  const run = useCallback(
    (it) => {
      onClose()
      it?.run()
    },
    [onClose],
  )

  return (
    <div className="pal-backdrop" onMouseDown={onClose}>
      <div className="palette" role="dialog" aria-label="Go to anything" onMouseDown={(e) => e.stopPropagation()}>
        <input
          autoFocus
          className="pal-input"
          placeholder={placeholder}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setIndex((i) => Math.min(results.length - 1, i + 1)))
            else if (e.key === 'ArrowUp') (e.preventDefault(), setIndex((i) => Math.max(0, i - 1)))
            else if (e.key === 'Enter') run(results[index])
            else if (e.key === 'Escape') (e.stopPropagation(), onClose())
          }}
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
        />
        <div className="pal-list" id="pal-list" role="listbox" ref={list}>
          {results.length === 0 && <div className="pal-empty">Nothing matches "{query}"</div>}
          {results.map((it, i) => (
            <div
              key={it.id}
              role="option"
              aria-selected={i === index}
              className={`pal-item ${i === index ? 'on' : ''}`}
              onMouseMove={() => setIndex(i)}
              onClick={() => run(it)}
            >
              {it.group && <span className="pal-group">{it.group}</span>}
              <span className="pal-label">{it.label}</span>
              {it.hint && <span className="pal-hint">{it.hint}</span>}
            </div>
          ))}
        </div>
        <div className="pal-foot">↑↓ to move · ↵ to open · esc to close</div>
      </div>
    </div>
  )
}

// Every keyboard shortcut, grouped by view. Keys pressed here don't reach the canvas.
export function ShortcutsHelp({ onClose }) {
  const box = useRef(null)
  useEffect(() => box.current?.focus(), [])
  return (
    <div className="pal-backdrop" onMouseDown={onClose}>
      <div
        ref={box}
        tabIndex={-1}
        className="palette keys-help"
        role="dialog"
        aria-label="Keyboard shortcuts"
        onMouseDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Escape' || e.key === '?') onClose()
        }}
      >
        <div className="keys-title">Keyboard shortcuts</div>
        <div className="keys-body">
          {SHORTCUTS.map(({ group, items }) => (
            <section key={group} className="keys-group">
              <div className="side-label">{group}</div>
              {items.map(([k, what]) => (
                <div key={k} className="keys-row">
                  <kbd className="keys-kbd">{k}</kbd>
                  <span>{what}</span>
                </div>
              ))}
            </section>
          ))}
        </div>
        <div className="pal-foot">Single-letter keys work when you are not typing in a field · esc to close</div>
      </div>
    </div>
  )
}
