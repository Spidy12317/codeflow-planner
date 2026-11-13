import { putFlow } from '../../domain/plan/edits.js'
import { requireFolder } from './readPlan.js'

// Create or replace a whole flow in a folder tab.
export function writeFlow({ repo }, { folder, flow }) {
  requireFolder(repo.readProject(), folder)
  const tab = repo.readTab(folder) || { folder, flows: [] }
  flow.origin ??= 'manual'
  const { replaced } = putFlow(tab, flow)
  repo.writeTab(tab)
  return { ok: true, folder, flow: flow.id, replaced }
}

// Replace a whole tab (the canvas saves this way).
export function saveTab({ repo }, tab) {
  if (!tab?.folder || !Array.isArray(tab.flows)) throw new Error('Body must be a tab: { folder, flows: [] }')
  return repo.writeTab(tab)
}
