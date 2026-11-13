#!/usr/bin/env node
// Enforces this repo's Clean Architecture dependency rule on src/ imports.
//   domain          → domain only; no packages, no node: modules
//   application     → domain, application; no packages
//   adapters        → domain, application, adapters, packages
//   infrastructure  → domain, application, infrastructure, packages, node:
//   main            → anything (composition root)
import fs from 'node:fs'
import path from 'node:path'

const SRC = path.resolve('src')
const ALLOW = {
  domain: { layers: ['domain'], packages: false },
  application: { layers: ['domain', 'application'], packages: false },
  adapters: { layers: ['domain', 'application', 'adapters'], packages: true },
  infrastructure: { layers: ['domain', 'application', 'infrastructure'], packages: true },
  main: { layers: ['domain', 'application', 'adapters', 'infrastructure', 'main'], packages: true },
}

const layerOf = (file) => path.relative(SRC, file).split(path.sep)[0]
const files = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? files(path.join(dir, e.name)) : /\.(js|jsx)$/.test(e.name) ? [path.join(dir, e.name)] : []))

const problems = []
for (const file of files(SRC)) {
  const layer = layerOf(file)
  const rule = ALLOW[layer]
  if (!rule) {
    problems.push(`${path.relative('.', file)}: outside the known layers (${Object.keys(ALLOW).join(', ')})`)
    continue
  }
  const text = fs.readFileSync(file, 'utf8')
  for (const m of text.matchAll(/^\s*(?:import|export)\s[^'"]*?from\s+['"]([^'"]+)['"]|^\s*import\s+['"]([^'"]+)['"]/gm)) {
    const spec = m[1] || m[2]
    if (spec.startsWith('.')) {
      const target = layerOf(path.resolve(path.dirname(file), spec))
      if (!rule.layers.includes(target)) problems.push(`${path.relative('.', file)}: ${layer} must not import ${target} (${spec})`)
    } else if (!rule.packages) {
      problems.push(`${path.relative('.', file)}: ${layer} must not import packages (${spec})`)
    }
  }
}

if (problems.length) {
  console.error(problems.join('\n'))
  process.exit(1)
}
console.log('Layer check passed')
