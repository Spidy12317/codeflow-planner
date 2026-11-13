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
import { readExecution, revealExecution, setExecutionStatus, writeExecution } from '../../application/usecases/execution.js'

const FORMAT = `Plan format (ids optional on new items; keep existing ids):
Flow {id,title,entry:"path.py:line",change?,entrypoint?:true (called from outside the plan: HTTP route, CLI, job),spine:[Step|Gather|Try|Loop],refs?:[{title,subtitle?,rows:[[name,type,desc]]}],notes?:[{anchor:stepId,tone:note|check|fix|idea|question,text}]}
Step {kind:"step",module,num?,name,desc?,badges?:["await"|"loop"|"background"],status?,change?,link?:{tab:folder,flow?},inputs?:[[name,type,desc]],returns?,details?:[{side:"left"|"right",title,items:[Line]}]}
Gather = Step + {kind:"gather",mode:"gather"|"race"|"any",modeNote?,fanout?,tasks:[{k:"call"|"timer"|"ext",t,note?,link?}]}
Try {kind:"try",header,body:[spine items],except:{label,title?,items:[Line]}} · Loop {kind:"loop",header,acc?,body:[spine items]}
Line {k:"act"|"call"|"ext"|"raise"|"ret"|"jump",t,aw?:true,link?,status?,change?} · {k:"cond",t,yes:[Line],no:[Line]} · {k:"loop",t,acc?,body:[Line]} · {k:"try",body:[Line],except:"Exception",handler:[Line]}
status: proposed|approved|in_progress|done|failed. change: new (adds code) | edit (changes existing code) | remove (deletes it); set it on every planned item, on the most specific item (a new case inside an existing function = that Line is new, its step is edit). Vertical spine = sequence; details = drill-down panels.
Write for non-technical readers, in plain English: step name = plain action ("Ask Claude for an answer"), code location in module; desc one sentence on why; lines one short sentence each: decisions as questions ("Is Claude set up?"), errors as "Stop: <reason>", results as "Send back <what>", loops as "For each <thing>"; no code expressions, argument lists, settings names, log text or jargon; reasons and caveats go in notes.`

const CHECK = 'Returns check: the completeness check of the whole plan (new flows nothing calls, calls without a link, broken links, change types that disagree with the code); fix everything it reports before presenting the plan.'

const json = (v) => ({ content: [{ type: 'text', text: JSON.stringify(v) }] })
const fail = (msg) => ({ content: [{ type: 'text', text: msg }], isError: true })

// Wrap a handler: errors become tool errors instead of protocol failures.
const run = (fn) => async (args) => {
  try {
    return json(await fn(args))
  } catch (e) {
    return fail(String(e.message || e))
  }
}

const Edit = z.object({
  ref: z.string().describe('id of a flow, step, line, table or note; panels are "<stepId>:left|right", a try handler "<stepId>:except"'),
  op: z.enum(['set', 'insert_after', 'insert_before', 'append', 'remove']),
  fields: z.record(z.any()).optional().describe('for set: fields to change; null deletes a field'),
  item: z.any().optional().describe('for insert/append: the new item (same shape as its siblings)'),
  list: z.string().optional().describe('for append: yes|no|body|handler|items|spine|refs|notes|details'),
})

const Layers = z
  .object({ domain: z.array(z.string()), application: z.array(z.string()), adapters: z.array(z.string()), infrastructure: z.array(z.string()) })
  .partial()

// session: { open(root?) → result, ctx() → { repo, extractor, workspace } }
export function registerTools(server, session) {
  const ctx = () => session.ctx()
  // Every plan write returns the completeness check, so it can't be skipped.
  const withCheck = (result) => ({ ...result, check: checkPlan(ctx()) })

  server.tool(
    'codeflow_open',
    'Open (or create) the plan in <root>/.codeflow and start this session\'s canvas UI. Call first, with the repo root (your working directory). Returns the UI url and what to do next.',
    { root: z.string().optional().describe('absolute path of the repo; default: the server\'s working directory'), browser: z.boolean().optional().describe('open the browser (default true)') },
    run(({ root, browser }) => session.open(root, { browser })),
  )

  server.tool(
    'codeflow_read',
    'Read the code-flow plan. No folder: overview of folders, layers, flows and messages waiting for you, plus check (the completeness check). With folder: that tab (optionally one flow).',
    { folder: z.string().optional(), flow: z.string().optional().describe('flow id') },
    run((args) => (args.folder ? readPlan(ctx(), args) : withCheck(readPlan(ctx(), args)))),
  )

  server.tool(
    'codeflow_project',
    'Change the plan\'s name, folders (the tabs) or Clean Architecture layer mapping { domain, application, adapters, infrastructure: [folder prefixes] }. Confirm a layer mapping with the user before setting it. scaffold: create the planned folders on disk as Python packages, only after the user approved the plan for a new project.',
    { name: z.string().optional(), folders: z.array(z.string()).optional(), layers: Layers.optional(), scaffold: z.boolean().optional() },
    run(({ scaffold, ...args }) => {
      const updated = updateProject(ctx(), args)
      return scaffold ? { ...updated, scaffold: scaffoldProject(ctx()) } : updated
    }),
  )

  server.tool(
    'codeflow_sync',
    `Refresh flows from the Python code in every folder (or the given ones): adds flows for new entry points, updates generated flows whose code changed (keeping status and notes), and reports conflicts with hand edits and hand-written flows whose entry file is gone. entries / replace (one folder only): generate just those entry points (qualnames, e.g. "Service.method"); replace overwrites their existing flows. ${CHECK}`,
    {
      folders: z.array(z.string()).optional(),
      entries: z.array(z.string()).optional().describe('qualnames, e.g. "Service.method"'),
      replace: z.boolean().optional(),
    },
    run(async ({ folders, entries, replace }) => {
      if (!entries && !replace) return withCheck(await syncPlan(ctx(), { folders }))
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

  const Task = z.object({
    id: z.string().optional(),
    title: z.string(),
    desc: z.string().optional(),
    refs: z.array(z.object({ tab: z.string(), ref: z.string() })).optional().describe('flow nodes this task implements'),
    deps: z.array(z.string()).optional().describe('task ids that must be done first'),
    agent: z.string().nullable().optional().describe('agent id; null = orchestrator does it'),
    status: z.enum(['todo', 'in_progress', 'done', 'failed', 'blocked']).optional(),
  })
  const Agent = z.object({
    id: z.string().optional(),
    name: z.string(),
    type: z.string().optional().describe('sub-agent type, e.g. general-purpose'),
    model: z.string().optional(),
    isolation: z.enum(['none', 'worktree']).optional(),
    notes: z.string().optional(),
  })

  server.tool(
    'codeflow_execution',
    'Execution plan shown in the (normally hidden) Execution view: orchestrator + sub-agents with assigned tasks. op read: plan, waves, ready tasks, problems. op write: replace the plan (propose a split). op set_status: update one task. op reveal / hide: show or hide the view. Follow the user\'s assignment exactly when executing.',
    {
      op: z.enum(['read', 'write', 'set_status', 'reveal', 'hide']),
      plan: z.object({ orchestrator: z.object({ notes: z.string().optional() }).optional(), agents: z.array(Agent), tasks: z.array(Task) }).optional(),
      taskId: z.string().optional(),
      status: z.enum(['todo', 'in_progress', 'done', 'failed', 'blocked']).optional(),
    },
    run(({ op, plan, taskId, status }) => {
      if (op === 'read') return readExecution(ctx())
      if (op === 'write') {
        if (!plan) throw new Error('write needs plan')
        return writeExecution(ctx(), plan)
      }
      if (op === 'set_status') return setExecutionStatus(ctx(), { taskId, status })
      return revealExecution(ctx(), op === 'reveal')
    }),
  )

  server.tool(
    'codeflow_edit',
    `Change one folder tab. flow: create or replace a whole flow (matched by flow.id), for drafting a new flow or a large rewrite. edits: targeted edits, applied all-or-nothing; use set {status:"in_progress"} to track implementation, insert/append to add steps or lines, remove to delete. Pass one of flow or edits. ${CHECK}\n${FORMAT}`,
    { folder: z.string(), flow: z.record(z.any()).optional(), edits: z.array(Edit).min(1).optional() },
    run(({ folder, flow, edits }) => {
      if (!flow === !edits) throw new Error('Pass one of flow or edits')
      return withCheck(flow ? writeFlow(ctx(), { folder, flow }) : editTab(ctx(), { folder, edits }))
    }),
  )

  server.tool(
    'codeflow_messages',
    'Canvas threads. op list (default): messages the user left on the canvas, with the node, class or task each one is about; include defaults to threads waiting for your reply. op reply: reply in a thread (threadId), or start one on a node (folder + ref) to ask the user something or report progress; resolve closes the thread.',
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
