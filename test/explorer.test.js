import test from 'node:test'
import assert from 'node:assert/strict'
import { pathTree } from '../src/adapters/ui/pathTree.js'
import { explorerTree } from '../src/adapters/ui/views/flows/planStats.js'
import { cleanArchProject } from '../src/domain/project/cleanArchTemplate.js'

const FOLDERS = [
  'app/domain/entities',
  'app/domain/services',
  'app/application/use_cases',
  'app/application/ports',
  'app/adapters/api',
  'app/adapters/repositories',
  'app/adapters/gateways',
  'app/infrastructure',
]
const EXPECTED = `app
  adapters
    api
    gateways
    repositories
  application
    ports
    use_cases
  domain
    entities
    services
  infrastructure`

// Rows as the explorer labels them, indented by depth.
const rows = (nodes, depth = 0) => nodes.flatMap((n) => [`${'  '.repeat(depth)}${n.label}`, ...rows(n.kids, depth + 1)])

test('pathTree nests Clean Architecture folders under one "app" row', () => {
  assert.equal(rows(pathTree(FOLDERS, { sort: 'alpha' })).join('\n'), EXPECTED)
})

test('pathTree compacts a directory that only wraps one other directory', () => {
  assert.deepEqual(rows(pathTree(['src/app/api', 'src/app/db'])), ['src/app', '  api', '  db'])
  // A plan folder is never folded into its only child.
  assert.deepEqual(rows(pathTree(['src', 'src/app'])), ['src', '  app'])
})

test('explorer tree is not split by layer', () => {
  const project = {
    folders: FOLDERS,
    layers: {
      domain: ['app/domain/entities', 'app/domain/services'],
      application: ['app/application/use_cases', 'app/application/ports'],
      adapters: ['app/adapters/api', 'app/adapters/repositories', 'app/adapters/gateways'],
      infrastructure: ['app/infrastructure'],
    },
  }
  assert.equal(rows(explorerTree(project)).join('\n'), EXPECTED)
})

test('explorer tree of a new Clean Architecture plan has a single root', () => {
  const tree = explorerTree(cleanArchProject('x'))
  assert.equal(tree.length, 1)
})
