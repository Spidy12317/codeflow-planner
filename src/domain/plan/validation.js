import { isTrivial } from './outline.js'

// Splitting a flow validation across sub-agents. Pure: works on { folder: tab }.

export const FLOWS_PER_AGENT = 30
export const MAX_AGENTS = 6

// Per folder: the flows worth checking and the trivial ones left out.
export function validationScope(tabs, folders, { includeTrivial = false } = {}) {
  return folders
    .map((folder) => {
      const flows = tabs[folder]?.flows || []
      const check = includeTrivial ? flows : flows.filter((f) => !isTrivial(f))
      return { folder, flows: check.map((f) => f.id), trivial: flows.length - check.length }
    })
    .filter((s) => s.flows.length)
}

// One agent per ~FLOWS_PER_AGENT flows, at most MAX_AGENTS. Folders stay whole (one owner per
// folder) and in path order, so a folder and its subfolders land in the same or adjacent groups.
export function validationGroups(scope, { flowsPerAgent = FLOWS_PER_AGENT, maxAgents = MAX_AGENTS } = {}) {
  const sorted = [...scope].sort((a, b) => a.folder.localeCompare(b.folder))
  const total = sorted.reduce((n, s) => n + s.flows.length, 0)
  if (!total) return []
  const count = Math.min(maxAgents, sorted.length, Math.max(1, Math.ceil(total / flowsPerAgent)))
  const groups = []
  let left = total
  let cur = []
  let size = 0
  sorted.forEach((s, i) => {
    cur.push(s)
    size += s.flows.length
    const groupsLeft = count - groups.length
    const foldersLeft = sorted.length - i - 1
    // Close the group once it reaches its share, or when every remaining folder is needed.
    if (groupsLeft > 1 && (size >= left / groupsLeft || foldersLeft === groupsLeft - 1)) {
      groups.push(cur)
      left -= size
      cur = []
      size = 0
    }
  })
  if (cur.length) groups.push(cur)
  return groups.map((folders) => ({ folders, flows: folders.reduce((n, s) => n + s.flows.length, 0) }))
}
