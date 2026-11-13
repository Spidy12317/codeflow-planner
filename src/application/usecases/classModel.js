import { dependencyFindings } from '../../domain/classes/layerRules.js'
import { solidFindings } from '../../domain/classes/solidRules.js'
import { layerOf } from '../../domain/project/layers.js'

// Extract the class model from the code, check it, and save it as classes.json for the
// Classes view. Findings: DEP errors (dependency rule) and SOLID warnings.
export async function refreshClassModel({ repo, extractor }) {
  const project = repo.readProject()
  const model = await extractor.classes(project)
  for (const c of model.classes) c.layer = layerOf(project.layers, c.folder)
  const findings = [...dependencyFindings(model, project.layers), ...solidFindings(model, { layers: project.layers, thresholds: project.solid })]
  findings.forEach((f, i) => (f.id = `x${i}`))
  const doc = { generatedAt: new Date().toISOString(), layers: project.layers || null, classes: model.classes, modules: model.modules, findings, warnings: model.warnings || [] }
  repo.writeDoc('classes', doc)
  return doc
}

// Summary for the agent: counts, findings (optionally for one class), and that class's detail.
export async function classReport(ctx, { refresh = true, classId, limit = 40 } = {}) {
  const doc = refresh ? await refreshClassModel(ctx) : ctx.repo.readDoc('classes')
  if (!doc) throw new Error('No class model yet: call with refresh')
  const findings = classId ? doc.findings.filter((f) => f.classId === classId) : doc.findings
  const count = (pred) => doc.findings.filter(pred).length
  return {
    classes: doc.classes.length,
    interfaces: doc.classes.filter((c) => c.kind === 'interface' || c.kind === 'abstract').length,
    errors: count((f) => f.severity === 'error'),
    warnings: count((f) => f.severity === 'warning'),
    byRule: Object.fromEntries(['DEP', 'SRP', 'OCP', 'LSP', 'ISP', 'DIP'].map((r) => [r, count((f) => f.rule === r)])),
    note: doc.layers ? undefined : 'No layer mapping: dependency-rule checks skipped (SOLID checks still run). Map layers only if the user asks.',
    findings: findings.slice(0, limit).map(({ rule, severity, classId, file, line, message }) => ({ rule, severity, classId, at: `${file}:${line}`, message })),
    more: Math.max(0, findings.length - limit),
    ...(classId && { class: doc.classes.find((c) => c.id === classId) }),
    warningsFromExtractor: doc.warnings.slice(0, 10),
  }
}
