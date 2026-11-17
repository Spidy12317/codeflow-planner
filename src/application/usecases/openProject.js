import { cleanArchProject, purposeOf } from '../../domain/project/cleanArchTemplate.js'
import { LAYERS } from '../../domain/project/layers.js'

// Bind a repo's .codeflow plan. Creates it when missing:
//   repo with Python code → one tab per source folder (layers left for the user to confirm)
//   repo without code     → Clean Architecture plan, folders created on scaffold
// Returns what the agent should do next.
export function openProject({ repo, workspace }, { root, name }) {
  if (repo.exists()) {
    const project = repo.readProject()
    return {
      state: 'existing',
      project: project.name,
      folders: project.folders,
      layers: project.layers || null,
      scaffold: project.scaffold,
      next: project.scaffold === 'pending'
        ? 'New Clean Architecture plan awaiting approval. Draft flows, then codeflow_project({ scaffold: true }) once the user approves.'
        : 'Run codeflow_sync to refresh flows from the code; fix what its check reports.',
    }
  }
  const folders = workspace.sourceFolders(root)
  if (folders.length) {
    repo.writeProject({ name, folders })
    return {
      state: 'created',
      project: name,
      folders,
      next: 'Plan created from the source folders. Run codeflow_sync now to draw the existing code as it is and summarise it. Then call codeflow_validate with no arguments and ask the user the questions it returns (validate with sub-agents or skip, which model, how thoroughly). Do not start the validation or pick a model until they answer. Do not propose a layer mapping or restructuring unless the user asks.',
    }
  }
  if (workspace.hasCode(root)) {
    repo.writeProject({ name, folders: [] })
    return {
      state: 'created',
      project: name,
      folders: [],
      next: 'This repo has code but no Python; flows cannot be generated. Set folders with codeflow_project and draw flows by hand.',
    }
  }
  const project = cleanArchProject(name)
  repo.writeProject(project)
  for (const folder of project.folders) {
    repo.writeTab({ folder, flows: [], purpose: purposeOf(folder) })
  }
  return {
    state: 'new',
    project: name,
    folders: project.folders,
    layers: project.layers,
    next: 'New project: Clean Architecture plan created (nothing on disk yet). Read codeflow_guide("new-project"). Ask the user what to build, draft flows (status proposed) in the right layer tabs, and run codeflow_project({ scaffold: true }) only after they approve.',
  }
}

// Change name, folders or layer mapping. Layers must use the four Clean Architecture names.
export function updateProject({ repo }, { name, folders, layers }) {
  const project = repo.readProject()
  if (layers) {
    const bad = Object.keys(layers).filter((l) => !LAYERS.includes(l))
    if (bad.length) throw new Error(`Unknown layer(s) ${bad.join(', ')}. Use: ${LAYERS.join(', ')}`)
    // A prefix may only sit in one layer (nested prefixes are fine: the longest one wins).
    const seen = new Map()
    for (const [layer, prefixes] of Object.entries(layers)) {
      for (const p of prefixes || []) {
        const key = p.replace(/\/+$/, '')
        if (seen.has(key) && seen.get(key) !== layer) throw new Error(`"${key}" is in both ${seen.get(key)} and ${layer}. Put each folder in one layer; map subfolders separately if it mixes layers.`)
        seen.set(key, layer)
      }
    }
  }
  const next = { ...project, ...(name && { name }), ...(folders && { folders }), ...(layers && { layers }) }
  repo.writeProject(next)
  const unmapped = next.layers ? next.folders.filter((f) => !Object.values(next.layers).flat().some((l) => f === l || f.startsWith(l + '/'))) : []
  return { ok: true, folders: next.folders, layers: next.layers, unmapped }
}
