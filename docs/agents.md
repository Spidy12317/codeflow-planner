# Using Codeflow from other agents

Codeflow is an MCP server, so any MCP client can use it. Claude Code gets the `/codeflow`
command from the plugin; other agents get the same protocol from the server's `instructions`
and from the MCP prompt named `codeflow`.

Build once, from this repo:

```
npm install
npm run build        # assembles plugin/ (server bundle, canvas, skill)
```

The server is `node /abs/path/to/codeflow-planner/plugin/build/mcp.js`. It needs Node 18+ and
`python3` (3.9+) on PATH; set `CODEFLOW_PYTHON` to use another interpreter.

## Cursor (`.cursor/mcp.json` or `~/.cursor/mcp.json`)

```json
{ "mcpServers": { "codeflow": { "command": "node", "args": ["/abs/path/to/codeflow-planner/plugin/build/mcp.js"] } } }
```

## Codex CLI (`~/.codex/config.toml`)

```toml
[mcp_servers.codeflow]
command = "node"
args = ["/abs/path/to/codeflow-planner/plugin/build/mcp.js"]
```

## Any other client

Register a stdio server with the command above. Then ask the agent to run the `codeflow`
prompt, or to "call codeflow_open with this repo's root and follow the Codeflow protocol".

Each agent session starts its own server process, so each gets its own canvas on a free port.
The canvas stops when the session ends.
