import test from 'node:test'
import assert from 'node:assert/strict'
import { changeCounts, flowChange, flowChangeCounts, pendingChanges, rollupChange, withoutDone } from '../src/domain/plan/change.js'

const step = (id, status, extra = {}) => ({ id, kind: 'step', name: id, ...(status && { status }), ...extra })
const line = (id, extra = {}) => ({ id, k: 'act', t: id, ...extra })
const lines = (...items) => ({ details: [{ side: 'right', title: 'Checks', items }] })
// A flow drafted as new code: the change on the flow, status on its steps.
const newFlow = (id, ...statuses) => ({ id, title: id, change: 'new', spine: statuses.map((s, i) => step(`${id}-s${i}`, s)) })

test('a new flow whose steps are all done shows no letter', () => {
  const fl = newFlow('f', 'done', 'done', 'done')
  assert.equal(flowChange(fl), null)
  assert.deepEqual(pendingChanges(fl).counts, {})
  assert.deepEqual(changeCounts(fl), { new: 1 }) // the plan still records what was planned
})

test('done steps inside a try / loop frame count for the flow', () => {
  const fl = { id: 'f', change: 'new', spine: [step('a', 'done'), { id: 'w', kind: 'try', body: [step('b', 'done')] }] }
  assert.equal(flowChange(fl), null)
  fl.spine[1].body.push(step('c', 'approved'))
  assert.equal(flowChange(fl), 'new')
})

test('a partly done flow keeps its letter', () => {
  assert.equal(flowChange(newFlow('f', 'done', 'approved')), 'new')
  assert.equal(flowChange(newFlow('f', 'done', 'proposed')), 'new')
})

test('failed and in_progress are not done', () => {
  assert.equal(flowChange(newFlow('f', 'done', 'failed')), 'new')
  assert.equal(flowChange(newFlow('f', 'done', 'in_progress')), 'new')
})

test('a flow with no status anywhere keeps its letter', () => {
  assert.equal(flowChange(newFlow('f', undefined, undefined)), 'new')
})

test('nested step and line changes count until they are done', () => {
  // An edit flow: an edited step with a new line, and a new helper step.
  const fl = {
    id: 'f',
    spine: [
      step('edit', 'done', { change: 'edit', ...lines(line('case', { change: 'new' })) }),
      step('helper', 'approved', { change: 'new' }),
    ],
  }
  // The done step's line has no status of its own, so it follows the step: done.
  assert.deepEqual(pendingChanges(fl).counts, { new: 1 })
  assert.equal(flowChange(fl), 'new')

  // A line with its own status that is not done still counts inside a done step (the step's
  // own status decides for the step itself).
  fl.spine[0].details[0].items[0].status = 'in_progress'
  assert.deepEqual(pendingChanges(fl).counts, { new: 2 })

  // A done line inside a step still being worked on: the step's edit stays, the line's new goes.
  fl.spine[0].status = 'in_progress'
  fl.spine[0].details[0].items[0].status = 'done'
  fl.spine[1].status = 'done'
  assert.deepEqual(pendingChanges(fl).counts, { edit: 1 })

  // Everything done → nothing left.
  fl.spine[0].status = 'done'
  assert.equal(flowChange(fl), null)
})

test('a planned step without a status is not done, even when the rest of the flow is', () => {
  const fl = { id: 'f', change: 'new', spine: [step('a', 'done'), step('b', undefined, { change: 'edit' })] }
  assert.equal(pendingChanges(fl).own, null) // the flow itself: every tracked step is done
  assert.equal(flowChange(fl), 'edit') // but the edit on b was never marked done
})

test('letters roll up to files and folders without done flows', () => {
  const done = newFlow('done', 'done', 'done')
  const partly = newFlow('partly', 'done', 'approved')
  const edited = { id: 'edited', change: 'edit', spine: [step('x', 'proposed')] }
  // A file with only finished new flows has no letter.
  assert.equal(rollupChange(flowChangeCounts([done])), null)
  // A file with a finished and an unfinished new flow is still A.
  assert.deepEqual(flowChangeCounts([done, partly]), { new: 1 })
  assert.equal(rollupChange(flowChangeCounts([done, partly])), 'new')
  // A folder mixing a pending new flow and a pending edit rolls up to M.
  assert.equal(rollupChange(flowChangeCounts([done, partly, edited])), 'edit')
  // Once all are done, the folder has no letter.
  partly.spine[1].status = 'done'
  edited.spine[0].status = 'done'
  assert.equal(rollupChange(flowChangeCounts([done, partly, edited])), null)
})

test('finished work is drawn as plain code', () => {
  const fl = {
    id: 'f',
    change: 'new',
    spine: [
      step('a', 'done', { change: 'edit', ...lines(line('x', { change: 'new' })) }),
      step('b', 'in_progress', { change: 'new' }),
    ],
  }
  let drawn = withoutDone(fl)
  assert.equal(drawn.change, 'new') // the flow is not finished: its frame stays
  assert.equal(drawn.spine[0].status, undefined) // a done step: no ring, no pill
  assert.equal(drawn.spine[0].change, undefined)
  assert.equal(drawn.spine[0].details[0].items[0].change, undefined) // its line follows it
  assert.equal(drawn.spine[1].status, 'in_progress') // unfinished work is unchanged
  assert.equal(drawn.spine[1].change, 'new')

  fl.spine[1].status = 'failed'
  assert.equal(withoutDone(fl).spine[1].status, 'failed')

  fl.spine[1].status = 'done'
  drawn = withoutDone(fl)
  assert.equal(drawn.change, undefined) // the whole flow is done: no NEW frame
  assert.equal(drawn.spine[1].status, undefined)
  assert.equal(fl.spine[0].status, 'done') // the plan itself is untouched
  assert.equal(fl.change, 'new')
})
