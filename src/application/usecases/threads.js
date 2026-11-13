import { describeRef } from '../../domain/plan/model.js'
import { addMessage, awaitingClaude, setThreadStatus } from '../../domain/plan/threads.js'

const PICK = { awaiting: awaitingClaude, open: (t) => t.status === 'open', all: () => true }

// Threads with the node each one is about. Default: waiting for Claude's reply.
export function listMessages({ repo }, include = 'awaiting') {
  const tabs = repo.listTabs()
  return repo
    .readThreads()
    .filter(PICK[include])
    .map((t) => ({
      threadId: t.id,
      folder: t.folder,
      view: t.view,
      ref: t.ref,
      about: t.view && t.view !== 'flows' ? `${t.view === 'classes' ? 'class' : 'task'} ${t.ref}` : describeRef(tabs[t.folder], t.ref) || 'general',
      status: t.status,
      messages: t.messages.map((m) => ({ from: m.author, text: m.text, at: m.at })),
    }))
}

// Post a message (reply with threadId, or start a thread on folder + ref). Returns { thread, write }.
export function postMessage({ repo }, msg) {
  if (!msg.text?.trim()) throw new Error('Message text is empty')
  if (msg.author === 'claude' && !msg.threadId && !msg.folder && !msg.view) throw new Error('Pass threadId to reply, or folder (+ ref) to start a thread')
  const threads = repo.readThreads()
  const thread = addMessage(threads, { ...msg, text: msg.text.trim() })
  if (msg.resolve) thread.status = 'resolved'
  return { thread, write: repo.writeThreads(threads) }
}

export function changeThreadStatus({ repo }, { threadId, status }) {
  const threads = repo.readThreads()
  const thread = setThreadStatus(threads, threadId, status)
  return { thread, write: repo.writeThreads(threads) }
}
