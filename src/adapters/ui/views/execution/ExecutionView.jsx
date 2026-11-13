import { useEffect, useMemo, useState } from 'react'
import { Discussion } from '../../Threads.jsx'
import { tip } from '../../tooltip.jsx'
import { blurField } from '../../keys.js'
import { normalizeExecution, validateExecution, waves, TASK_STATUS } from '../../../../domain/execution/model.js'
import { describeRef, uid } from '../../../../domain/plan/model.js'

// Execution view (hidden until asked for): the orchestrator's split of the approved work
// into sub-agents. Drag tasks between columns to reassign them; Claude follows this
// assignment exactly when told to execute. Unassigned tasks are the orchestrator's.

const AGENT_TYPES = ['general-purpose', 'Explore', 'Plan']
const MODELS = ['', 'opus', 'sonnet', 'haiku']
const ORCH = '__orchestrator'

function AgentEditor({ agent, count, onChange, onRemove }) {
  return (
    <div className="agent-ed">
      <input className="ins-input" value={agent.name} onChange={(e) => onChange({ name: e.target.value })} aria-label="Agent name" />
      <div className="agent-row">
        <select className="ins-input" value={agent.type || 'general-purpose'} onChange={(e) => onChange({ type: e.target.value })} aria-label="Agent type">
          {[...new Set([...AGENT_TYPES, agent.type || 'general-purpose'])].map((t) => (
            <option key={t}>{t}</option>
          ))}
        </select>
        <select className="ins-input" value={agent.model || ''} onChange={(e) => onChange({ model: e.target.value || undefined })} aria-label="Model">
          {MODELS.map((m) => (
            <option key={m} value={m}>{m || 'inherit model'}</option>
          ))}
        </select>
      </div>
      <div className="agent-row">
        <label className="side-check">
          <input type="checkbox" checked={agent.isolation === 'worktree'} onChange={(e) => onChange({ isolation: e.target.checked ? 'worktree' : 'none' })} /> Own git worktree
        </label>
        <button className="link-btn" onClick={onRemove} {...tip('Remove agent', { desc: count ? `Its ${count} task${count > 1 ? 's go' : ' goes'} back to the orchestrator` : undefined })}>
          Remove
        </button>
      </div>
    </div>
  )
}

// drag: { kind: 'task' | 'agent', id } while something is being dragged on the board.
function TaskCard({ task, wave, titleOf, selected, drag, onSelect, onDrag, onDropBefore }) {
  const [over, setOver] = useState(false)
  const desc = [
    task.desc,
    `Wave ${wave + 1}: starts when ${task.deps.length ? task.deps.map(titleOf).join(', ') : 'the plan starts'}${task.deps.length ? (task.deps.length > 1 ? ' are done' : ' is done') : ''}`,
    task.refs.length ? `Implements ${task.refs.length} plan node${task.refs.length > 1 ? 's' : ''}` : null,
    'Drag to another agent, or onto a card to place it there',
  ]
    .filter(Boolean)
    .join('\n')
  return (
    <>
      {over && drag?.kind === 'task' && drag.id !== task.id && <div className="drop-line" />}
      <div
        className={`xtask st-${task.status} ${selected ? 'sel' : ''} ${drag?.id === task.id ? 'dragging' : ''}`}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', `task:${task.id}`)
          e.dataTransfer.effectAllowed = 'move'
          onDrag({ kind: 'task', id: task.id })
        }}
        onDragEnd={() => onDrag(null)}
        onDragOver={(e) => {
          if (drag?.kind !== 'task') return
          e.preventDefault()
          e.stopPropagation()
          setOver(true)
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          if (drag?.kind !== 'task') return
          e.preventDefault()
          e.stopPropagation()
          setOver(false)
          if (drag.id !== task.id) onDropBefore(drag.id, task.id)
          onDrag(null)
        }}
        onClick={() => onSelect(task.id)}
        tabIndex={0}
        onKeyDown={(e) => e.key === 'Enter' && onSelect(task.id)}
        {...tip(task.title, { desc, side: 'right' })}
      >
        <div className="xtask-top">
          <span className="wave">W{wave + 1}</span>
          <span className={`xstatus xs-${task.status}`}>{task.status.replace('_', ' ')}</span>
        </div>
        <div className="xtask-title">{task.title}</div>
        {task.deps.length > 0 && (
          <div className="xtask-deps">
            after {task.deps.map((d) => <span key={d} className="chip">{titleOf(d)}</span>)}
          </div>
        )}
        {task.refs.length > 0 && <div className="xtask-refs">{task.refs.length} plan node{task.refs.length > 1 ? 's' : ''}</div>}
      </div>
    </>
  )
}

// A sub-agent's column. Tasks dropped on empty space go to the end; agent columns can be
// dragged by their header to reorder them (the orchestrator stays first).
function Column({ id, title, sub, tasks, children, drag, onDrag, onDropTask, onDropAgent, onAdd }) {
  const [over, setOver] = useState(false)
  const movable = id !== ORCH
  return (
    <section
      className={`col ${over && drag?.kind === 'task' ? 'over' : ''} ${over && drag?.kind === 'agent' && drag.id !== id && movable ? 'col-drop-before' : ''} ${drag?.id === id ? 'col-dragging' : ''} ${id === ORCH ? 'col-orch' : ''}`}
      onDragOver={(e) => {
        if (!drag || (drag.kind === 'agent' && !movable)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'move'
        setOver(true)
      }}
      onDragLeave={(e) => !e.currentTarget.contains(e.relatedTarget) && setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        if (drag?.kind === 'task') onDropTask(drag.id, id === ORCH ? null : id)
        else if (drag?.kind === 'agent' && drag.id !== id) onDropAgent(drag.id, id)
        onDrag(null)
      }}
      aria-label={`${title} tasks`}
    >
      <header
        className="col-head"
        draggable={movable}
        onDragStart={(e) => {
          if (!movable) return
          e.dataTransfer.setData('text/plain', `agent:${id}`)
          e.dataTransfer.effectAllowed = 'move'
          onDrag({ kind: 'agent', id })
        }}
        onDragEnd={() => onDrag(null)}
        {...tip(title, { desc: `${sub}${movable ? '\nDrag the header to reorder agents' : '\nTasks left here are done by the orchestrator itself'}`, side: 'bottom' })}
      >
        <div className="col-title">{title}</div>
        <div className="col-sub">
          {sub} · {tasks} task{tasks === 1 ? '' : 's'}
        </div>
      </header>
      <div className="col-body">{children}</div>
      <button className="col-add" onClick={onAdd}>+ Task</button>
    </section>
  )
}

function TaskInspector({ task, plan, tasks, titleOf, onChange, onRemove, onClose, onNavigate }) {
  return (
    <aside className="inspector">
      <div className="ins-head">
        <div>
          <div className="ins-type">Task</div>
          <div className="ins-id">{task.id}</div>
        </div>
        <button className="ins-close" onClick={onClose} aria-label="Close">×</button>
      </div>
      <div className="ins-body">
        <label className="ins-field">
          <span className="ins-label">Title</span>
          <input className="ins-input" value={task.title} onChange={(e) => onChange({ title: e.target.value })} />
        </label>
        <label className="ins-field">
          <span className="ins-label">Description</span>
          <textarea className="ins-input" rows={4} value={task.desc || ''} onChange={(e) => onChange({ desc: e.target.value })} />
        </label>
        <label className="ins-field">
          <span className="ins-label">Status</span>
          <select className="ins-input" value={task.status} onChange={(e) => onChange({ status: e.target.value })}>
            {TASK_STATUS.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </label>
        <div className="ins-field">
          <span className="ins-label">Runs after</span>
          {tasks.filter((t) => t.id !== task.id).map((t) => (
            <label key={t.id} className="side-check">
              <input
                type="checkbox"
                checked={task.deps.includes(t.id)}
                onChange={(e) => onChange({ deps: e.target.checked ? [...task.deps, t.id] : task.deps.filter((d) => d !== t.id) })}
              />
              {titleOf(t.id)}
            </label>
          ))}
        </div>
        {task.refs.length > 0 && (
          <div className="ins-field">
            <span className="ins-label">Implements</span>
            {task.refs.map((r) => (
              <button key={r.tab + r.ref} className="link-chip" onClick={() => onNavigate({ view: 'flows', folder: r.tab, ref: r.ref })}>
                {describeRef(plan.tabs[r.tab], r.ref) || r.ref} <span className="via">{r.tab}</span>
              </button>
            ))}
          </div>
        )}
        <button className="ins-btn tone-danger" onClick={onRemove}>Delete task</button>
        <Discussion view="execution" folder={null} refId={task.id} threads={plan.threads} onSend={plan.sendMessage} onStatus={plan.setThreadStatus} />
      </div>
    </aside>
  )
}

export function ExecutionView({ doc, save, plan, request, onNavigate }) {
  const ex = useMemo(() => normalizeExecution(doc), [doc])
  const [selected, setSelected] = useState(null)
  const [drag, setDrag] = useState(null)
  const problems = useMemo(() => validateExecution(ex), [ex])
  const waveOf = useMemo(() => {
    const m = new Map()
    waves(ex).forEach((w, i) => w.forEach((id) => m.set(id, i)))
    return m
  }, [ex])
  const titleOf = (id) => ex.tasks.find((t) => t.id === id)?.title || id

  useEffect(() => {
    if (request?.ref) setSelected(request.ref)
  }, [request])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && !blurField(e) && setSelected(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const change = (fn) => {
    const next = structuredClone(ex)
    fn(next)
    save(next)
  }
  const setTask = (id, fields) => change((p) => Object.assign(p.tasks.find((t) => t.id === id), fields))
  const setAgent = (id, fields) => change((p) => Object.assign(p.agents.find((a) => a.id === id), fields))
  const addTask = (agent) => {
    const t = { id: uid('k'), title: 'New task', refs: [], deps: [], agent, status: 'todo' }
    change((p) => p.tasks.push(t))
    setSelected(t.id)
  }
  const moveTask = (taskId, agent) => {
    if (ex.tasks.find((t) => t.id === taskId)?.agent !== agent) setTask(taskId, { agent })
  }
  // Put a task right before another one (and in that task's column).
  const placeBefore = (taskId, beforeId) =>
    change((p) => {
      const i = p.tasks.findIndex((t) => t.id === taskId)
      const [t] = p.tasks.splice(i, 1)
      const before = p.tasks.find((x) => x.id === beforeId)
      t.agent = before.agent
      p.tasks.splice(p.tasks.indexOf(before), 0, t)
    })
  const moveAgent = (agentId, beforeId) =>
    change((p) => {
      const i = p.agents.findIndex((a) => a.id === agentId)
      const [a] = p.agents.splice(i, 1)
      p.agents.splice(p.agents.findIndex((x) => x.id === beforeId), 0, a)
    })

  const columns = [{ id: ORCH, name: 'Orchestrator', sub: 'does unassigned work' }, ...ex.agents.map((a) => ({ ...a, sub: `${a.type || 'general-purpose'}${a.model ? ` · ${a.model}` : ''}${a.isolation === 'worktree' ? ' · worktree' : ''}` }))]
  const task = selected && ex.tasks.find((t) => t.id === selected)
  const done = ex.tasks.filter((t) => t.status === 'done').length

  return (
    <>
      <aside className="sidebar">
        <div className="side-title">
          Execution plan
          <button className="side-action" onClick={() => save({ ...ex, visible: false })} {...tip('Hide', { desc: 'Hide the execution view again (Settings → Show execution plan brings it back)' })}>
            Hide
          </button>
        </div>
        <p className="side-note">
          Drag tasks between agents to split the work. When you're happy, tell Claude <b>"execute the plan"</b>: it follows this assignment exactly, wave by wave.
        </p>
        <div className="progress" aria-label={`${done} of ${ex.tasks.length} tasks done`}>
          <span style={{ width: ex.tasks.length ? `${(100 * done) / ex.tasks.length}%` : 0 }} />
        </div>
        <label className="ins-field">
          <span className="side-label">Orchestrator notes</span>
          <textarea className="ins-input" rows={3} value={ex.orchestrator.notes} onChange={(e) => change((p) => (p.orchestrator.notes = e.target.value))} placeholder="How the orchestrator coordinates, merges and verifies…" />
        </label>
        <div className="side-label">Sub-agents</div>
        <div className="agents">
          {ex.agents.map((a) => (
            <AgentEditor
              key={a.id}
              agent={a}
              count={ex.tasks.filter((t) => t.agent === a.id).length}
              onChange={(f) => setAgent(a.id, f)}
              onRemove={() =>
                change((p) => {
                  p.agents = p.agents.filter((x) => x.id !== a.id)
                  p.tasks.forEach((t) => t.agent === a.id && (t.agent = null))
                })
              }
            />
          ))}
          <button className="ins-btn" onClick={() => change((p) => p.agents.push({ id: uid('a'), name: `agent-${p.agents.length + 1}`, type: 'general-purpose', isolation: 'none' }))}>
            + Add sub-agent
          </button>
        </div>
        {problems.length > 0 && (
          <div className="side-section">
            <div className="side-label">Problems</div>
            {problems.map((p) => (
              <div key={p} className="finding-row sev-error">{p}</div>
            ))}
          </div>
        )}
      </aside>

      <main className="editor">
        <div className="board">
          {!ex.tasks.length && !ex.agents.length ? (
            <div className="empty-state">
              <div className="empty-title">No execution plan yet</div>
              <p className="empty-hint">Ask Claude to "plan the execution": it splits the approved flows into tasks and proposes sub-agents. Or add agents and tasks yourself.</p>
            </div>
          ) : (
            columns.map((col) => {
              // your order on the board; the W pill shows when each task can start
              const list = ex.tasks.filter((t) => (t.agent || ORCH) === col.id)
              return (
                <Column
                  key={col.id}
                  id={col.id}
                  title={col.name}
                  sub={col.sub}
                  tasks={list.length}
                  drag={drag}
                  onDrag={setDrag}
                  onDropTask={moveTask}
                  onDropAgent={moveAgent}
                  onAdd={() => addTask(col.id === ORCH ? null : col.id)}
                >
                  {list.map((t) => (
                    <TaskCard
                      key={t.id}
                      task={t}
                      wave={waveOf.get(t.id) ?? 0}
                      titleOf={titleOf}
                      selected={t.id === selected}
                      drag={drag}
                      onSelect={setSelected}
                      onDrag={setDrag}
                      onDropBefore={placeBefore}
                    />
                  ))}
                  {drag?.kind === 'task' && !list.some((t) => t.id === drag.id) && <div className="drop-hint">Drop here</div>}
                </Column>
              )
            })
          )}
        </div>
      </main>

      {task && (
        <TaskInspector
          task={task}
          plan={plan}
          tasks={ex.tasks}
          titleOf={titleOf}
          onChange={(f) => setTask(task.id, f)}
          onRemove={() => {
            change((p) => {
              p.tasks = p.tasks.filter((t) => t.id !== task.id)
              p.tasks.forEach((t) => (t.deps = t.deps.filter((d) => d !== task.id)))
            })
            setSelected(null)
          }}
          onClose={() => setSelected(null)}
          onNavigate={onNavigate}
        />
      )}
    </>
  )
}
