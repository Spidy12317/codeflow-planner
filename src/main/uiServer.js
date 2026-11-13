import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { createApi } from '../adapters/http/routes.js'

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
}

// Serves the built canvas (staticDir) and the plan API on 127.0.0.1. port 0 picks a free
// port, so every session gets its own UI. Resolves to { url, port, close }.
export function startUiServer(ctx, { staticDir, port = 0, extra } = {}) {
  const api = createApi(ctx, { extra })
  const root = path.resolve(staticDir)

  const server = http.createServer(async (req, res) => {
    if (req.url.startsWith('/api/')) {
      if ((await api.handle(req, res, req.url.slice(4))) === false) {
        res.statusCode = 404
        res.end(JSON.stringify({ error: `No route for ${req.method} ${req.url}` }))
      }
      return
    }
    // Static files; anything unknown falls back to the app shell.
    const rel = decodeURIComponent(req.url.split('?')[0])
    let file = path.join(root, rel)
    if (!file.startsWith(root + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(root, 'index.html')
    if (!fs.existsSync(file)) {
      res.statusCode = 500
      return res.end('Canvas not built: run npm run build in the codeflow-planner repo')
    }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream')
    fs.createReadStream(file).pipe(res)
  })

  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      const actual = server.address().port
      resolve({
        url: `http://127.0.0.1:${actual}/`,
        port: actual,
        api,
        close: () =>
          new Promise((done) => {
            api.close()
            server.close(() => done())
            server.closeAllConnections?.()
          }),
      })
    })
  })
}
