#!/usr/bin/env node
// Composition root: the codeflow MCP server (stdio). One process per agent session.
// codeflow_open binds <repo>/.codeflow and starts this session's canvas on a free port;
// when the session ends (stdin closes or the agent stops the server) the canvas stops too.
//
//   node src/main/mcp.js [--plan /path/to/plan]     (bundled: node build/mcp.js)
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { registerTools } from '../adapters/mcp/tools.js'
import { openProject } from '../application/usecases/openProject.js'
import { PLAN_FORMAT } from '../domain/plan/format.js'
import { createFsPlanRepository } from '../infrastructure/fsPlanRepository.js'
import { pythonExtractor } from '../infrastructure/pythonExtractor.js'
import { fsWorkspace } from '../infrastructure/fsWorkspace.js'
import { openUrl } from '../infrastructure/opener.js'
import { startUiServer } from './uiServer.js'

const here = path.dirname(fileURLToPath(import.meta.url))
// Works from plugin/build (bundled) and from src/main (dev, after npm run build).
const findUp = (rel) => [path.join(here, '..', rel), path.join(here, '../..', rel), path.join(here, '../../plugin', rel)].find((p) => fs.existsSync(p))
const STATIC_DIR = findUp('dist')
// instructions/codeflow.md is the core protocol; instructions/topics/<topic>.md are the guides
// codeflow_guide serves when that kind of work starts.
const INSTRUCTIONS_DIR = path.dirname(findUp('instructions/codeflow.md'))
const PROTOCOL = fs.readFileSync(path.join(INSTRUCTIONS_DIR, 'codeflow.md'), 'utf8')
// Server instructions sit in every session's context while the server is enabled, so keep them
// short; the protocol is delivered only when Codeflow is used (codeflow_open, the prompt).
const INSTRUCTIONS = `Codeflow: a visual planning canvas for this repo (code flows, UML/SOLID, execution plan).
Use it only when the user asks for Codeflow or to plan, map or review code flows on the canvas.
Start with codeflow_open (root = the repo root): its result includes the working protocol
(\`protocol\`) to follow for the rest of the session.`

const argPlan = process.argv.indexOf('--plan')
const fixedPlan = argPlan > -1 ? process.argv[argPlan + 1] : process.env.CODEFLOW_PLAN_DIR

const bind = (planDir) => ({ repo: createFsPlanRepository(path.resolve(planDir)), extractor: pythonExtractor, workspace: fsWorkspace })

const session = {
  current: fixedPlan ? bind(fixedPlan) : null,
  ui: null,

  ctx() {
    if (session.current) return session.current
    const guess = path.join(process.cwd(), '.codeflow')
    if (fs.existsSync(path.join(guess, 'project.json'))) return (session.current = bind(guess))
    throw new Error('No plan open. Call codeflow_open with the repo root first.')
  },

  protocolSent: false,

  guide(topic) {
    if (topic === 'format') return PLAN_FORMAT
    const text = fs.readFileSync(path.join(INSTRUCTIONS_DIR, 'topics', `${topic}.md`), 'utf8')
    return topic === 'planning' ? `${text}\n## Plan format\n\n${PLAN_FORMAT}\n` : text
  },

  async open(root, { browser = true, protocol } = {}) {
    const repoRoot = path.resolve(root || process.cwd())
    const planDir = root || !fixedPlan ? path.join(repoRoot, '.codeflow') : path.resolve(fixedPlan)
    if (session.current?.repo.planDir !== planDir) {
      await session.closeUi()
      session.current = bind(planDir)
    }
    const ctx = session.current
    const result = openProject(ctx, { root: repoRoot, name: path.basename(repoRoot) })
    fs.writeFileSync(path.join(planDir, '.gitignore'), '.session.json\n*.tmp\n')

    // Another live session may already show this plan; mention it, still start our own.
    const sessionFile = path.join(planDir, '.session.json')
    let other = null
    try {
      const s = JSON.parse(fs.readFileSync(sessionFile, 'utf8'))
      if (s.pid !== process.pid && isAlive(s.pid)) other = s.url
    } catch {
      /* no other session */
    }

    let opened = false
    if (!session.ui) {
      if (!STATIC_DIR) throw new Error('Canvas not built: run npm run build in the codeflow-planner repo')
      session.ui = await startUiServer(ctx, { staticDir: STATIC_DIR })
      fs.writeFileSync(sessionFile, JSON.stringify({ url: session.ui.url, pid: process.pid, started: new Date().toISOString() }) + '\n')
      if (browser && !process.env.CODEFLOW_NO_BROWSER) opened = openUrl(session.ui.url)
    }
    // Send the protocol once per session unless the caller already has it (the /codeflow skill).
    const sendProtocol = protocol ?? !session.protocolSent
    if (sendProtocol) session.protocolSent = true
    return { ...result, url: session.ui.url, browserOpened: opened, ...(other && { otherSessionUrl: other }), ...(sendProtocol && { protocol: PROTOCOL }) }
  },

  async closeUi() {
    if (!session.ui) return
    const ui = session.ui
    session.ui = null
    await ui.close()
    const sessionFile = path.join(session.current.repo.planDir, '.session.json')
    try {
      if (JSON.parse(fs.readFileSync(sessionFile, 'utf8')).pid === process.pid) fs.unlinkSync(sessionFile)
    } catch {
      /* already gone */
    }
  },
}

function isAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

const server = new McpServer({ name: 'codeflow', version: '0.4.0' }, { instructions: INSTRUCTIONS })
registerTools(server, session)
server.prompt('codeflow', 'Open this repo\'s code-flow plan and follow the Codeflow working protocol.', () => ({
  messages: [{ role: 'user', content: { type: 'text', text: PROTOCOL } }],
}))

// The session is over when the agent closes our stdin or stops the process.
let stopping = false
async function shutdown() {
  if (stopping) return
  stopping = true
  setTimeout(() => process.exit(0), 2000).unref()
  await session.closeUi().catch(() => {})
  process.exit(0)
}
process.stdin.on('end', shutdown)
process.stdin.on('close', shutdown)
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, shutdown)

await server.connect(new StdioServerTransport())
