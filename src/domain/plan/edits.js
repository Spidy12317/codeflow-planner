import { indexTab, normalizeTab } from './model.js'

// Targeted edits to one tab, all-or-nothing: works on a copy and returns it only if every
// edit applies.
//   edit { ref, op: set|insert_after|insert_before|append|remove, fields?, item?, list? }
export function applyEdits(tab, edits) {
  const next = structuredClone(tab)
  const added = []
  for (const [n, ed] of edits.entries()) {
    const no = (msg) => {
      throw new Error(`Edit ${n}: ${msg}. Nothing was changed.`)
    }
    const e = indexTab(next).get(ed.ref)
    if (!e) no(`no item with ref "${ed.ref}"`)
    if (ed.op === 'set') {
      if (!ed.fields) no('set needs fields')
      for (const [k, v] of Object.entries(ed.fields)) {
        if (v === null) delete e.obj[k]
        else e.obj[k] = v
      }
    } else if (ed.op === 'remove') {
      if (e.type === 'panel') e.owner.details = e.owner.details.filter((d) => d !== e.obj)
      else if (e.type === 'except') no('remove the try frame instead of its handler')
      else e.arr.splice(e.arr.indexOf(e.obj), 1)
    } else if (ed.op === 'append') {
      if (!ed.item || !ed.list) no('append needs item and list')
      ;(e.obj[ed.list] ??= []).push(ed.item)
      added.push(ed.item)
    } else if (ed.op === 'insert_after' || ed.op === 'insert_before') {
      if (!ed.item) no(`${ed.op} needs item`)
      if (!e.arr) no(`"${ed.ref}" has no siblings to insert next to`)
      const i = e.arr.indexOf(e.obj)
      e.arr.splice(ed.op === 'insert_after' ? i + 1 : i, 0, ed.item)
      added.push(ed.item)
    } else {
      no(`unknown op "${ed.op}"`)
    }
  }
  normalizeTab(next)
  return { tab: next, newIds: added.map((a) => a.id) }
}

// Create or replace a whole flow in a tab (matched by flow.id).
export function putFlow(tab, flow) {
  if (!Array.isArray(flow.spine)) throw new Error('flow.spine must be an array')
  const i = flow.id ? tab.flows.findIndex((f) => f.id === flow.id) : -1
  if (i > -1) tab.flows[i] = flow
  else tab.flows.push(flow)
  normalizeTab(tab)
  return { replaced: i > -1 }
}
