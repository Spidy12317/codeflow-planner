// Plan data helpers: stable ids, an id → object index, and factories for new items.
// Tab shape: { folder, flows: [{ id, title, entry, spine, refs, notes }], positions? }

export const uid = (prefix = 'n') => `${prefix}${Math.random().toString(36).slice(2, 8)}`

const PS_KIDS = ['yes', 'no', 'body', 'handler']
const isWrap = (it) => it.kind === 'loop' || it.kind === 'try'

// Give every flow / spine item / pseudo line / ref / note an id. Returns true if anything changed.
export function normalizeTab(tab) {
  let changed = false
  const need = (o, p) => {
    if (!o.id) {
      o.id = uid(p)
      changed = true
    }
  }
  const ps = (arr) =>
    (arr || []).forEach((p) => {
      need(p, 'p')
      PS_KIDS.forEach((k) => ps(p[k]))
    })
  const spine = (arr) =>
    (arr || []).forEach((it) => {
      need(it, 's')
      if (isWrap(it)) spine(it.body)
      ;(it.details || []).forEach((d) => ps(d.items))
      if (it.except) ps(it.except.items)
    })
  for (const flow of tab.flows || []) {
    need(flow, 'f')
    spine(flow.spine)
    ;(flow.refs || []).forEach((r) => need(r, 'r'))
    ;(flow.notes || []).forEach((n) => need(n, 'm'))
  }
  return changed
}

// ref → { type, obj, arr, owner, flow }. Types: flow · spine · wrap · panel · except · ps · ref · note
export function indexTab(tab) {
  const idx = new Map()
  for (const flow of tab.flows || []) {
    idx.set(flow.id, { type: 'flow', obj: flow, arr: tab.flows, flow })
    const ps = (arr) =>
      (arr || []).forEach((p) => {
        idx.set(p.id, { type: 'ps', obj: p, arr, flow })
        PS_KIDS.forEach((k) => ps(p[k]))
      })
    const spine = (arr) =>
      (arr || []).forEach((it) => {
        idx.set(it.id, { type: isWrap(it) ? 'wrap' : 'spine', obj: it, arr, flow })
        if (isWrap(it)) spine(it.body)
        for (const d of it.details || []) {
          idx.set(`${it.id}:${d.side}`, { type: 'panel', obj: d, arr: it.details, owner: it, flow })
          ps(d.items)
        }
        if (it.except) {
          idx.set(`${it.id}:except`, { type: 'except', obj: it.except, owner: it, flow })
          ps(it.except.items)
        }
      })
    spine(flow.spine)
    ;(flow.refs || []).forEach((r) => idx.set(r.id, { type: 'ref', obj: r, arr: flow.refs, flow }))
    ;(flow.notes || []).forEach((n) => idx.set(n.id, { type: 'note', obj: n, arr: flow.notes, flow }))
  }
  return idx
}

// Short human label for a ref ("step 3 run pipeline with timeout (POST /queries)").
export function describeRef(tab, ref) {
  if (!tab || !ref) return null
  const e = indexTab(tab).get(ref)
  if (!e) return `(removed: ${ref})`
  const o = e.obj
  switch (e.type) {
    case 'flow': return `flow "${o.title}"`
    case 'spine': return `step ${o.num ?? ''} ${o.name} (${e.flow.title})`.replace(/\s+/g, ' ')
    case 'wrap': return `${o.kind} frame "${o.header || ''}" (${e.flow.title})`
    case 'panel':
    case 'except': return `panel "${o.title}" on ${e.owner.name || e.owner.header} (${e.flow.title})`
    case 'ps': return `${o.k} line "${o.t ?? `except ${o.except}`}" (${e.flow.title})`
    case 'ref': return `table ${o.title}`
    case 'note': return `note "${o.text.slice(0, 60)}"`
  }
  return ref
}

export function newPs(k = 'act') {
  const base = { id: uid('p'), k }
  if (k === 'cond') return { ...base, t: 'condition?', yes: [], no: [] }
  if (k === 'loop') return { ...base, t: 'for item in items', body: [newPs()] }
  if (k === 'try') return { ...base, body: [newPs()], except: 'Exception', handler: [newPs()] }
  return { ...base, t: 'new step' }
}

// Switch a pseudo line's kind, adding the child lists the new kind needs.
export function setPsKind(p, k) {
  p.k = k
  if (k === 'cond') {
    p.yes ??= []
    p.no ??= []
    p.t ||= 'condition?'
  }
  if (k === 'loop') {
    p.body ??= [newPs()]
    p.t ||= 'for item in items'
  }
  if (k === 'try') {
    p.body ??= [newPs()]
    p.handler ??= [newPs()]
    p.except ??= 'Exception'
  }
}

export const newStep = () => ({ id: uid('s'), kind: 'step', module: '', name: 'new step', inputs: [], returns: '' })

export const newFlow = () => ({ id: uid('f'), title: 'New flow', entry: '', spine: [newStep()], refs: [], notes: [] })

export const newPanel = (side) => ({ side, title: 'details', items: [newPs()] })

export const newRef = () => ({ id: uid('r'), title: 'NewModel', subtitle: '', rows: [['field', 'type', '']] })

export const newNote = (anchor) => ({ id: uid('m'), anchor, tone: 'note', text: 'What to change and why…' })
