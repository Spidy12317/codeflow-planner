import { flowHash } from './sync.js'

// A compact text view of a flow for agents: every id an edit can target, one item per line,
// without the JSON punctuation (about a third of the size). Pure.

const LINE_KIDS = ['yes', 'no', 'body', 'handler']
const SIMPLE_LINES = new Set(['act', 'ret'])

const eachLine = (items, visit) =>
  (items || []).forEach((p) => {
    visit(p)
    LINE_KIDS.forEach((k) => eachLine(p[k], visit))
  })

// A generated, untouched flow with nothing to get wrong: one stage of plain statements, no
// branches, loops, error handling, call steps or links. Not worth a validation pass.
export function isTrivial(flow) {
  if (flow.origin !== 'generated' || flow.change || flowHash(flow) !== flow.genHash) return false
  if (flow.notes?.length) return false
  const [, ...rest] = flow.spine || []
  if (rest.length > 1) return false
  let lines = 0
  let simple = true
  for (const it of flow.spine || []) {
    if (it.kind !== 'step' || it.link || it.status || it.change) return false
    if (it !== flow.spine[0] && !it.details?.length) return false // a bare step is a call
    for (const d of it.details || []) {
      eachLine(d.items, (p) => {
        lines++
        if (!SIMPLE_LINES.has(p.k) || p.link) simple = false
      })
    }
  }
  return simple && lines <= 3
}

const link = (l) => `link→${l.tab}${l.flow ? `›${l.flow}` : ''}`
const tags = (o) => {
  const t = [o.change, o.status, o.aw && 'await', ...(o.badges || []), o.link && link(o.link)].filter(Boolean)
  return t.length ? ` {${t.join(', ')}}` : ''
}
const cols = (rows) => (rows || []).map(([n, t]) => (t ? `${n}: ${t}` : n)).join(', ')

function lines(items, pad, out) {
  for (const p of items || []) {
    out.push(`${pad}${p.id} ${p.k}: ${p.k === 'try' ? `except ${p.except || 'Exception'}` : p.t ?? ''}${tags(p)}`)
    for (const k of LINE_KIDS) {
      if (!p[k]?.length) continue
      out.push(`${pad}  ${k}:`)
      lines(p[k], pad + '    ', out)
    }
  }
}

function spine(items, pad, out) {
  for (const it of items || []) {
    if (it.kind === 'try' || it.kind === 'loop') {
      out.push(`${pad}${it.id} ${it.kind}: ${it.header || ''}${it.acc ? ` (acc ${it.acc})` : ''}${tags(it)}`)
      spine(it.body, pad + '  ', out)
      if (it.except) {
        out.push(`${pad}  ${it.id}:except "${[it.except.label, it.except.title].filter(Boolean).join(' ')}":`)
        lines(it.except.items, pad + '    ', out)
      }
      continue
    }
    const head = [
      `${pad}${it.id} ${it.kind}${it.num != null ? ` ${it.num}` : ''}: ${it.name || ''}`,
      it.module && ` [${it.module}]`,
      it.desc && ` — ${it.desc}`,
      it.inputs?.length && ` in(${cols(it.inputs)})`,
      it.returns && ` -> ${it.returns}`,
      it.kind === 'gather' && ` mode=${it.mode || 'gather'}`,
      tags(it),
    ]
    out.push(head.filter(Boolean).join(''))
    for (const t of it.tasks || []) out.push(`${pad}  task ${t.k}: ${t.t}${t.link ? ` {${link(t.link)}}` : ''}`)
    for (const d of it.details || []) {
      out.push(`${pad}  ${it.id}:${d.side} "${d.title || ''}":`)
      lines(d.items, pad + '    ', out)
    }
  }
}

const header = (fl) =>
  `flow ${fl.id} "${fl.title || ''}" @${fl.entry || '?'} [${fl.origin || 'manual'}]${fl.entrypoint ? ' entrypoint' : ''}${tags(fl)}`

export function flowOutline(flow) {
  const out = [header(flow)]
  spine(flow.spine, '  ', out)
  for (const r of flow.refs || []) out.push(`  ${r.id} table "${r.title}"${r.subtitle ? ` (${r.subtitle})` : ''}: ${cols(r.rows)}`)
  for (const n of flow.notes || []) out.push(`  ${n.id} note ${n.tone || 'note'}@${n.anchor || ''}: ${n.text}`)
  return out.join('\n')
}

// A whole tab. Trivial flows stay one line each unless expandTrivial.
export function tabOutline(tab, { expandTrivial = false } = {}) {
  const parts = (tab.flows || []).map((fl) => (!expandTrivial && isTrivial(fl) ? `${header(fl)} (trivial, not expanded)` : flowOutline(fl)))
  return [`folder ${tab.folder}: ${parts.length} flows`, ...parts].join('\n\n')
}
