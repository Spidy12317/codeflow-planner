// What a planned item does to the code: adds it (new), changes it (edit) or deletes it
// (remove). Independent of status, which tracks review and implementation.

export const CHANGES = ['new', 'edit', 'remove']
// Git-style letters for the explorer.
export const CHANGE_LETTER = { new: 'A', edit: 'M', remove: 'D' }

// { new: n, edit: n, remove: n } for everything inside a flow (the flow itself included).
export function changeCounts(flow) {
  const counts = {}
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    if (CHANGES.includes(v.change)) counts[v.change] = (counts[v.change] || 0) + 1
    for (const [k, x] of Object.entries(v)) if (k !== 'notes' && typeof x === 'object') walk(x)
  }
  if (CHANGES.includes(flow.change)) counts[flow.change] = 1
  walk(flow.spine)
  return counts
}

// One change for a file or folder: all additions → new, all removals → remove, else edit.
export function rollupChange(counts) {
  const kinds = CHANGES.filter((c) => counts[c])
  if (!kinds.length) return null
  return kinds.length === 1 ? kinds[0] : 'edit'
}

const IDENT = /^(?:async\s+)?([A-Za-z_]\w*)\s*(?:\(\))?$/
const defines = (text, name) => new RegExp(`^[ \\t]*(?:async[ \\t]+)?(?:def|class)[ \\t]+${name}\\b`, 'm').test(text)

// Does the step's code exist? Uses the step's dotted `module` (package.module[.Class...]) and,
// when it is a plain identifier, its `name`. → { found: boolean, where } or null if it can't tell.
// fs: { exists(rel) → boolean, read(rel) → string|null, list?(dir) → file names }, paths
// relative to the repo root. A package is searched through all its modules (re-exports).
export function locateStep(step, fs) {
  const parts = (step.module || '').split('.').filter(Boolean)
  if (parts.length < 2 || !parts.every((p) => /^[A-Za-z_]\w*$/.test(p))) return null
  // Only judge modules that live in this repo (their top package is on disk).
  if (!fs.exists(parts[0])) return null
  const name = IDENT.exec((step.name || '').trim())?.[1]
  for (let i = parts.length; i >= 1; i--) {
    const base = parts.slice(0, i).join('/')
    const file = fs.exists(`${base}.py`) ? `${base}.py` : fs.exists(`${base}/__init__.py`) ? `${base}/__init__.py` : null
    if (!file) continue
    const pkg = file.endsWith('/__init__.py') ? base : null
    const siblings = pkg && fs.list ? fs.list(pkg).filter((n) => n.endsWith('.py') && n !== '__init__.py').map((n) => `${pkg}/${n}`) : []
    const text = [file, ...siblings].map((f) => fs.read(f) || '').join('\n')
    const names = [...parts.slice(i), ...(name ? [name] : [])]
    const missing = names.find((n) => !defines(text, n))
    return { found: !missing, where: missing ? `${missing} in ${file}` : name || parts.length > i ? `${names.at(-1)} in ${file}` : file, moduleOnly: !name }
  }
  return { found: false, where: parts.join('.') }
}

// Items whose change type disagrees with the code: an edit/remove of something that isn't
// there, or something "new" that already exists. Done / in-progress items are skipped (the
// code is expected to have moved on). → [{ flow, ref, title, change, problem }]
export function changeMismatches(tab, fs) {
  const out = []
  const pending = (o) => o.status !== 'done' && o.status !== 'in_progress'
  for (const flow of tab.flows || []) {
    const visit = (o) => {
      if (!CHANGES.includes(o.change) || !pending(o) || o.kind === undefined) return
      const at = locateStep(o, fs)
      if (!at) return
      const title = o.name || o.header || o.kind
      if (o.change === 'new' && at.found) out.push({ flow: flow.id, ref: o.id, title, change: o.change, problem: at.moduleOnly ? `marked new but ${at.where} already exists: mark the step edit and only the added lines new` : `marked new but ${at.where} already exists (edit?)` })
      if (o.change !== 'new' && !at.found) out.push({ flow: flow.id, ref: o.id, title, change: o.change, problem: `marked ${o.change} but ${at.where} is not in the code (new?)` })
    }
    const walk = (v) => {
      if (Array.isArray(v)) return v.forEach(walk)
      if (!v || typeof v !== 'object') return
      visit(v)
      for (const [k, x] of Object.entries(v)) if (k !== 'notes' && typeof x === 'object') walk(x)
    }
    walk(flow.spine)
    if (flow.change === 'edit' || flow.change === 'remove') {
      const file = (flow.entry || '').split(':')[0]
      if (file && pending(flow) && !fs.exists(file)) out.push({ flow: flow.id, ref: flow.id, title: flow.title, change: flow.change, problem: `marked ${flow.change} but its entry file ${file} is missing (new?)` })
    }
  }
  return out
}

// For drawing: a copy of the flow where an item's change is dropped when it repeats the
// change of what contains it (flow → step → line). A new flow then shows NEW once, and an
// edited step shows only the lines that differ. Dropped ones keep `inheritedChange` so they
// can stay quiet instead of falling back to a status ring.
export function onlyDifferingChanges(flow) {
  const walk = (v, inherited) => {
    if (Array.isArray(v)) return v.map((x) => walk(x, inherited))
    if (!v || typeof v !== 'object') return v
    const out = {}
    const own = CHANGES.includes(v.change) ? v.change : null
    for (const [k, x] of Object.entries(v)) {
      if (k === 'change') continue
      out[k] = k === 'notes' ? x : walk(x, own || inherited)
    }
    if (own && own !== inherited) out.change = own
    else if (own) out.inheritedChange = own
    return out
  }
  const own = CHANGES.includes(flow.change) ? flow.change : null
  return { ...flow, spine: walk(flow.spine, own) }
}
