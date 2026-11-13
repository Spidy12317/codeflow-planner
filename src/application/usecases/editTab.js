import { applyEdits } from '../../domain/plan/edits.js'

// Targeted all-or-nothing edits to one folder tab.
export function editTab({ repo }, { folder, edits }) {
  const tab = repo.readTab(folder)
  if (!tab) throw new Error(`No plan for folder "${folder}"`)
  const { tab: next, newIds } = applyEdits(tab, edits)
  repo.writeTab(next)
  return { ok: true, applied: edits.length, newIds }
}
