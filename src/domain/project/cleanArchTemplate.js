// Default plan for a new project: a Python package laid out in Clean Architecture layers.
// Folders are only created on disk when the plan is approved (scaffold).

export function cleanArchProject(name, pkg = 'app') {
  const layers = {
    domain: [`${pkg}/domain/entities`, `${pkg}/domain/services`],
    application: [`${pkg}/application/use_cases`, `${pkg}/application/ports`],
    adapters: [`${pkg}/adapters/api`, `${pkg}/adapters/repositories`, `${pkg}/adapters/gateways`],
    infrastructure: [`${pkg}/infrastructure`],
  }
  return {
    name,
    folders: Object.values(layers).flat(),
    layers,
    scaffold: 'pending',
  }
}

// What each template folder is for; shown as a note on its empty tab.
export const FOLDER_PURPOSE = {
  'domain/entities': 'Entities: business objects and invariants. Plain classes, no I/O.',
  'domain/services': 'Domain services: business rules that span several entities.',
  'application/use_cases': 'One class per use case (interactor). Talks to the outside only through ports.',
  'application/ports': 'Abstract interfaces (ABC/Protocol) the use cases need: repositories, gateways, presenters.',
  'adapters/api': 'Controllers / route handlers: turn requests into use-case calls. Flows for HTTP endpoints live here.',
  'adapters/repositories': 'Implementations of repository ports (SQL, document store, in-memory).',
  'adapters/gateways': 'Implementations of gateway ports for external services (LLMs, payment, email).',
  infrastructure: 'Framework setup, DB engine, config and the composition root (main.py) that wires adapters into use cases.',
}

export const purposeOf = (folder) => Object.entries(FOLDER_PURPOSE).find(([k]) => folder.endsWith(k))?.[1]
