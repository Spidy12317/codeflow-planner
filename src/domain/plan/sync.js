// Refreshing generated flows from code without losing work done on the canvas.
//
// A generated flow keeps genHash, a fingerprint of the content the extractor produced.
//   code unchanged (fresh hash == genHash)        → keep the flow as it is
//   code changed, flow untouched (flow == genHash) → take the fresh flow, carry over status,
//                                                    collapsed and notes
//   code changed and flow edited by hand           → conflict: keep the flow, add a note
// Flows with origin "manual" (or none, from older plans) are never regenerated.

const VOLATILE = new Set(['id', 'status', 'change', 'collapsed', 'notes', 'origin', 'genHash', 'anchor'])

function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object') {
    return `{${Object.keys(v)
      .filter((k) => !VOLATILE.has(k))
      .sort()
      .map((k) => `${k}:${stable(v[k])}`)
      .join(',')}}`
  }
  return JSON.stringify(v)
}

// FNV-1a over the flow's content, ignoring ids and canvas-only state.
export function flowHash(flow) {
  const s = stable(flow)
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(16).padStart(8, '0')
}

// Every object with an id inside a flow, plus a fallback key for steps so status survives
// when the extractor numbers ids differently.
function walk(node, visit) {
  if (Array.isArray(node)) return node.forEach((n) => walk(n, visit))
  if (!node || typeof node !== 'object') return
  if (node.id) visit(node)
  for (const [k, v] of Object.entries(node)) if (k !== 'notes' && typeof v === 'object') walk(v, visit)
}
const stepKey = (o) => (o.kind && o.name ? `${o.kind}:${o.module || ''}:${o.name}` : null)

// Fresh generated flow with the old flow's status / collapsed / notes carried over.
export function carryOver(old, fresh) {
  const byId = new Map()
  const byKey = new Map()
  walk(old.spine, (o) => {
    byId.set(o.id, o)
    const k = stepKey(o)
    if (k) byKey.set(k, o)
  })
  const ids = new Set()
  walk(fresh.spine, (o) => {
    ids.add(o.id)
    const prev = byId.get(o.id) || (stepKey(o) && byKey.get(stepKey(o)))
    if (!prev) return
    if (prev.status) o.status = prev.status
    if (prev.change) o.change = prev.change
    if (prev.collapsed) o.collapsed = true
  })
  const first = fresh.spine?.[0]?.id
  const notes = (old.notes || []).map((n) => (ids.has(n.anchor) || !first ? n : { ...n, anchor: first }))
  return { ...fresh, id: old.id, ...(old.change && { change: old.change }), notes: [...(fresh.notes || []), ...notes] }
}

// Merge freshly generated flows into a tab. Returns the counts for the sync report.
export function mergeGenerated(tab, freshFlows) {
  const report = { added: [], updated: [], unchanged: [], conflicts: [], skippedManual: [] }
  for (const fresh of freshFlows) {
    const hash = flowHash(fresh)
    const i = findFlow(tab.flows, fresh)
    const gen = { ...fresh, origin: 'generated', genHash: hash }
    if (i < 0) {
      tab.flows.push(gen)
      report.added.push(fresh.id)
      continue
    }
    const cur = tab.flows[i]
    if (cur.origin !== 'generated') {
      report.skippedManual.push(cur.id)
    } else if (cur.genHash === hash) {
      report.unchanged.push(cur.id)
    } else if (flowHash(cur) === cur.genHash) {
      tab.flows[i] = { ...carryOver(cur, fresh), origin: 'generated', genHash: hash }
      report.updated.push(cur.id)
    } else {
      const text = 'Code changed since this flow was generated, and the flow was edited by hand. Update it by hand, or regenerate it (codeflow_sync with replace).'
      const notes = (cur.notes || []).filter((n) => n.text !== text)
      cur.notes = [...notes, { anchor: cur.spine?.[0]?.id, tone: 'check', text }]
      report.conflicts.push(cur.id)
    }
  }
  return report
}

// "path/to/file.py:12" → "path/to/file.py"
export const entryFile = (entry) => (entry || '').replace(/:\d+$/, '')
const entryLine = (entry) => Number(/:(\d+)$/.exec(entry || '')?.[1] ?? NaN)

// The existing flow for a generated one: same id, or (hand-drawn flows with their own ids)
// the same entry point, allowing a few lines of drift.
function findFlow(flows, fresh) {
  const byId = flows.findIndex((f) => f.id === fresh.id)
  if (byId > -1 || !fresh.entry) return byId
  return flows.findIndex(
    (f) => f.origin !== 'generated' && entryFile(f.entry) === entryFile(fresh.entry) && Math.abs(entryLine(f.entry) - entryLine(fresh.entry)) <= 5,
  )
}
