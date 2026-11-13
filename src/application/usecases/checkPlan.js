import { changeMismatches } from '../../domain/plan/change.js'
import { wiringGaps } from '../../domain/plan/wiring.js'

// Fast completeness check before showing a plan to the user (no code extraction):
// change types that disagree with the code, and planned pieces that aren't wired together.
export function checkPlan({ repo, workspace }) {
  const project = repo.readProject()
  const tabs = repo.listTabs()
  const code = { exists: (rel) => workspace.fileExists(project.root, rel), read: (rel) => workspace.readFile(project.root, rel), list: (rel) => workspace.listFiles(project.root, rel) }
  const mismatches = Object.entries(tabs).flatMap(([folder, tab]) => changeMismatches(tab, code).map((m) => ({ folder, ...m })))
  const wiring = wiringGaps(tabs)
  const n = mismatches.length + wiring.orphans.length + wiring.unlinked.length + wiring.broken.length
  return {
    ok: n === 0,
    summary: n
      ? `${n} to fix: ${wiring.orphans.length} new flows nobody calls, ${wiring.unlinked.length} calls without a link, ${wiring.broken.length} broken links, ${mismatches.length} change types that disagree with the code`
      : 'Plan is wired: every new flow has a caller, calls link to their flows, change types match the code',
    orphans: wiring.orphans,
    unlinked: wiring.unlinked,
    broken: wiring.broken,
    changeMismatches: mismatches,
  }
}
