import { uid } from '../plan/model.js'

// Execution plan: the orchestrator splits approved work into tasks and assigns them to
// sub-agents; the user rearranges the split on the canvas; the orchestrator then follows it.
//   { visible, orchestrator: { notes }, agents: [{ id, name, type?, model?, isolation?, notes? }],
//     tasks: [{ id, title, desc?, refs: [{ tab, ref }], deps: [taskId], agent: agentId | null, status }] }

export const TASK_STATUS = ['todo', 'in_progress', 'done', 'failed', 'blocked']

export const emptyExecution = () => ({ visible: false, orchestrator: { notes: '' }, agents: [], tasks: [] })

export function normalizeExecution(plan) {
  const p = { ...emptyExecution(), ...plan }
  p.orchestrator = { notes: '', ...p.orchestrator }
  p.agents = (p.agents || []).map((a) => ({ ...a, id: a.id || uid('a'), name: a.name || 'agent' }))
  p.tasks = (p.tasks || []).map((t) => ({ refs: [], deps: [], agent: null, status: 'todo', ...t, id: t.id || uid('k') }))
  return p
}

// Problems that block execution: unknown agents or deps, and dependency cycles.
export function validateExecution(plan) {
  const problems = []
  const agents = new Set(plan.agents.map((a) => a.id))
  const tasks = new Map(plan.tasks.map((t) => [t.id, t]))
  for (const t of plan.tasks) {
    if (t.agent && !agents.has(t.agent)) problems.push(`Task "${t.title}" is assigned to unknown agent ${t.agent}`)
    for (const d of t.deps) if (!tasks.has(d)) problems.push(`Task "${t.title}" depends on unknown task ${d}`)
  }
  const state = new Map()
  const visit = (id, trail) => {
    if (state.get(id) === 'done') return
    if (state.get(id) === 'active') {
      problems.push(`Dependency cycle: ${[...trail, id].map((x) => tasks.get(x)?.title || x).join(' → ')}`)
      return
    }
    state.set(id, 'active')
    for (const d of tasks.get(id)?.deps || []) if (tasks.has(d)) visit(d, [...trail, id])
    state.set(id, 'done')
  }
  for (const t of plan.tasks) visit(t.id, [])
  return problems
}

// Tasks grouped into waves: a task's wave is one after its latest dependency.
export function waves(plan) {
  const tasks = new Map(plan.tasks.map((t) => [t.id, t]))
  const memo = new Map()
  const level = (id, seen = new Set()) => {
    if (memo.has(id)) return memo.get(id)
    if (seen.has(id)) return 0 // cycle; reported by validateExecution
    seen.add(id)
    const deps = (tasks.get(id)?.deps || []).filter((d) => tasks.has(d))
    const l = deps.length ? 1 + Math.max(...deps.map((d) => level(d, seen))) : 0
    memo.set(id, l)
    return l
  }
  const out = []
  for (const t of plan.tasks) (out[level(t.id)] ??= []).push(t.id)
  return out.filter(Boolean)
}

// Tasks whose deps are all done and that haven't started.
export const readyTasks = (plan) => {
  const done = new Set(plan.tasks.filter((t) => t.status === 'done').map((t) => t.id))
  return plan.tasks.filter((t) => t.status === 'todo' && t.deps.every((d) => done.has(d)))
}

export function setTaskStatus(plan, taskId, status) {
  if (!TASK_STATUS.includes(status)) throw new Error(`status must be one of ${TASK_STATUS.join(', ')}`)
  const t = plan.tasks.find((x) => x.id === taskId)
  if (!t) throw new Error(`No task ${taskId}`)
  t.status = status
  return t
}

// Agents that still have work and no model: the user chooses it, never the orchestrator.
export function agentsWithoutModel(plan) {
  const busy = new Set(plan.tasks.filter((t) => t.agent && t.status !== 'done').map((t) => t.agent))
  return plan.agents.filter((a) => !a.model && busy.has(a.id))
}

// Set the model on one agent, or on every agent that has none.
export function setAgentModel(plan, { agentId, model }) {
  if (!model) throw new Error('set_model needs model')
  const targets = agentId ? plan.agents.filter((a) => a.id === agentId) : plan.agents.filter((a) => !a.model)
  if (agentId && !targets.length) throw new Error(`No agent ${agentId}`)
  for (const a of targets) a.model = model
  return targets
}
