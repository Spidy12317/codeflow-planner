# Codeflow guide: execution plan (only when the user asks)

The Execution view stays hidden until the user asks to see or plan the execution.

- **Plan**: split the approved work into tasks (each with refs to the flow nodes it implements
  and `deps` on other tasks) and propose sub-agents: one orchestrator (you) plus workers grouped
  by independent area, usually by layer or folder so they do not edit the same files. Use as
  few workers as the work needs: every sub-agent has a fixed cost, so a handful of small tasks
  is cheaper done by you. Leave each agent's `model` unset unless the user named one. Save with
  `codeflow_execution({ op: "write", plan })`, then `codeflow_execution({ op: "reveal" })`, and
  tell the user they can drag tasks between agents.
- **Choose the models** (before executing): `codeflow_execution({ op: "read" })`. If it returns
  `needsModel`, ask the user which model those agents should run on, in one question, with no
  option marked as recommended or default:
  - **Haiku**: fastest and uses the least of the usage limit; best for small, mechanical tasks.
  - **Sonnet**: a middle ground in speed, usage and quality.
  - **Opus**: most capable; uses the most of the usage limit.

  Save the answer with `codeflow_execution({ op: "set_model", model })` (add `agentId` when the
  user wants different models per agent). Never spawn a sub-agent on a model you picked.
- **Execute** (when the user says so): follow the user's assignment exactly. Do not reassign
  tasks. Run in waves: a task starts only when all its `deps` are `done`. For each agent with
  ready tasks, spawn one sub-agent (in parallel within a wave) on the agent's `model`, whose
  prompt contains its tasks, the flows they refer to (tell it to read them with
  `codeflow_read({ folder, flow, format: "outline" })` rather than pasting them), the layer
  rules, and the instruction to report back in a few lines. Use `isolation: worktree` when the
  agent's isolation is `worktree` and the repo is a git repo. Mark tasks `in_progress` / `done`
  / `failed` with `codeflow_execution({ op: "set_status" })` as they go, and the matching flow
  nodes with `codeflow_edit`. If a task fails, stop its dependants and ask.
- Unassigned tasks are yours (the orchestrator) to do directly.

Plan shape for `op: "write"`:
`{ orchestrator?: { notes }, agents: [{ id?, name, type? (sub-agent type, e.g. general-purpose), model?, isolation?: "none"|"worktree", notes? }], tasks: [{ id?, title, desc?, refs?: [{ tab, ref }] (flow nodes the task implements), deps?: [task ids that must be done first], agent?: agent id | null (null = you do it), status?: todo|in_progress|done|failed|blocked }] }`
