import { normalizeExecution, readyTasks, setTaskStatus, validateExecution, waves } from '../../domain/execution/model.js'

const load = ({ repo }) => normalizeExecution(repo.readDoc('execution', {}))

// The plan with what the orchestrator needs to follow it: waves, ready tasks, problems.
export function readExecution(ctx) {
  const plan = load(ctx)
  const title = new Map(plan.tasks.map((t) => [t.id, t.title]))
  return {
    ...plan,
    waves: waves(plan).map((w) => w.map((id) => ({ id, title: title.get(id) }))),
    ready: readyTasks(plan).map((t) => t.id),
    unassigned: plan.tasks.filter((t) => !t.agent).map((t) => t.id),
    problems: validateExecution(plan),
  }
}

// Replace the plan (the orchestrator's proposal). Keeps the view's visibility.
export function writeExecution(ctx, plan) {
  const cur = load(ctx)
  const next = normalizeExecution({ ...plan, visible: plan.visible ?? cur.visible })
  const problems = validateExecution(next)
  ctx.repo.writeDoc('execution', next)
  return { ok: true, agents: next.agents.length, tasks: next.tasks.length, problems }
}

export function setExecutionStatus(ctx, { taskId, status }) {
  const plan = load(ctx)
  const task = setTaskStatus(plan, taskId, status)
  ctx.repo.writeDoc('execution', plan)
  return { ok: true, task: task.id, status, ready: readyTasks(plan).map((t) => t.id) }
}

export function revealExecution(ctx, visible = true) {
  const plan = load(ctx)
  plan.visible = visible
  ctx.repo.writeDoc('execution', plan)
  return { ok: true, visible }
}
