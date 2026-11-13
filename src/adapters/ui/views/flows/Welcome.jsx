import { useMemo } from 'react'
import { tip } from '../../tooltip.jsx'
import { threadState } from '../../Threads.jsx'
import { CHANGE_LETTER, changeCounts, rollupChange } from '../../../../domain/plan/change.js'
import { STATUS_LABEL, addCounts, fileOf, groupFolders, statusCounts, topStatus } from './planStats.js'

// Overview shown when no folder is open: where the plan stands, what needs you, and how to
// get around. Every row opens what it describes.

const REVIEW_LIMIT = 8

const TILES = [
  ['proposed', 'To review', 'Proposed items waiting for your approval'],
  ['approved', 'Approved', 'Approved, not started yet'],
  ['in_progress', 'In progress', 'Claude is implementing these'],
  ['failed', 'Failed', 'Implementation failed; see the notes on the item'],
  ['done', 'Done', 'Implemented'],
]

const KEYS = [
  ['⌘K', 'Go to anything'],
  ['M', 'Go to a method in a folder'],
  ['⇧N', 'New flow in the open folder'],
  ['⌘B', 'Show / hide the side bar'],
  ['?', 'All shortcuts'],
]

export function Welcome({ project, tabs, threads, findings, onOpenFolder, onOpenFlow, onView }) {
  const stats = useMemo(() => {
    const flows = []
    for (const folder of project?.folders || []) {
      for (const fl of tabs[folder]?.flows || []) {
        const status = statusCounts(fl)
        const kinds = changeCounts(fl)
        flows.push({ folder, fl, file: fileOf(folder, fl), status, change: fl.change || rollupChange(kinds) })
      }
    }
    const status = addCounts(flows.map((f) => f.status))
    const change = addCounts(flows.map((f) => (f.change ? { [f.change]: 1 } : {})))
    const attention = flows
      .filter((f) => f.status.failed || f.status.in_progress || f.status.proposed)
      .sort((a, b) => (b.status.failed || 0) - (a.status.failed || 0) || (b.status.in_progress || 0) - (a.status.in_progress || 0) || (b.status.proposed || 0) - (a.status.proposed || 0))
    return { flows, status, change, attention }
  }, [project, tabs])

  const waiting = threads.filter((t) => threadState(t) === 'waiting').length
  const replied = threads.filter((t) => threadState(t) === 'replied').length
  const folderInfo = (folder) => {
    const list = stats.flows.filter((f) => f.folder === folder)
    return { count: list.length, status: topStatus(addCounts(list.map((f) => f.status))), change: rollupChange(addCounts(list.map((f) => (f.change ? { [f.change]: 1 } : {})))) }
  }
  const layers = project?.layers ? 'Clean Architecture layers mapped' : 'Folders as in the repo'

  return (
    <div className="welcome">
      <div className="wl-inner">
        <header className="wl-head">
          <div className="wl-kicker">Codeflow plan</div>
          <h1 className="wl-title">{project?.name || 'Untitled plan'}</h1>
          {project?.root && <div className="wl-root">{project.root}</div>}
          <div className="wl-meta">
            {project?.folders?.length || 0} folders · {stats.flows.length} flows · {layers}
          </div>
        </header>

        <section className="wl-tiles" aria-label="Plan status">
          {TILES.map(([key, label, desc]) => (
            <div key={key} className={`wl-tile ${stats.status[key] ? '' : 'zero'}`} {...tip(label, { desc: `${desc}. Counts steps and lines.` })}>
              <span className={`wl-dot st-${key}`} />
              <span className="wl-num">{stats.status[key] || 0}</span>
              <span className="wl-label">{label}</span>
            </div>
          ))}
        </section>

        <div className="wl-cols">
          <section className="wl-card">
            <div className="wl-card-head">
              <span>Needs attention</span>
              <span className="wl-sub">{stats.attention.length} flow{stats.attention.length === 1 ? '' : 's'}</span>
            </div>
            {stats.attention.length === 0 ? (
              <p className="wl-empty">Nothing proposed or in progress. Ask Claude to plan a change, or generate flows from the code.</p>
            ) : (
              <ul className="wl-list">
                {stats.attention.slice(0, REVIEW_LIMIT).map(({ folder, fl, file, status, change }) => (
                  <li key={`${folder}:${fl.id}`}>
                    <button className="wl-row" onClick={() => onOpenFlow(folder, fl)} {...tip(fl.title, { desc: `${folder}${file ? `/${file}` : ''}\nClick to open on the canvas`, side: 'right' })}>
                      <span className={`tchange chg-${change || 'none'}`}>{change ? CHANGE_LETTER[change] : ''}</span>
                      <span className="wl-row-main">
                        <span className="wl-row-title">{fl.title}</span>
                        <span className="wl-row-path">
                          {folder}
                          {file ? ` › ${file}` : ''}
                        </span>
                      </span>
                      <span className="wl-row-tags">
                        {['failed', 'in_progress', 'proposed'].filter((k) => status[k]).map((k) => (
                          <span key={k} className={`wl-tag st-${k}`}>
                            {status[k]} {STATUS_LABEL[k]}
                          </span>
                        ))}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {stats.attention.length > REVIEW_LIMIT && <p className="wl-more">and {stats.attention.length - REVIEW_LIMIT} more: press ⌘K to find them</p>}
          </section>

          <div className="wl-side">
            <section className="wl-card">
              <div className="wl-card-head">
                <span>Planned changes</span>
              </div>
              <div className="wl-changes">
                {['new', 'edit', 'remove'].map((k) => (
                  <div key={k} className="wl-change">
                    <span className={`tchange chg-${k}`}>{CHANGE_LETTER[k]}</span>
                    <span className="wl-num-sm">{stats.change[k] || 0}</span>
                    <span className="wl-label">{{ new: 'new', edit: 'edited', remove: 'removed' }[k]}</span>
                  </div>
                ))}
              </div>
              <div className="wl-links">
                <button className="wl-link" onClick={() => onView('messages')}>
                  {waiting} waiting for Claude{replied ? ` · ${replied} replied` : ''}
                </button>
                {findings && (
                  <button className="wl-link" onClick={() => onView('classes')}>
                    <span className="sb-err">⊗ {findings.errors}</span> <span className="sb-warn">⚠ {findings.warnings}</span> architecture checks
                  </button>
                )}
              </div>
            </section>

            <section className="wl-card">
              <div className="wl-card-head">
                <span>Get around</span>
              </div>
              <ul className="wl-keys">
                {KEYS.map(([k, what]) => (
                  <li key={k}>
                    <kbd className="keys-kbd">{k}</kbd>
                    <span>{what}</span>
                  </li>
                ))}
              </ul>
              <p className="wl-hint">Comment on any card, then tell Claude “check the canvas”.</p>
            </section>
          </div>
        </div>

        <section className="wl-card">
          <div className="wl-card-head">
            <span>Folders</span>
            <span className="wl-sub">click to show its files in the explorer</span>
          </div>
          {groupFolders(project).map(([layer, folders]) => (
            <div key={layer || 'all'} className="wl-layer">
              {layer && <div className="side-label">{layer}</div>}
              <div className="wl-folders">
                {folders.map((f) => {
                  const info = folderInfo(f)
                  return (
                    <button key={f} className={`wl-folder ${info.count ? '' : 'muted'}`} onClick={() => onOpenFolder(f)} {...tip(f, { desc: tabs[f]?.purpose || `${info.count} flows` })}>
                      {info.status && <span className={`tdot st-${info.status}`} />}
                      <span className="wl-folder-name">{f}</span>
                      {info.change && <span className={`tchange chg-${info.change}`}>{CHANGE_LETTER[info.change]}</span>}
                      <span className="tcount">{info.count}</span>
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </section>
      </div>
    </div>
  )
}
