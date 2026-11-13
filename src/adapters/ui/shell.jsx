import { useEffect, useRef, useState } from 'react'
import { THEMES } from './useTheme.js'
import { tip } from './tooltip.jsx'
import { CHANGE_LETTER } from '../../domain/plan/change.js'

// VS Code-style workbench pieces: activity bar, side bar tree rows, status bar, settings menu.

const ICONS = {
  flows: (
    <path d="M6 3h6v4H6zM12 17h6v4h-6zM3 10h6v4H3zM9 5H7.5A1.5 1.5 0 0 0 6 6.5V10M9 12h3a1.5 1.5 0 0 1 1.5 1.5V17" />
  ),
  classes: (
    <>
      <rect x="3" y="3" width="8" height="8" rx="1" />
      <path d="M3 6.5h8" />
      <rect x="13" y="13" width="8" height="8" rx="1" />
      <path d="M13 16.5h8M7 11v5.5h6" />
    </>
  ),
  messages: <path d="M4 5h16v11h-9l-4 3.5V16H4z" />,
  execution: (
    <>
      <circle cx="12" cy="5" r="2.2" />
      <circle cx="5" cy="18" r="2.2" />
      <circle cx="12" cy="18" r="2.2" />
      <circle cx="19" cy="18" r="2.2" />
      <path d="M12 7.2V12M5 15.8V13.5h14v2.3M12 12v3.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3" />
      <path d="M12 2.5v3M12 18.5v3M4.2 6.5l2.6 1.5M17.2 16l2.6 1.5M4.2 17.5l2.6-1.5M17.2 8l2.6-1.5" />
    </>
  ),
}

export function Icon({ name }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICONS[name]}
    </svg>
  )
}

export const VIEW_INFO = {
  flows: { label: 'Flows', keys: '⌘1', desc: 'Code flow per folder: steps, panels, status' },
  classes: { label: 'Classes (UML)', keys: '⌘2', desc: 'Class diagram with dependency-rule and SOLID checks' },
  messages: { label: 'Messages', keys: '⌘3', desc: 'Threads between you and Claude' },
  execution: { label: 'Execution plan', keys: '⌘4', desc: 'Orchestrator and sub-agents; drag tasks to assign' },
}

// items: [{ view, badge? }]. Clicking the active view hides or shows the side bar (⌘B).
export function ActivityBar({ items, view, sideHidden, onView, settings }) {
  return (
    <nav className="activity" aria-label="Views">
      <div className="act-brand" {...tip('Codeflow', { desc: 'Press ⌘K to search everything', side: 'right' })} />
      {items.map(({ view: v, badge }) => {
        const info = VIEW_INFO[v]
        const desc = [info.desc, badge?.desc, view === v ? `Click again to ${sideHidden ? 'show' : 'hide'} the side bar (⌘B)` : null].filter(Boolean).join('\n')
        return (
          <button
            key={v}
            className={`act-btn ${view === v ? 'on' : ''}`}
            onClick={() => onView(v)}
            aria-label={info.label}
            aria-pressed={view === v}
            {...tip(info.label, { keys: info.keys, desc, side: 'right' })}
          >
            <Icon name={v} />
            {badge ? <span className={`act-badge ab-${badge.tone}`}>{badge.n}</span> : null}
          </button>
        )
      })}
      <div className="act-spacer" />
      {settings}
    </nav>
  )
}

export function SettingsMenu({ mode, setMode, executionVisible, onToggleExecution }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)
  useEffect(() => {
    if (!open) return
    const close = (e) => !ref.current?.contains(e.target) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])
  return (
    <div className="settings" ref={ref}>
      <button className={`act-btn ${open ? 'on' : ''}`} onClick={() => setOpen((v) => !v)} aria-label="Settings" aria-expanded={open} {...tip('Settings', { desc: 'Theme, execution plan view', side: 'right' })}>
        <Icon name="settings" />
      </button>
      {open && (
        <div className="menu" role="menu">
          <div className="menu-label">Theme</div>
          <div className="theme" role="radiogroup" aria-label="Theme">
            {THEMES.map((t) => (
              <button key={t} role="radio" aria-checked={mode === t} className={`theme-opt ${mode === t ? 'on' : ''}`} onClick={() => setMode(t)}>
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
          <div className="menu-sep" />
          <button
            className="menu-item"
            role="menuitemcheckbox"
            aria-checked={executionVisible}
            onClick={() => {
              onToggleExecution()
              setOpen(false)
            }}
          >
            <span className="menu-check">{executionVisible ? '✓' : ''}</span>
            Show execution plan
          </button>
        </div>
      )}
    </div>
  )
}

export function Tree({ children }) {
  return (
    <div className="tree" role="tree">
      {children}
    </div>
  )
}

// Explorer row icons: folders are filled tabs, files a page with a folded corner.
const ROW_ICONS = {
  folder: <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5.9a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1h-10.9a1 1 0 0 1-1-1z" />,
  'folder-open': <path d="M1.5 4.5a1 1 0 0 1 1-1h3.6l1.4 1.5h5.4a1 1 0 0 1 1 1v1H4.2l-1.9 5.5H2.5a1 1 0 0 1-1-1zM4.2 7h10.6l-2 5.5H2.3z" />,
  file: <path d="M4 1.5h5l3.5 3.5v9a.5.5 0 0 1-.5.5H4a.5.5 0 0 1-.5-.5V2a.5.5 0 0 1 .5-.5zM9 1.5V5h3.5" />,
}
export function RowIcon({ name }) {
  return (
    <svg className={`ticon ticon-${name}`} viewBox="0 0 16 16" width="15" height="15" aria-hidden="true">
      {ROW_ICONS[name]}
    </svg>
  )
}

// One explorer row. twisty: shows the expand chevron; onTwisty toggles without selecting.
// tools: [{ icon, label, keys?, run }] small buttons shown on hover.
// change: 'new' | 'edit' | 'remove' → git-style A / M / D letter.
// icon: 'folder' | 'folder-open' | 'file'.
export function TreeRow({ depth = 0, label, title, tipDesc, mono, icon, open, twisty, on, muted, action, count, badge, status, change, tone, tools, onClick, onTwisty }) {
  return (
    <div
      role="treeitem"
      aria-selected={!!on}
      aria-expanded={twisty ? !!open : undefined}
      className={`trow ${on ? 'on' : ''} ${muted ? 'muted' : ''} ${action ? 'action' : ''} ${status ? `deco-${status}` : ''} ${change ? `tch-${change}` : ''}`}
      {...(title || tipDesc ? tip(title || label, { desc: tipDesc, side: 'right' }) : {})}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={onClick}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onClick?.())}
    >
      <span
        className={`twisty ${twisty ? '' : 'none'} ${open ? 'open' : ''}`}
        onClick={(e) => {
          if (!onTwisty) return
          e.stopPropagation()
          onTwisty()
        }}
      />
      {icon && <RowIcon name={icon} />}
      {status && <span className={`tdot st-${status}`} />}
      {tone && <span className={`tdot tone-${tone}`} />}
      <span className={`tlabel ${mono ? 'mono' : ''}`}>{label}</span>
      {tools?.length > 0 && (
        <span className="ttools">
          {tools.map((t) => (
            <button
              key={t.label}
              className="ttool"
              aria-label={t.label}
              onClick={(e) => {
                e.stopPropagation()
                t.run()
              }}
              {...tip(t.label, { keys: t.keys, side: 'bottom' })}
            >
              {t.icon}
            </button>
          ))}
        </span>
      )}
      {badge && <span className="tbadge-sm">{badge}</span>}
      {change && <span className={`tchange chg-${change}`}>{CHANGE_LETTER[change]}</span>}
      {count !== undefined && <span className="tcount">{count}</span>}
    </div>
  )
}

const SAVE_LABEL = { saved: 'Saved', saving: 'Saving…', error: 'Not saved' }

const CONN = {
  live: ['Live', 'Connected to the agent session. Changes from Claude appear as they happen.'],
  connecting: ['Connecting…', 'Waiting for the agent session.'],
  ended: ['Session ended', 'The agent session that owned this canvas is over. Run /codeflow again.'],
}

export function StatusBar({ project, connection, saveState, findings, waiting, onFindings, onMessages, onPalette }) {
  const [label, desc] = CONN[connection]
  return (
    <footer className={`statusbar conn-${connection}`}>
      <span className="sb-item" {...tip(label, { desc, side: 'top' })}>
        <span className="sb-dot" />
        {label}
      </span>
      <span className="sb-item mono" {...tip(project?.name || 'Project', { desc: project?.root, side: 'top' })}>{project?.name || '…'}</span>
      <span className="sb-spacer" />
      <button className="sb-item sb-btn" onClick={onPalette} {...tip('Go to anything', { keys: '⌘K', desc: 'Folders, flows, classes, tasks, views and actions', side: 'top' })}>
        ⌘K
      </button>
      {findings && (
        <button
          className="sb-item sb-btn"
          onClick={onFindings}
          {...tip('Architecture checks', { desc: `${findings.errors} dependency-rule errors\n${findings.warnings} SOLID warnings\nClick to open the Classes view`, side: 'top' })}
        >
          <span className="sb-err">⊗ {findings.errors}</span>
          <span className="sb-warn">⚠ {findings.warnings}</span>
        </button>
      )}
      {waiting > 0 && (
        <button className="sb-item sb-btn" onClick={onMessages} {...tip('Messages waiting', { desc: 'Tell Claude to "check the canvas" to answer them', side: 'top' })}>
          {waiting} waiting for Claude
        </button>
      )}
      <span className={`sb-item save-${saveState}`} {...tip(SAVE_LABEL[saveState], { desc: 'Plan files in <repo>/.codeflow', side: 'top' })}>
        {SAVE_LABEL[saveState]}
      </span>
    </footer>
  )
}
