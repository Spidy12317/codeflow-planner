import { layerOf, rank } from '../project/layers.js'

// SOLID heuristics over the extracted class model. These are review prompts, not proofs:
// each finding says what was measured so the user can judge it.
// Thresholds can be overridden per project (project.json → solid).

export const DEFAULT_THRESHOLDS = {
  maxPublicMethods: 10, // SRP
  maxCollaborators: 7, // SRP: distinct classes a class composes, aggregates or depends on
  minMethodsForCohesion: 6, // SRP: only judge cohesion for classes this big
  maxIsinstanceTypes: 3, // OCP: type checks in one method
  maxInterfaceMethods: 6, // ISP
  maxStubRatio: 0.5, // ISP: share of an interface an implementer leaves as stubs
}

const isDunder = (n) => n.startsWith('__') && n.endsWith('__')
const CONCRETE = new Set(['class'])
const ABSTRACT = new Set(['interface', 'abstract'])

// Groups of instance methods that share no attributes with each other (LCOM4 components).
export function cohesionGroups(cls) {
  const methods = cls.methods.filter((m) => !isDunder(m.name) && !m.static && !m.classmethod && !m.property && !m.abstract)
  const parent = methods.map((_, i) => i)
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  const owner = new Map()
  methods.forEach((m, i) => {
    for (const a of m.uses || []) {
      if (owner.has(a)) parent[find(i)] = find(owner.get(a))
      else owner.set(a, i)
    }
    // calling another method of the same class also ties them together
    for (const a of m.uses || []) {
      const j = methods.findIndex((x) => x.name === a)
      if (j > -1) parent[find(i)] = find(j)
    }
  })
  const groups = new Map()
  methods.forEach((m, i) => {
    const r = find(i)
    if (!groups.has(r)) groups.set(r, [])
    groups.get(r).push(m.name)
  })
  return [...groups.values()]
}

export function solidFindings(model, { layers, thresholds = {} } = {}) {
  const T = { ...DEFAULT_THRESHOLDS, ...thresholds }
  const byId = new Map(model.classes.map((c) => [c.id, c]))
  const out = []
  const add = (c, rule, message, hint, line = c.line) =>
    out.push({ rule, severity: 'warning', classId: c.id, module: c.module, file: c.file, line, message, hint })

  for (const c of model.classes) {
    if (c.kind === 'enum' || c.kind === 'model' || c.kind === 'dataclass') continue
    const publicMethods = c.methods.filter((m) => m.visibility === 'public' && !isDunder(m.name) && !m.property)

    // SRP
    if (publicMethods.length > T.maxPublicMethods) {
      add(c, 'SRP', `${c.name} has ${publicMethods.length} public methods (limit ${T.maxPublicMethods})`, 'Split it by responsibility: group methods by the data they use and the reason they would change.')
    }
    const collaborators = new Set((c.relations || []).filter((r) => ['composes', 'aggregates', 'depends'].includes(r.kind)).map((r) => r.target || r.targetName))
    if (collaborators.size > T.maxCollaborators) {
      add(c, 'SRP', `${c.name} works with ${collaborators.size} other classes (limit ${T.maxCollaborators})`, 'Many collaborators usually means several jobs. Extract a class per job, or a facade.')
    }
    if (c.kind !== 'interface' && c.methods.length >= T.minMethodsForCohesion) {
      const groups = cohesionGroups(c).filter((g) => g.length > 1)
      if (groups.length > 1) {
        add(c, 'SRP', `${c.name} has ${groups.length} unrelated method groups: ${groups.map((g) => `[${g.join(', ')}]`).join(' ')}`, 'Methods that share no state are separate responsibilities. Each group is a candidate class.')
      }
    }

    // OCP: type switches anywhere in the class, counted over distinct types
    const checks = c.isinstanceChecks || []
    const types = [...new Set(checks.flatMap((k) => k.types))]
    if (types.length >= T.maxIsinstanceTypes) {
      add(c, 'OCP', `${c.name} switches on ${types.length} types (${types.join(', ')})`, 'Adding a type means editing this code. Move the varying behaviour into a method on those types (polymorphism) or a strategy.', checks[0].line)
    }

    // LSP: overrides that refuse or narrow the parent's contract
    for (const r of c.relations || []) {
      const parent = (r.kind === 'inherits' || r.kind === 'realizes') && r.target && byId.get(r.target)
      if (!parent) continue
      for (const m of c.methods) {
        const pm = parent.methods.find((x) => x.name === m.name)
        if (!pm || isDunder(m.name)) continue
        if (m.raisesNotImplemented && !pm.abstract && !pm.stub) {
          add(c, 'LSP', `${c.name}.${m.name} raises NotImplementedError but ${parent.name}.${m.name} works`, `Code written against ${parent.name} breaks when given a ${c.name}. Don't inherit just to reuse code; use composition or a smaller base.`, m.line)
        } else if (m.params.length < pm.params.length) {
          add(c, 'LSP', `${c.name}.${m.name} takes fewer parameters than ${parent.name}.${m.name}`, 'An override must accept everything the base accepts.', m.line)
        }
      }
    }

    // ISP
    if (c.kind === 'interface') {
      const abstract = c.methods.filter((m) => m.abstract || m.stub)
      if (abstract.length > T.maxInterfaceMethods) {
        add(c, 'ISP', `${c.name} declares ${abstract.length} methods (limit ${T.maxInterfaceMethods})`, 'Split it into role interfaces so clients depend only on what they use.')
      }
    }
    for (const r of c.relations || []) {
      const iface = r.kind === 'realizes' && r.target && byId.get(r.target)
      if (!iface) continue
      const required = iface.methods.filter((m) => m.abstract || m.stub).map((m) => m.name)
      if (required.length < 2) continue
      const stubbed = c.methods.filter((m) => required.includes(m.name) && (m.stub || m.raisesNotImplemented))
      if (stubbed.length / required.length >= T.maxStubRatio) {
        add(c, 'ISP', `${c.name} stubs ${stubbed.length} of ${required.length} methods of ${iface.name} (${stubbed.map((m) => m.name).join(', ')})`, `${iface.name} is too wide for ${c.name}. Split the interface by client need.`)
      }
    }

    // DIP: depending on a concrete class where an abstraction exists, or across layers
    const from = layerOf(layers, c.folder)
    for (const r of c.relations || []) {
      if (!['composes', 'aggregates'].includes(r.kind) && !(r.kind === 'depends' && /instantiat|call/.test(r.via || ''))) continue
      const t = r.target && byId.get(r.target)
      if (!t || !CONCRETE.has(t.kind)) continue
      const abstraction = (t.relations || []).map((x) => x.target && byId.get(x.target)).find((p) => p && ABSTRACT.has(p.kind))
      const to = layerOf(layers, t.folder)
      if (abstraction) {
        add(c, 'DIP', `${c.name} depends on concrete ${t.name} (${r.kind} via ${r.via}) instead of ${abstraction.name}`, `Type the dependency as ${abstraction.name} and inject ${t.name} from the composition root.`)
      } else if (from && to && from !== to && rank(from) <= rank('application') && r.kind === 'composes') {
        add(c, 'DIP', `${c.name} (${from}) constructs ${t.name} (${to}) itself`, `Receive it through the constructor, typed as an interface owned by ${from}.`)
      }
    }
  }

  return out
}
