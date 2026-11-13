// Create the planned folders on disk once the user approves the plan.
export function scaffoldProject({ repo, workspace }) {
  const project = repo.readProject()
  if (project.scaffold === 'done') return { ok: true, created: [], note: 'Already scaffolded' }
  const created = workspace.createPackages(project.root, project.folders)
  repo.writeProject({ ...project, scaffold: 'done' })
  return { ok: true, created }
}
