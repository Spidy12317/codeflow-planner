import test from 'node:test'
import { changeCounts, changeMismatches, onlyDifferingChanges, rollupChange } from '../src/domain/plan/change.js'
import assert from 'node:assert/strict'
import { applyEdits } from '../src/domain/plan/edits.js'
import { flowHash, mergeGenerated } from '../src/domain/plan/sync.js'
import { addMessage, awaitingClaude } from '../src/domain/plan/threads.js'
import { wiringGaps } from '../src/domain/plan/wiring.js'
import { updateProject } from '../src/application/usecases/openProject.js'
import { breaksRule, layerOf } from '../src/domain/project/layers.js'
import { cleanArchProject } from '../src/domain/project/cleanArchTemplate.js'

const gen = (title = 'run') => ({
  id: 'f1',
  title: 'F',
  entry: 'a.py:10',
  spine: [
    { id: 'f1-s1', kind: 'step', module: 'svc', name: 'load' },
    { id: 'f1-s2', kind: 'step', module: 'svc', name: title },
  ],
})

const seeded = () => {
  const tab = { folder: 'x', flows: [] }
  mergeGenerated(tab, [gen()])
  return tab
}

test('sync adds new flows as generated with a hash', () => {
  const tab = seeded()
  assert.equal(tab.flows[0].origin, 'generated')
  assert.equal(tab.flows[0].genHash, flowHash(gen()))
})

test('sync leaves unchanged code alone, including hand status', () => {
  const tab = seeded()
  tab.flows[0].spine[0].status = 'done'
  const r = mergeGenerated(tab, [gen()])
  assert.deepEqual(r.unchanged, ['f1'])
  assert.equal(tab.flows[0].spine[0].status, 'done')
})

test('sync updates untouched flows when code changed, carrying status and notes', () => {
  const tab = seeded()
  tab.flows[0].spine[0].status = 'approved'
  tab.flows[0].notes = [{ id: 'm1', anchor: 'f1-s2', tone: 'idea', text: 'keep me' }]
  const r = mergeGenerated(tab, [gen('run fast')])
  assert.deepEqual(r.updated, ['f1'])
  assert.equal(tab.flows[0].spine[1].name, 'run fast')
  assert.equal(tab.flows[0].spine[0].status, 'approved')
  assert.equal(tab.flows[0].notes[0].text, 'keep me')
})

test('sync never overwrites a flow edited by hand; it adds a check note', () => {
  const tab = seeded()
  tab.flows[0].spine[1].desc = 'hand-written detail'
  const r = mergeGenerated(tab, [gen('run fast')])
  assert.deepEqual(r.conflicts, ['f1'])
  assert.equal(tab.flows[0].spine[1].desc, 'hand-written detail')
  assert.equal(tab.flows[0].notes.at(-1).tone, 'check')
  mergeGenerated(tab, [gen('run fast')])
  assert.equal(tab.flows[0].notes.length, 1, 'conflict note is not duplicated')
})

test('sync matches hand-drawn flows by entry point and keeps them', () => {
  const tab = { folder: 'x', flows: [{ id: 'my-flow', title: 'mine', entry: 'a.py:12', spine: [] }] }
  const r = mergeGenerated(tab, [gen()])
  assert.deepEqual(r.skippedManual, ['my-flow'])
  assert.equal(tab.flows.length, 1)
})

test('edits are all-or-nothing', () => {
  const tab = { folder: 'x', flows: [gen()] }
  assert.throws(() => applyEdits(tab, [{ ref: 'f1-s1', op: 'set', fields: { status: 'done' } }, { ref: 'nope', op: 'remove' }]), /Edit 1/)
  assert.equal(tab.flows[0].spine[0].status, undefined)
  const { tab: next } = applyEdits(tab, [{ ref: 'f1-s1', op: 'insert_after', item: { kind: 'step', name: 'new' } }])
  assert.equal(next.flows[0].spine[1].name, 'new')
  assert.ok(next.flows[0].spine[1].id)
})

test('threads wait for Claude until Claude answers', () => {
  const threads = []
  const t = addMessage(threads, { folder: 'x', ref: 'f1', author: 'user', text: 'why?' })
  assert.ok(awaitingClaude(t))
  addMessage(threads, { threadId: t.id, author: 'claude', text: 'because' })
  assert.ok(!awaitingClaude(t))
})

test('layers: longest prefix wins and only inward dependencies are allowed', () => {
  const { layers } = cleanArchProject('demo')
  assert.equal(layerOf(layers, 'app/domain/entities'), 'domain')
  assert.equal(layerOf(layers, 'app/adapters/api/v1'), 'adapters')
  assert.equal(layerOf(layers, 'scripts'), null)
  assert.ok(breaksRule('domain', 'infrastructure'))
  assert.ok(!breaksRule('adapters', 'application'))
})

test('adapters may use infrastructure; the core may not', () => {
  assert.ok(!breaksRule('adapters', 'infrastructure'))
  assert.ok(breaksRule('application', 'adapters'))
})

test('change types roll up and are checked against the code', () => {
  const flow = {
    id: 'f', title: 'init', change: 'edit',
    spine: [
      { id: 's1', kind: 'step', module: 'app.svc.Service', name: '__init__()', change: 'edit', details: [{ side: 'right', title: 'm', items: [{ id: 'l1', k: 'act', t: 'case X', change: 'new' }] }] },
      { id: 's2', kind: 'step', module: 'app.svc.Service', name: 'brand_new()', change: 'edit' },
      { id: 's3', kind: 'step', module: 'app.svc', name: 'helper', change: 'new' },
      { id: 's4', kind: 'step', module: 'app.gone', name: 'old()', change: 'remove' },
      { id: 's5', kind: 'step', module: 'callers', name: 'select provider', change: 'edit' },
    ],
  }
  assert.deepEqual(changeCounts(flow), { edit: 4, new: 2, remove: 1 })
  assert.equal(rollupChange({ new: 2 }), 'new')
  assert.equal(rollupChange({ new: 1, remove: 1 }), 'edit')
  assert.equal(rollupChange({}), null)
  const files = { 'app/svc.py': 'class Service:\n    def __init__(self):\n        pass\n\ndef helper():\n    pass\n' }
  const fs = { exists: (rel) => rel === 'app' || rel in files, read: (rel) => files[rel] ?? null }
  const bad = changeMismatches({ flows: [flow] }, fs).map((m) => m.ref)
  assert.deepEqual(bad, ['s2', 's3', 's4'])
})

test('a change is drawn only where it differs from its container', () => {
  const flow = {
    id: 'f', change: 'new',
    spine: [
      { id: 's1', kind: 'step', change: 'new', details: [{ items: [{ id: 'a', k: 'act', change: 'new' }] }] },
      { id: 's2', kind: 'step', change: 'edit', details: [{ items: [{ id: 'b', k: 'act', change: 'new' }, { id: 'c', k: 'act', change: 'edit' }] }] },
    ],
  }
  const shown = onlyDifferingChanges(flow)
  assert.equal(shown.spine[0].change, undefined)
  assert.equal(shown.spine[0].details[0].items[0].change, undefined)
  assert.equal(shown.spine[1].change, 'edit')
  assert.equal(shown.spine[1].details[0].items[0].change, 'new')
  assert.equal(shown.spine[1].details[0].items[1].change, undefined)
  assert.equal(shown.spine[0].inheritedChange, 'new')
  assert.equal(flow.spine[0].change, 'new') // the plan itself is untouched
})

test('wiring: a new client the service never links to is reported', () => {
  const client = { id: 'cc', title: 'ClaudeClient.complete (Claude connector)', change: 'new', spine: [{ id: 'c1', kind: 'step', name: 'complete()' }] }
  const caseLine = { id: 'l1', k: 'call', t: 'case CLAUDE → ClaudeClient(temperature=temperature)', change: 'new' }
  const service = { id: 'si', title: 'LLMService.__init__', change: 'edit', spine: [{ id: 's1', kind: 'step', name: 'match provider', details: [{ items: [caseLine] }] }] }
  const tabs = () => ({ llm: { folder: 'llm', flows: [client, service] } })

  let gaps = wiringGaps(tabs())
  assert.equal(gaps.unlinked.length, 1)
  assert.equal(gaps.unlinked[0].ref, 'l1')

  caseLine.link = { tab: 'llm', flow: 'cc' }
  gaps = wiringGaps(tabs())
  assert.deepEqual([gaps.orphans.length, gaps.unlinked.length, gaps.broken.length], [0, 0, 0])

  service.spine[0].details[0].items = []
  assert.equal(wiringGaps(tabs()).orphans[0].flow, 'cc')

  service.spine[0].details[0].items = [{ ...caseLine, link: { tab: 'llm', flow: 'missing' } }]
  assert.equal(wiringGaps(tabs()).broken.length, 1)
})

test('a folder can only be mapped to one layer', () => {
  let project = { name: 'p', folders: ['services', 'services/llm/utils'] }
  const repo = { readProject: () => project, writeProject: (p) => (project = p) }
  assert.throws(() => updateProject({ repo }, { layers: { application: ['services'], adapters: ['services/'] } }), /both application and adapters/)
  const r = updateProject({ repo }, { layers: { application: ['services'], adapters: ['services/llm/utils'] } })
  assert.deepEqual(r.unmapped, [])
})
