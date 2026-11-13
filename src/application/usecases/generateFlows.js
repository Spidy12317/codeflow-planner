import { flowHash } from '../../domain/plan/sync.js'
import { requireFolder } from './readPlan.js'

const asGenerated = (f) => ({ ...f, origin: 'generated', genHash: flowHash(f) })

// Entry points found in a folder's code (for the canvas picker).
export function scanFolder({ repo, extractor }, folder) {
  const project = repo.readProject()
  requireFolder(project, folder)
  return extractor.scan(project, folder)
}

// Flows for the picked entry points, without saving (the canvas applies them as an undoable edit).
export async function previewFlows({ repo, extractor }, { folder, entries }) {
  const project = repo.readProject()
  requireFolder(project, folder)
  if (!entries?.length) throw new Error('Pick at least one entry point')
  const { flows, warnings } = await extractor.generate(project, folder, entries)
  return { flows: flows.map(asGenerated), warnings }
}

// Generate and save. No entries: every entry point that has no flow yet.
// replace: overwrite existing flows for those entries.
export async function generateFlows({ repo, extractor }, { folder, entries, replace }) {
  const project = repo.readProject()
  requireFolder(project, folder)
  const tab = repo.readTab(folder) || { folder, flows: [] }
  const existing = new Set(tab.flows.map((f) => f.id))
  let wanted = entries
  let skipped = []
  if (!wanted?.length) {
    const scan = await extractor.scan(project, folder)
    skipped = replace ? [] : scan.entries.filter((e) => existing.has(e.id)).map((e) => e.qualname)
    wanted = scan.entries.map((e) => e.qualname).filter((q) => !skipped.includes(q))
  }
  if (!wanted.length) return { ok: true, generated: [], skipped, note: 'Nothing new to generate' }
  const { flows, warnings } = await extractor.generate(project, folder, wanted)
  const generated = []
  for (const f of flows.map(asGenerated)) {
    const i = tab.flows.findIndex((x) => x.id === f.id)
    if (i > -1 && !replace && entries?.length) {
      skipped.push(f.id)
      continue
    }
    if (i > -1) tab.flows[i] = f
    else tab.flows.push(f)
    generated.push(f.id)
  }
  repo.writeTab(tab)
  return { ok: true, generated, skipped, warnings }
}
