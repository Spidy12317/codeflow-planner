import { describeRef } from '../../domain/plan/model.js'
import { awaitingClaude } from '../../domain/plan/threads.js'

// Everything the canvas needs on load.
export const loadPlan = ({ repo }) => ({ project: repo.readProject(), tabs: repo.listTabs() })

// No folder: overview of folders, flows and messages waiting for Claude.
// With folder: that tab without layout offsets (optionally one flow).
export function readPlan({ repo }, { folder, flow } = {}) {
  const project = repo.readProject()
  const tabs = repo.listTabs()
  if (!folder) {
    return {
      project: project.name,
      root: project.root,
      layers: project.layers,
      folders: project.folders.map((f) => ({
        folder: f,
        flows: (tabs[f]?.flows || []).map((fl) => ({ id: fl.id, title: fl.title, entry: fl.entry, steps: fl.spine?.length || 0 })),
      })),
      awaitingReply: repo.readThreads().filter(awaitingClaude).length,
    }
  }
  const tab = tabs[folder]
  if (!tab) throw new Error(`No plan for folder "${folder}". Folders: ${project.folders.join(', ')}`)
  const { positions, ...rest } = tab
  if (!flow) return rest
  const one = tab.flows.find((f) => f.id === flow)
  if (!one) throw new Error(`No flow "${flow}" in ${folder}. Flows: ${tab.flows.map((f) => f.id).join(', ')}`)
  return one
}

export const describe = ({ repo }, folder, ref) => describeRef(repo.readTab(folder), ref)

export function requireFolder(project, folder) {
  if (!project.folders.includes(folder)) throw new Error(`Unknown folder "${folder}". Folders: ${project.folders.join(', ')}`)
}
