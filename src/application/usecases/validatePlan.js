import { PLAIN_WORDS, PLAN_FORMAT } from '../../domain/plan/format.js'
import { validationGroups, validationScope } from '../../domain/plan/validation.js'

const MODELS = [
  { label: 'Haiku', description: 'fastest and uses the least of the usage limit; may miss subtle mismatches' },
  { label: 'Sonnet', description: 'a middle ground in speed, usage and accuracy' },
  { label: 'Opus', description: 'most thorough; uses the most of the usage limit' },
  { label: 'Skip', description: 'keep the flows as generated; the user can ask to validate them later' },
]
const REWRITE = [
  { label: 'Accuracy only', value: false, description: 'check each flow against the code and fix what is wrong; wording stays as generated' },
  { label: 'Accuracy + plain language', value: true, description: 'also reword every card and line for non-technical readers; uses noticeably more of the usage limit' },
]

const AFTER = `When the sub-agents have reported: 1. apply the cross-folder links and fixes they reported; 2. fix what check reports (codeflow_read with no folder); 3. tell the user in a few lines: flows checked, flows fixed (and the most common kind of fix), questions left on the canvas, and anything the extractor cannot capture.`

function prompt({ root, group, rewrite }) {
  const owned = group.folders.map((s) => `- ${s.folder}: ${s.trivial ? `only these flows: ${s.flows.join(', ')}` : `all ${s.flows.length} flows`}`).join('\n')
  const steps = [
    'codeflow_read({ folder, format: "outline" }) once per folder: a compact view with every id you can edit. Flows shown as "trivial" are skipped. Then read each flow\'s entry file (the @path:line in its header) and the code it calls.',
    'Compare the flow with the code: the entry line is right; the steps exist in this order; every call, condition, loop, try/except, raise and return matches the code; nothing is invented and nothing important is missing (a call into this repo, an awaited call, a raise, an early return).',
    'Fix what is wrong with codeflow_edit({ folder, edits }), all edits for one flow in one call. Rewrite a whole flow (codeflow_edit with flow) only when most of it is wrong; get its JSON first with codeflow_read({ folder, flow }). Keep ids, status, notes and genHash. Do not add status or change: those are for planned changes, not existing code.',
    rewrite
      ? `Reword every card and line so a non-technical reader can follow it, keeping the meaning and moving detail that matters into notes. ${PLAIN_WORDS}`
      : 'Leave correct cards and lines exactly as they are: do not reword, tidy or reformat them.',
    'Add links: a step or line that calls code whose flow is in one of your folders gets link: { tab, flow }. For a flow in a folder you do not own, report it instead (codeflow_read({ folder, format: "list" }) shows a folder\'s flow ids).',
    'When the code is ambiguous or the answer needs the user, add a question or check note to the step instead of guessing.',
    'Flag public code in your folders that has no flow and should have one (an entry point the extractor missed).',
  ]
  return `You are validating Codeflow flows (a visual plan of this repo's code) against the code they describe.
Repo root: ${root}
You own these plan folders. Change only their plans with the codeflow MCP tools; never edit code or another folder's plan:
${owned}

For each of those flows:
${steps.map((s, i) => `${i + 1}. ${s}`).join('\n')}

Edit results include a plan-wide check; ignore it unless it names one of your flows.

Report back, kept short: per flow "ok", "fixed: <what>" or "needs user: <question>"; the cross-folder links or fixes you could not make; anything the extractor got systematically wrong.

${PLAN_FORMAT}`
}

// Step 1 (no model): the size of the job and the question to put to the user.
// Step 2 (model + rewrite, the user's answers): one ready prompt per sub-agent.
export function planValidation({ repo }, { model, rewrite, folders, includeTrivial } = {}) {
  const project = repo.readProject()
  const scope = validationScope(repo.listTabs(), folders?.length ? folders : project.folders, { includeTrivial })
  const groups = validationGroups(scope)
  const size = {
    flows: scope.reduce((n, s) => n + s.flows.length, 0),
    trivialSkipped: scope.reduce((n, s) => n + s.trivial, 0),
    folders: scope.length,
    subAgents: groups.length,
  }
  if (!size.flows) return { size, note: 'Nothing to validate: no flows, or only trivial ones (pass includeTrivial to check those too).' }
  if (!model) {
    return {
      size,
      ask: {
        how: 'Ask the user both questions in one call of your question tool (plain text if you have none). Mark no option as recommended or default, and do not answer for them. Then call codeflow_validate again with model and rewrite. On Skip, stop.',
        questions: [
          { question: `Validate ${size.flows} flows in ${size.folders} folders against the code with ${size.subAgents} sub-agent${size.subAgents > 1 ? 's' : ''}? Which model should they run on?`, options: MODELS },
          { question: 'What should the validation do?', options: REWRITE },
        ],
      },
    }
  }
  if (typeof rewrite !== 'boolean') throw new Error('Pass rewrite (true or false) with the user\'s answer to the second question; call without model to get the questions.')
  return {
    size,
    model,
    rewrite,
    run: `Spawn one sub-agent per entry in agents, in parallel, every one on model "${model}" (e.g. the Agent tool's model parameter) with its prompt as given. Without sub-agents, work through the prompts yourself.`,
    agents: groups.map((group, i) => ({ name: `validate-${i + 1}`, model, folders: group.folders.map((s) => s.folder), flows: group.flows, prompt: prompt({ root: project.root, group, rewrite }) })),
    after: AFTER,
  }
}
