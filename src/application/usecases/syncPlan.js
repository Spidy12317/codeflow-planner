import { entryFile, mergeGenerated } from '../../domain/plan/sync.js'
import { changeMismatches } from '../../domain/plan/change.js'

// Refresh every folder from the code: add flows for new entry points, update generated
// flows whose code changed (keeping status and notes), report conflicts, stale flows, and
// planned items whose change type (new / edit / remove) disagrees with the code.
export async function syncPlan({ repo, extractor, workspace }, { folders } = {}) {
  const project = repo.readProject()
  const report = { folders: {}, warnings: [], staleManual: [], changeMismatches: [] }
  const code = { exists: (rel) => workspace.fileExists(project.root, rel), read: (rel) => workspace.readFile(project.root, rel), list: (rel) => workspace.listFiles(project.root, rel) }
  for (const folder of folders || project.folders) {
    const tab = repo.readTab(folder) || { folder, flows: [] }
    let scan
    try {
      scan = await extractor.scan(project, folder)
    } catch (e) {
      report.warnings.push(`${folder}: ${e.message}`)
      continue
    }
    report.warnings.push(...(scan.warnings || []))
    if (scan.entries.length) {
      const { flows, warnings } = await extractor.generate(project, folder, scan.entries.map((e) => e.qualname))
      report.warnings.push(...(warnings || []))
      const r = mergeGenerated(tab, flows)
      if (r.added.length || r.updated.length || r.conflicts.length) repo.writeTab(tab)
      report.folders[folder] = r
    }
    for (const f of tab.flows) {
      if (f.origin !== 'generated' && f.entry && !workspace.fileExists(project.root, entryFile(f.entry))) report.staleManual.push({ folder, flow: f.id, entry: f.entry })
    }
    report.changeMismatches.push(...changeMismatches(tab, code).map((m) => ({ folder, ...m })))
  }
  const total = (k) => Object.values(report.folders).reduce((n, r) => n + r[k].length, 0)
  report.summary = `${total('added')} added, ${total('updated')} updated, ${total('unchanged')} unchanged, ${total('conflicts')} conflicts, ${total('skippedManual')} hand-written kept, ${report.staleManual.length} hand-written with a missing entry file, ${report.changeMismatches.length} change types to check`
  return report
}
