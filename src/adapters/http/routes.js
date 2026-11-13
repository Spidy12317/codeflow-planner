import { loadPlan } from '../../application/usecases/readPlan.js'
import { saveTab } from '../../application/usecases/writeFlow.js'
import { previewFlows, scanFolder } from '../../application/usecases/generateFlows.js'
import { changeThreadStatus, postMessage } from '../../application/usecases/threads.js'
import { refreshClassModel } from '../../application/usecases/classModel.js'

// HTTP API over the plan for the canvas. Plan files are the source of truth; changes made
// outside the canvas (Claude via MCP, hand edits) are pushed to open pages over SSE.
//
//   GET  /api/plan                    { project, tabs }
//   PUT  /api/tab                     body: tab
//   GET  /api/threads                 [thread]
//   POST /api/messages                body: { threadId?, folder?, ref?, view?, text }
//   POST /api/threads/status          body: { threadId, status: 'open' | 'resolved' }
//   GET  /api/scan?folder=F           { entries, warnings }   entry points found in the code
//   POST /api/generate                body: { folder, entries: [qualname] } → { flows, warnings }
//   POST /api/classes/refresh         re-extract the class model → classes doc
//   GET  /api/doc/<name>              another plan document (classes, execution, diagram)
//   PUT  /api/doc/<name>              body: document
//   GET  /api/events                  SSE: event <kind> (tab | threads | project | <doc>), data = file JSON
//
// extra: { [route]: (ctx, body, query) => result } for routes added by later features.

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {})
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const DOCS = new Set(['classes', 'execution', 'diagram'])

export function createApi(ctx, { extra = {} } = {}) {
  const { repo } = ctx
  // Content we wrote ourselves, per file, so the watcher doesn't echo the canvas's own saves.
  const written = new Map()
  const remember = (w) => {
    written.set(w.file, w.text)
    return w
  }

  const clients = new Set()
  const broadcast = (event, text) => {
    const data = text.replace(/\n/g, '')
    for (const res of clients) res.write(`event: ${event}\ndata: ${data}\n\n`)
  }
  const unwatch = repo.watch((kind, file, text) => {
    if (written.get(file) === text) return
    written.set(file, text)
    try {
      JSON.parse(text)
    } catch {
      return // partially written; the next write triggers again
    }
    broadcast(kind, text)
  })
  const ping = setInterval(() => clients.forEach((res) => res.write(': ping\n\n')), 25000)

  // Handles a request whose path has the /api prefix removed. Returns false if not an API route.
  async function handle(req, res, url) {
    const [pathname, search = ''] = url.split('?')
    const query = new URLSearchParams(search)
    const route = `${req.method} ${pathname}`
    try {
      if (route === 'GET /events') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
        res.write(`event: hello\ndata: ${JSON.stringify({ planDir: repo.planDir })}\n\n`)
        clients.add(res)
        req.on('close', () => clients.delete(res))
        return true
      }
      if (route === 'GET /plan') return send(res, 200, loadPlan(ctx))
      if (route === 'GET /threads') return send(res, 200, repo.readThreads())
      if (route === 'PUT /tab') {
        remember(saveTab(ctx, await readBody(req)))
        return send(res, 200, { ok: true })
      }
      if (route === 'POST /messages') {
        const { thread, write } = postMessage(ctx, { ...(await readBody(req)), author: 'user', resolve: false })
        remember(write)
        return send(res, 200, thread)
      }
      if (route === 'POST /threads/status') {
        const { thread, write } = changeThreadStatus(ctx, await readBody(req))
        remember(write)
        return send(res, 200, thread)
      }
      if (route === 'GET /scan') return send(res, 200, await scanFolder(ctx, query.get('folder')))
      if (route === 'POST /generate') return send(res, 200, await previewFlows(ctx, await readBody(req)))
      if (route === 'POST /classes/refresh') {
        const doc = await refreshClassModel(ctx)
        written.set(`${repo.planDir}/classes.json`, JSON.stringify(doc, null, 2) + '\n')
        return send(res, 200, doc)
      }

      const doc = pathname.match(/^\/doc\/([a-z]+)$/)?.[1]
      if (doc && DOCS.has(doc)) {
        if (req.method === 'GET') return send(res, 200, repo.readDoc(doc))
        if (req.method === 'PUT') {
          remember(repo.writeDoc(doc, await readBody(req)))
          return send(res, 200, { ok: true })
        }
      }
      if (extra[route]) {
        const body = req.method === 'GET' ? {} : await readBody(req)
        return send(res, 200, await extra[route](ctx, body, query))
      }
      return false
    } catch (e) {
      send(res, 400, { error: String(e.message || e) })
      return true
    }
  }

  function close() {
    unwatch()
    clearInterval(ping)
    for (const res of clients) {
      res.write('event: bye\ndata: {}\n\n')
      res.end()
    }
    clients.clear()
  }

  return { handle, broadcast, close }
}
