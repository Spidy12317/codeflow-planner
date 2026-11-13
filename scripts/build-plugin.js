#!/usr/bin/env node
// Assembles the installable Claude Code plugin in plugin/ (after vite build + esbuild):
//   plugin/.claude-plugin/plugin.json   manifest
//   plugin/.mcp.json                    the codeflow MCP server (bundled, no node_modules needed)
//   plugin/skills/codeflow/SKILL.md     the /codeflow command = instructions/codeflow.md
//   plugin/instructions/codeflow.md     same text, served as MCP instructions + prompt
//   plugin/build/, plugin/dist/         server bundle + canvas (written by the build steps)
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'))
const out = path.resolve('plugin')
const write = (rel, text) => {
  fs.mkdirSync(path.dirname(path.join(out, rel)), { recursive: true })
  fs.writeFileSync(path.join(out, rel), text)
}
const instructions = fs.readFileSync('instructions/codeflow.md', 'utf8')

write(
  '.claude-plugin/plugin.json',
  JSON.stringify(
    {
      name: 'codeflow',
      version: pkg.version,
      description: 'Plan code changes on a visual canvas: code flows, UML class diagram with SOLID checks, and a sub-agent execution plan. One canvas per session, stored in <repo>/.codeflow.',
    },
    null,
    2,
  ) + '\n',
)
write('.mcp.json', JSON.stringify({ mcpServers: { codeflow: { command: 'node', args: ['${CLAUDE_PLUGIN_ROOT}/build/mcp.js'] } } }, null, 2) + '\n')
write('instructions/codeflow.md', instructions)
write(
  'skills/codeflow/SKILL.md',
  `---
name: codeflow
description: Open this repo's Codeflow canvas (<repo>/.codeflow) and plan, review and implement changes on it. Creates the plan if missing (Clean Architecture by default for new projects), refreshes flows from the code, shows UML/SOLID findings, and runs a sub-agent execution plan when asked.
argument-hint: "[what you want to plan or do]"
---

Use the codeflow MCP tools and follow this protocol. Start with step 1 now, using your current
working directory as the repo root. If the user passed a request with the command, carry it out
after opening: $ARGUMENTS

${instructions}`,
)
console.log(`plugin/ assembled (v${pkg.version})`)
