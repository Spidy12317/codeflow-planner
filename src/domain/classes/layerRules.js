import { breaksRule, layerOf } from '../project/layers.js'

// Clean Architecture dependency rule on the extracted class model: source code may only
// depend inward (domain ← application ← adapters ← infrastructure). Every outward import or
// class relation is an error.
//   model: { modules: [{ module, file, folder, imports: [{ module, folder, line, names }] }], classes: [...] }

export function dependencyFindings(model, layers) {
  if (!layers) return []
  const out = []
  const classById = new Map(model.classes.map((c) => [c.id, c]))
  const firstClassIn = new Map()
  for (const c of model.classes) if (!firstClassIn.has(c.module)) firstClassIn.set(c.module, c.id)

  for (const m of model.modules) {
    const from = layerOf(layers, m.folder)
    for (const imp of m.imports || []) {
      if (!imp.folder) continue
      const to = layerOf(layers, imp.folder)
      if (!breaksRule(from, to)) continue
      out.push({
        rule: 'DEP',
        severity: 'error',
        classId: firstClassIn.get(m.module) || null,
        module: m.module,
        file: m.file,
        line: imp.line,
        message: `${from} module imports ${to} (${imp.module}${imp.names?.length ? `: ${imp.names.join(', ')}` : ''})`,
        hint: `Inner layers must not know outer ones. Define a port in ${from === 'domain' ? 'domain' : 'application'} and implement it in ${to}.`,
      })
    }
  }

  for (const c of model.classes) {
    const from = layerOf(layers, c.folder)
    for (const r of c.relations || []) {
      const t = r.target && classById.get(r.target)
      if (!t) continue
      const to = layerOf(layers, t.folder)
      if (!breaksRule(from, to)) continue
      out.push({
        rule: 'DEP',
        severity: 'error',
        classId: c.id,
        module: c.module,
        file: c.file,
        line: c.line,
        message: `${c.name} (${from}) ${r.kind} ${t.name} (${to}) via ${r.via}`,
        hint: `Depend on an abstraction owned by the ${from} layer and inject the ${to} implementation from the composition root.`,
      })
    }
  }
  return out
}
