// Clean Architecture layers, innermost first. Source code dependencies may only point
// inward: a module may import from its own layer or any layer before it in this list.
export const LAYERS = ['domain', 'application', 'adapters', 'infrastructure']

export const LAYER_INFO = {
  domain: 'Entities and business rules. No framework, database or I/O imports.',
  application: 'Use cases and the ports (interfaces) they need. Depends only on domain.',
  adapters: 'Controllers, presenters, repository/gateway implementations of the ports.',
  infrastructure: 'Frameworks and drivers: web server, DB engine, config, composition root.',
}

// folder → layer, from project.layers ({ layer: [folders] }). A folder belongs to the layer
// of its longest matching prefix, so "app/domain" covers "app/domain/entities".
export function layerOf(layers, folder) {
  let best = null
  let len = -1
  for (const [layer, folders] of Object.entries(layers || {})) {
    for (const f of folders) {
      if ((folder === f || folder.startsWith(f + '/')) && f.length > len) {
        best = layer
        len = f.length
      }
    }
  }
  return best
}

export const rank = (layer) => LAYERS.indexOf(layer)

// Does a dependency from one layer to another break the dependency rule? The rule protects
// the core: domain and application must not depend outward. Adapters and infrastructure
// form the outer ring together (a repository may use the DB session it is built on).
export const breaksRule = (from, to) => !!from && !!to && rank(to) > rank(from) && rank(from) < rank('adapters')
