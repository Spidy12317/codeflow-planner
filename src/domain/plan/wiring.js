import { CHANGES, changeCounts, rollupChange } from './change.js'

// Is every planned piece connected to the rest of the plan? A new flow nobody calls, or a
// call to a planned flow without a link, usually means the plan forgot the wiring (the import,
// the constructor call, the factory case). Pure: works on { folder: tab }.

const HTTP = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS|WS|WEBSOCKET)\s/i
const TEXT_FIELDS = ['t', 'name', 'module', 'header']

const isNewFlow = (fl) => (fl.change || rollupChange(changeCounts(fl))) === 'new'
const planned = (o) => CHANGES.includes(o.change) && o.change !== 'remove'
// How code refers to a flow, from its title: "ClaudeClient.complete …" → `ClaudeClient(` (built)
// or `ClaudeClient.complete`; "ingest_document" → `ingest_document(`. A plain-word title
// ("Anthropic settings") has no code name, so only explicit links count for it.
function referenceOf(fl) {
  const m = /^([A-Za-z_]\w*)(?:\.([A-Za-z_]\w*))?(\()?/.exec(fl.title || '')
  if (!m) return null
  const [, a, b, call] = m
  if (!b && !call && !/[a-z][A-Z]|_|^[A-Z][a-z]+[A-Z]/.test(a)) return null
  const forms = [`\\b${a}\\(`]
  if (b && b !== '__init__') forms.push(`\\b${a}\\.${b}\\b`)
  if (!b) forms.push(`\\b${a}\\.`)
  return { name: b && b !== '__init__' ? `${a}.${b}` : a, re: new RegExp(forms.join('|')) }
}
const mentions = (o, ref) => TEXT_FIELDS.some((k) => typeof o[k] === 'string' && ref.re.test(o[k]))

// Every object inside a flow, with the change it inherits from its containers.
function eachItem(flow, visit) {
  const walk = (v, inherited) => {
    if (Array.isArray(v)) return v.forEach((x) => walk(x, inherited))
    if (!v || typeof v !== 'object') return
    const change = CHANGES.includes(v.change) ? v.change : inherited
    if (v.id) visit(v, change)
    for (const [k, x] of Object.entries(v)) if (k !== 'notes' && typeof x === 'object') walk(x, change)
  }
  walk(flow.spine, CHANGES.includes(flow.change) ? flow.change : null)
}

// → { orphans, unlinked, broken } (each a list of plain objects with a `problem` sentence)
export function wiringGaps(tabs) {
  const flows = Object.entries(tabs).flatMap(([folder, tab]) => (tab.flows || []).map((fl) => ({ folder, fl })))
  const exists = (link) => !!tabs[link.tab] && (!link.flow || tabs[link.tab].flows.some((f) => f.id === link.flow))
  const out = { orphans: [], unlinked: [], broken: [] }

  // Links that point nowhere.
  for (const { folder, fl } of flows) {
    eachItem(fl, (o, change) => {
      if (o.link && change && !exists(o.link)) out.broken.push({ folder, flow: fl.id, ref: o.id, link: o.link, problem: `links to ${o.link.tab}${o.link.flow ? ` › ${o.link.flow}` : ''}, which does not exist` })
    })
  }

  // New flows: who calls them?
  for (const { folder, fl } of flows) {
    if (!isNewFlow(fl) || fl.entrypoint || HTTP.test(fl.title || '') || fl.status === 'done') continue
    const ref = referenceOf(fl)
    let linked = false
    const loose = []
    for (const other of flows) {
      if (other.fl === fl) continue
      eachItem(other.fl, (o, change) => {
        const toThis = o.link && o.link.tab === folder && (!o.link.flow || o.link.flow === fl.id)
        if (toThis && (o.link.flow || (ref && mentions(o, ref)))) linked = true
        else if (ref && change && planned({ change }) && mentions(o, ref)) loose.push({ folder: other.folder, flow: other.fl.id, ref: o.id, text: o.t || o.name })
      })
    }
    for (const m of loose) out.unlinked.push({ ...m, target: { tab: folder, flow: fl.id }, problem: `mentions ${ref.name} but has no link to the flow "${fl.title}"` })
    if (!linked && !loose.length) out.orphans.push({ folder, flow: fl.id, title: fl.title, problem: `new flow "${fl.title}" is not called from anywhere in the plan: plan its caller (construction, import, registration) or mark it entrypoint` })
  }
  return out
}
