import { uid } from './model.js'

// Message threads between the user and Claude. Pure: functions take the thread list and
// return the changed thread; callers persist the list.
//   thread { id, folder, ref, view?, status: 'open'|'resolved', messages: [{ id, author, text, at }] }

// Append to an existing thread, or start one on (folder, ref). ref null = general message.
export function addMessage(threads, { threadId, folder = null, ref = null, view, author, text, at = new Date().toISOString() }) {
  let thread = threadId ? threads.find((t) => t.id === threadId) : null
  if (threadId && !thread) throw new Error(`No thread with id ${threadId}`)
  if (!thread) {
    thread = { id: uid('t'), folder, ref, status: 'open', messages: [] }
    if (view) thread.view = view
    threads.push(thread)
  }
  thread.messages.push({ id: uid('m'), author, text, at })
  if (author === 'user') thread.status = 'open'
  return thread
}

export function setThreadStatus(threads, threadId, status) {
  if (!['open', 'resolved'].includes(status)) throw new Error('status must be open or resolved')
  const thread = threads.find((t) => t.id === threadId)
  if (!thread) throw new Error(`No thread with id ${threadId}`)
  thread.status = status
  return thread
}

// A thread waits for Claude when it is open and the last word is yours.
export const awaitingClaude = (t) => t.status === 'open' && t.messages.at(-1)?.author === 'user'
