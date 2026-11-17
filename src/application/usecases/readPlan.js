import { describeRef } from '../../domain/plan/model.js'
import { flowOutline, tabOutline } from '../../domain/plan/outline.js'
import { awaitingClaude } from '../../domain/plan/threads.js'

// Everything the canvas needs on load.
export const loadPlan = ({ repo }) => ({ project: repo.readProject(), tabs: repo.listTabs() })

// Extractor bookkeeping the agent never needs.
const slim = ({ generated, ...flow }) => flow
const listed = (fl) => ({ id: fl.id, title: fl.title, entry: fl.entry, steps: fl.spine?.length || 0 })

// No folder: overview of folders (flow counts) and messages waiting for Claude.
// With folder: that tab without layout offsets (optionally one flow), as JSON, as a compact
// text outline, or as a list of its flows.
export function readPlan({ repo }, { folder, flow, format = 'json' } = {}) {
  const project = repo.readProject()
  const tabs = repo.listTabs()
  if (!folder) {
    return {
      project: project.name,
      root: project.root,
      layers: project.layers,
      folders: project.folders.map((f) => ({ folder: f, flows: tabs[f]?.flows?.length || 0 })),
      awaitingReply: repo.readThreads().filter(awaitingClaude).length,
    }
  }
  const tab = tabs[folder]
  if (!tab) throw new Error(`No plan for folder "${folder}". Folders: ${project.folders.join(', ')}`)
  if (format === 'list') return { folder, flows: tab.flows.map(listed) }
  const { positions, ...rest } = tab
  if (!flow) return format === 'outline' ? tabOutline(tab) : { ...rest, flows: tab.flows.map(slim) }
  const one = tab.flows.find((f) => f.id === flow)
  if (!one) throw new Error(`No flow "${flow}" in ${folder}. Flows: ${tab.flows.map((f) => f.id).join(', ')}`)
  return format === 'outline' ? flowOutline(one) : slim(one)
}

export const describe = ({ repo }, folder, ref) => describeRef(repo.readTab(folder), ref)

export function requireFolder(project, folder) {
  if (!project.folders.includes(folder)) throw new Error(`Unknown folder "${folder}". Folders: ${project.folders.join(', ')}`)
}
