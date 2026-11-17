// MCP tool definitions. Each tool validates its input, runs one use case against the plan
// bound to this session, and returns JSON. Writes go straight to the plan files; an open
// canvas picks them up live.
import { z } from 'zod'
import { readPlan } from '../../application/usecases/readPlan.js'
import { writeFlow } from '../../application/usecases/writeFlow.js'
import { editTab } from '../../application/usecases/editTab.js'
import { generateFlows } from '../../application/usecases/generateFlows.js'
import { listMessages, postMessage } from '../../application/usecases/threads.js'
import { updateProject } from '../../application/usecases/openProject.js'
import { syncPlan } from '../../application/usecases/syncPlan.js'
import { scaffoldProject } from '../../application/usecases/scaffoldProject.js'
import { classReport } from '../../application/usecases/classModel.js'
import { checkPlan } from '../../application/usecases/checkPlan.js'
import { planValidation } from '../../application/usecases/validatePlan.js'
import { readExecution, revealExecution, setExecutionModel, setExecutionStatus, writeExecution } from '../../application/usecases/execution.js'

const CHECK = 'Returns check (plan completeness: unwired new flows, unlinked calls, broken links, wrong change types); fix what it reports before presenting the plan.'

const TOPICS = ['planning', 'format', 'layers', 'new-project', 'execution', 'validation']

const json = (v) => ({ content: [{ type: 'text', text: typeof v === 'string' ? v : JSON.stringify(v) }] })
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true })

// Wrap a handler: errors become tool errors instead of protocol failures.
const run = (fn) => async (args) => {
  try {
    return json(await fn(args))
  } catch (e) {
    return fail(String(e.message || e))
  }
}

// Long lists are cut to the first few, with the number left out, so a result stays small
// however large the plan is.
const CAP = 8
const CHECK_LISTS = ['orphans', 'unlinked', 'broken', 'changeMismatches']
function briefCheck(check) {
  if (check.ok) return { ok: true, summary: check.summary }
  const more = Object.fromEntries(CHECK_LISTS.filter((k) => check[k].length > CAP).map((k) => [k, check[k].length - CAP]))
  const lists = Object.fromEntries(CHECK_LISTS.filter((k) => check[k].length).map((k) => [k, check[k].slice(0, CAP)]))
  return { ok: false, summary: check.summary, ...lists, ...(Object.keys(more).length && { more }) }
}
const ids = (list) => (list.length > CAP ? { count: list.length, first: list.slice(0, CAP) } : list)
// Sync report: ids for what changed, counts for what did not.
function briefSync({ folders, ...report }) {
  const brief = Object.fromEntries(
    Object.entries(folders).map(([folder, r]) => [
      folder,
      Object.fromEntries(
        Object.entries({ added: ids(r.added), updated: ids(r.updated), conflicts: ids(r.conflicts), unchanged: r.unchanged.length, handWritten: r.skippedManual.length }).filter(([, v]) => (Array.isArray(v) ? v.length : v)),
      ),
    ]),
  )
  const cut = (list) => (list.length > CAP ? [...list.slice(0, CAP), `(+${list.length - CAP} more)`] : list)
  return { summary: report.summary, folders: brief, warnings: cut(report.warnings), staleManual: cut(report.staleManual), changeMismatches: cut(report.changeMismatches) }
}

const Edit = z.object({
  ref: z.string().describe('id of the item; panel "<stepId>:left|right", try handler "<stepId>:except"'),
  op: z.enum(['set', 'insert_after', 'insert_before', 'append', 'remove']),
  fields: z.record(z.any()).optional().describe('for set: fields to change; null deletes a field'),
  item: z.any().optional().describe('for insert/append: the new item (same shape as its siblings)'),
  list: z.string().optional().describe('for append: yes|no|body|handler|items|spine|refs|notes|details'),
})

const Layers = z
  .object({ domain: z.array(z.string()), application: z.array(z.string()), adapters: z.array(z.string()), infrastructure: z.array(z.string()) })
  .partial()

// session: { open(root?) → result, ctx() → { repo, extractor, workspace }, guide(topic) → text }
export function registerTools(server, session) {
  const ctx = () => session.ctx()
  // Every plan write returns the completeness check, so it can't be skipped.
  const withCheck = (result) => ({ ...result, check: briefCheck(checkPlan(ctx())) })

  server.tool(
    'codeflow_open',
    'Open (or create) the plan in <root>/.codeflow and start this session\'s canvas UI. Call first, with the repo root. Returns the UI url, what to do next, and the working protocol to follow.',
    {
      root: z.string().optional().describe('absolute repo path; default: the server\'s working directory'),
      browser: z.boolean().optional().describe('open the browser (default true)'),
      protocol: z.boolean().optional().describe('false when you already have the protocol'),
    },
    run(({ root, browser, protocol }) => session.open(root, { browser, protocol })),
  )

  server.tool(
    'codeflow_guide',
    'One part of the Codeflow protocol; read it once, right before that kind of work. planning: drafting or changing flows (includes format). format: the plan\'s JSON shape. layers, new-project, execution, validation.',
    { topic: z.enum(TOPICS) },
    run(({ topic }) => session.guide(topic)),
  )

  server.tool(
    'codeflow_validate',
    'Validate flows against the code with sub-agents. No model: the size of the job and the questions to ask the user. With model and rewrite (the user\'s answers, never your choice): one ready prompt per sub-agent.',
    {
      model: z.string().optional().describe('haiku, sonnet, opus…'),
      rewrite: z.boolean().optional().describe('also reword flows into plain language'),
      folders: z.array(z.string()).optional(),
      includeTrivial: z.boolean().optional(),
    },
    run((args) => planValidation(ctx(), args)),
  )

  server.tool(
    'codeflow_read',
    'Read the plan. No folder: overview (flow counts per folder, layers, messages waiting) plus check. With folder: that tab, or one flow. format outline: compact text with every id, for reading and targeted edits; list: the folder\'s flow ids and titles; json (default): full shape, for rewriting a flow.',
    { folder: z.string().optional(), flow: z.string().optional().describe('flow id'), format: z.enum(['json', 'outline', 'list']).optional() },
    run((args) => (args.folder ? readPlan(ctx(), args) : withCheck(readPlan(ctx(), args)))),
  )

  server.tool(
    'codeflow_project',
    'Change the plan\'s name, folders (the tabs) or Clean Architecture layer mapping (folder prefixes per layer; confirm it with the user first). scaffold: create the planned folders on disk as Python packages, only after the user approved a new project\'s plan.',
    { name: z.string().optional(), folders: z.array(z.string()).optional(), layers: Layers.optional(), scaffold: z.boolean().optional() },
    run(({ scaffold, ...args }) => {
      const updated = updateProject(ctx(), args)
      return scaffold ? { ...updated, scaffold: scaffoldProject(ctx()) } : updated
    }),
  )

  server.tool(
    'codeflow_sync',
    `Refresh flows from the Python code in every folder (or the given ones): adds flows for new entry points, updates generated flows whose code changed (keeping status and notes), reports conflicts with hand edits and hand-written flows whose entry file is gone. entries / replace (one folder only): generate just those entry points; replace overwrites their flows. ${CHECK}`,
    {
      folders: z.array(z.string()).optional(),
      entries: z.array(z.string()).optional().describe('qualnames, e.g. "Service.method"'),
      replace: z.boolean().optional(),
    },
    run(async ({ folders, entries, replace }) => {
      if (!entries && !replace) return withCheck(briefSync(await syncPlan(ctx(), { folders })))
      if (folders?.length !== 1) throw new Error('entries / replace need exactly one folder in folders')
      return withCheck(await generateFlows(ctx(), { folder: folders[0], entries, replace }))
    }),
  )

  server.tool(
    'codeflow_classes',
    'UML class model of the code with Clean Architecture dependency-rule errors (DEP) and SOLID warnings (SRP, OCP, LSP, ISP, DIP). Refreshes from the code by default and updates the Classes view. classId: findings and detail for one class.',
    { refresh: z.boolean().optional(), classId: z.string().optional(), limit: z.number().int().optional() },
    run((args) => classReport(ctx(), args)),
  )

  // Checked in the handler, not advertised in the tool schema (the shape is in the execution guide).
  const Task = z.object({
    id: z.string().optional(),
    title: z.string(),
    desc: z.string().optional(),
    refs: z.array(z.object({ tab: z.string(), ref: z.string() })).optional(),
    deps: z.array(z.string()).optional(),
    agent: z.string().nullable().optional(),
    status: z.enum(['todo', 'in_progress', 'done', 'failed', 'blocked']).optional(),
  })
  const Agent = z.object({
    id: z.string().optional(),
    name: z.string(),
    type: z.string().optional(),
    model: z.string().optional(),
    isolation: z.enum(['none', 'worktree']).optional(),
    notes: z.string().optional(),
  })
  const ExecutionPlan = z.object({ orchestrator: z.object({ notes: z.string().optional() }).optional(), agents: z.array(Agent), tasks: z.array(Task) })

  server.tool(
    'codeflow_execution',
    'Execution plan (Execution view): orchestrator + sub-agents with tasks. Read codeflow_guide("execution") first: it has the plan shape. op read: plan, waves, ready tasks, problems, agents needing a model. write: replace the plan. set_status: one task. set_model: save the model the user chose (agentId, or every agent without one). reveal / hide: the view.',
    {
      op: z.enum(['read', 'write', 'set_status', 'set_model', 'reveal', 'hide']),
      plan: z.record(z.any()).optional().describe('{ orchestrator?, agents, tasks }'),
      taskId: z.string().optional(),
      status: z.enum(['todo', 'in_progress', 'done', 'failed', 'blocked']).optional(),
      agentId: z.string().optional(),
      model: z.string().optional(),
    },
    run(({ op, plan, taskId, status, agentId, model }) => {
      if (op === 'read') return readExecution(ctx())
      if (op === 'write') {
        if (!plan) throw new Error('write needs plan')
        const parsed = ExecutionPlan.safeParse(plan)
        if (!parsed.success) throw new Error(`Invalid plan: ${parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`)
        return writeExecution(ctx(), parsed.data)
      }
      if (op === 'set_status') return setExecutionStatus(ctx(), { taskId, status })
      if (op === 'set_model') return setExecutionModel(ctx(), { agentId, model })
      return revealExecution(ctx(), op === 'reveal')
    }),
  )

  server.tool(
    'codeflow_edit',
    `Change one folder tab. flow: create or replace a whole flow (matched by flow.id), for a new flow or a large rewrite. edits: targeted edits, applied all-or-nothing; set {status:"in_progress"} to track implementation, insert/append to add steps or lines, remove to delete. Pass one of flow or edits. The plan's JSON shape is in codeflow_guide("format"); read codeflow_guide("planning") before planning a change. ${CHECK}`,
    { folder: z.string(), flow: z.record(z.any()).optional(), edits: z.array(Edit).min(1).optional() },
    run(({ folder, flow, edits }) => {
      if (!flow === !edits) throw new Error('Pass one of flow or edits')
      return withCheck(flow ? writeFlow(ctx(), { folder, flow }) : editTab(ctx(), { folder, edits }))
    }),
  )

  server.tool(
    'codeflow_messages',
    'Canvas threads. op list (default): the user\'s messages with the node, class or task each is about; include defaults to threads awaiting your reply. op reply: reply in a thread (threadId), or start one on a node (folder + ref); resolve closes the thread.',
    {
      op: z.enum(['list', 'reply']).optional(),
      include: z.enum(['awaiting', 'open', 'all']).optional(),
      text: z.string().min(1).optional(),
      threadId: z.string().optional(),
      folder: z.string().optional(),
      ref: z.string().optional(),
      view: z.enum(['flows', 'classes', 'execution']).optional().describe('for a new thread on a class or task'),
      resolve: z.boolean().optional(),
    },
    run(({ op, include, ...args }) => {
      if (op !== 'reply') return listMessages(ctx(), include)
      if (!args.text) throw new Error('reply needs text')
      const { thread } = postMessage(ctx(), { ...args, author: 'claude' })
      return { ok: true, threadId: thread.id, status: thread.status }
    }),
  )
}
