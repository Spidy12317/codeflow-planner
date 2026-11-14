import { LAYERS, layerOf } from '../../../../domain/project/layers.js'
import { entryFile } from '../../../../domain/plan/sync.js'
import { pathTree } from '../../pathTree.js'

// Read-only roll-ups over the plan shared by the explorer and the overview page.

// Planned-change status, rolled up like VS Code's git colours: a flow, file or folder shows
// the most urgent status of anything inside it.
export const STATUS_PRIORITY = ['failed', 'in_progress', 'proposed', 'approved', 'done']
export const STATUS_LABEL = { failed: 'failed', in_progress: 'in progress', proposed: 'proposed', approved: 'approved', done: 'done' }

export function statusCounts(flow) {
  const counts = {}
  const walk = (v) => {
    if (Array.isArray(v)) return v.forEach(walk)
    if (!v || typeof v !== 'object') return
    if (v.status) counts[v.status] = (counts[v.status] || 0) + 1
    for (const [k, x] of Object.entries(v)) if (k !== 'notes' && typeof x === 'object') walk(x)
  }
  walk(flow.spine)
  return counts
}
export const addCounts = (list) => list.reduce((acc, c) => (Object.entries(c).forEach(([k, n]) => (acc[k] = (acc[k] || 0) + n)), acc), {})
export const topStatus = (c) => STATUS_PRIORITY.find((s) => c[s])
// The status a row's dot and colour show: finished work shows nothing, like a clean file.
export const shownStatus = (c) => {
  const s = topStatus(c)
  return s === 'done' ? undefined : s
}
export const statusLine = (c) => STATUS_PRIORITY.filter((s) => c[s]).map((s) => `${c[s]} ${STATUS_LABEL[s]}`).join(' · ')

// The explorer's folder tree: every plan folder in one directory tree, like VS Code. Not split
// by layer first: a per-layer tree would see "app" with a single child and compact it onto
// "app/domain", "app/application", ... rows.
export const explorerTree = (project) => pathTree(project?.folders || [], { sort: 'alpha' })

// Folders grouped by layer (unmapped folders last), as the overview page lists them.
export function groupFolders(project) {
  const folders = project?.folders || []
  if (!project?.layers) return [[null, folders]]
  const groups = LAYERS.map((l) => [l, folders.filter((f) => layerOf(project.layers, f) === l)])
  groups.push(['other', folders.filter((f) => !layerOf(project.layers, f))])
  return groups.filter(([, fs]) => fs.length)
}

// A flow's file, relative to its folder ("query_documents_routes.py"); null when the flow
// has no entry yet (a hand-drawn draft).
export function fileOf(folder, fl) {
  const f = entryFile(fl.entry)
  if (!f) return null
  return f.startsWith(`${folder}/`) ? f.slice(folder.length + 1) : f
}
