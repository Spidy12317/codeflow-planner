# Codeflow working protocol

Codeflow is a visual planning canvas for this repo. The plan lives in `<repo>/.codeflow/` and is
shown in a browser UI that belongs to this session (it stops when the session ends). You change
the plan only through the `codeflow_*` tools; the canvas updates live.

The canvas has four views: **Flows** (code flow per folder), **Classes** (UML class diagram with
SOLID findings), **Messages**, and **Execution** (orchestrator + sub-agent task split; hidden
until the user asks for it).

## 1. Open

Call `codeflow_open` with `root` = the repo root (your working directory). Give the user the
returned `url` in one line. Then act on `state`:

- **existing**: run `codeflow_sync` and summarise its report and its `check` in a few lines
  (added / updated / conflicts / stale; plan gaps to fix).
- **created** (code, but no plan yet): run `codeflow_sync` so the code's flows are drawn as they
  are, then validate them with sub-agents (section 8) and summarise what was found and fixed
  (folders, flows, corrections, open questions) in a few lines.
- **new** (empty repo): do step 3.

**Existing code is drawn as it is.** Do not propose restructuring it, moving folders, or
mapping it to Clean Architecture on your own. The plan mirrors the repo's current folders;
changes come only from what the user asks for. Layer mapping (step 2) is optional and only
happens when the user asks for it (e.g. "map the layers", "check the architecture").

## 2. Map the layers (only when the user asks)

Propose a Clean Architecture mapping of the plan folders to `domain`, `application`, `adapters`,
`infrastructure` (innermost first). The dependency rule protects the core: domain and
application must not depend on anything outside them; adapters and infrastructure form the outer
ring and may use each other.

**Read the code first. Never propose a mapping from folder names alone.** Before the table:

1. Run `codeflow_classes` (it works without layers). Use its `modules` (what each folder
   imports) and `classes` (bases such as `BaseModel`, SQLAlchemy `Base`, `ABC`/`Protocol`,
   what each class constructs and calls).
2. Read the generated flows from `codeflow_sync`, and open one or two representative files per
   folder where the purpose is still unclear.
3. Classify by what the code does:
   - **domain**: entities, value objects and business rules with no I/O and no framework
     imports. Pydantic models used only as API request/response schemas are not domain
     (they're adapters); SQLAlchemy / ORM models are not domain (adapters or infrastructure).
   - **application**: use cases and services that orchestrate domain objects and reach the
     outside only through ports or injected collaborators.
   - **adapters**: HTTP routes and controllers, API schemas, repositories, clients for LLMs or
     other external APIs, gateways, message consumers.
   - **infrastructure**: framework and app setup, settings and config, DB engine and sessions,
     migrations, logging, `main` / composition root.

Rules for the table:

- Each folder appears in exactly one layer. When a folder mixes layers (e.g. a service folder
  with its own `models/` and an API client), map the subfolders separately: the longest
  matching prefix wins, so `services` → application and `services/llm_service/utils` → adapters
  can coexist.
- One row per folder (or prefix), with a short **why** column citing the evidence
  ("imports sqlalchemy, defines ORM models", "calls AzureOpenAI SDK", "no imports outside
  domain"). Mark guesses as such and ask about them specifically.
- List the folders where the code already breaks the rule you are proposing (e.g. a service
  that imports a route module): they show up as dependency-rule errors once the layers are set.

Ask the user to confirm or correct it, then save it with `codeflow_project({ layers })`. Never
set layers without a yes. Then run `codeflow_classes` again and report the dependency-rule errors
and the top SOLID warnings.

## 3. New project: Clean Architecture by default

The plan was created with Clean Architecture layer tabs (`app/domain/...`, `app/application/
use_cases`, `app/application/ports`, `app/adapters/...`, `app/infrastructure`). Nothing exists
on disk yet. Ask what the user wants to build, then draft it as flows with status `proposed`:

- A flow lives in the tab of its entry point (an HTTP endpoint → `adapters/api`).
- The controller step calls a use case (`link` to the `application/use_cases` tab); the use case
  talks to repositories and gateways only through ports (`application/ports`); implementations
  live in `adapters/repositories` / `adapters/gateways`; wiring lives in `infrastructure`.
- Put entity and port definitions in flow `refs` tables so the class model is visible early.

Design for SOLID: one reason to change per class, depend on ports not concrete adapters,
small role-specific interfaces, subclasses honour their base contracts, extend by adding
classes rather than editing `if type == ...` chains. Run `codeflow_project({ scaffold: true })` only after the user
approves the plan; it creates the folders as Python packages.

## 4. Working loop

1. Draft or change flows (`codeflow_edit` with `flow` for new or rewritten flows, with `edits` for
   targeted changes), following section 5. New items get status `proposed` and a `change`.
2. Before you show the plan: do the self-review in 5.7 and fix what the `check` in each
   `codeflow_edit` result reports until it is `ok`. Then tell the user what changed (5.8).
3. The user reviews on the canvas and comments on nodes, classes or tasks.
4. When the user says "check the canvas": `codeflow_messages`, act on each thread (edit the plan
   if asked), answer with `codeflow_messages({ op: 'reply' })`, and resolve threads that are done. Any plan edit you
   make there goes through 5.7 again.
5. When the user approves, set the approved items to `approved` and implement exactly what the
   plan says. If the code needs something the plan doesn't show, add it to the plan first.
6. While implementing, keep status current with `codeflow_edit` (`in_progress` → `done` or
   `failed`). After code changes, run `codeflow_sync` for the folders you touched.

Conventions: one step per function call or processing stage, detail in side panels; left and
right panels are alternative views of the same step, not a sequence; open points go in `notes`
(`question`, `check`, `idea`, `fix`) and are removed once resolved.

### 4.1 Write flows anyone can follow

The canvas is read by people who do not write code: product owners, analysts, reviewers. Every
card and line should make sense to them in a few seconds, in plain English. Developers still
get the exact code location from each card's small grey `module` line and from the links.

**Plain language first**
- Write what happens in everyday words: "Check that Claude is set up", not
  `settings.is_configured()`.
- Name things by what they are to the business: "the contract", "the uploaded document",
  "the AI provider", "the checklist". Use a code name only when there is no plain word, and
  then put it after the plain words: "Save the result (CompletionResponse)".
- No jargon: not "instantiate", "kwargs", "semaphore", "payload", "serialise", "async",
  "None". Say "create", "settings", "limit how many requests run at once", "data",
  "convert to text", "in the background", "nothing".
- Explain an unavoidable technical term once, in a note.

**Step cards**
- `name`: a short action in plain words, starting with a verb: "Ask Claude for an answer",
  "Pick the AI provider", "Read the uploaded file".
- `module`: the code location for developers, e.g. `ClaudeClient.complete()` or
  `services.llm_service.service.LLMService`.
- `desc`: one sentence, at most ~15 words, on why the step matters: "Each provider needs its
  own client; this picks the right one."
- `inputs`: what goes in, in plain words ("the question", "how creative the answer may be");
  skip technical plumbing.
- `returns`: what comes back, in plain words ("the answer and how much it cost").

**Lines in the side panels**
- One action per line, a short sentence, about 60 characters at most.
- Decisions as questions: "Is Claude set up?", "Did Claude refuse?", "Any pages left?",
  with branch labels such as "Yes" / "No" or "Refused" / "OK".
- Errors as "Stop: <reason in plain words>": "Stop: Claude is not set up".
- Results as "Send back <what>": "Send back the answer and token counts".
- Loops as "For each <thing>": "For each page of the document".
- Calls to other systems as "Ask <system> to <do something>": "Ask Claude to answer".
- Leave out: argument lists, settings names, log messages, type details, retries and
  timeouts, unless they are the point of the change. Then say them plainly: "Retry up to
  2 times".
- Reasons, caveats, API quirks and alternatives go in **notes** (`idea`, `check`,
  `question`), never as lines in the flow.

**Reference tables**: plain-language descriptions ("the key that lets us use Claude"); keep
field names as they are in the code so developers can find them; only the fields that matter.

**Before / after**

| Technical | Plain |
|---|---|
| `self._client = AsyncAnthropic(api_key=settings.ANTHROPIC_API_KEY, max_retries=settings.MAX_RETRIES)` | Connect to Claude using our API key |
| `settings.is_configured()?` | Is Claude set up? |
| `raise ConfigurationError('Claude is not configured. Set ANTHROPIC_API_KEY')` | Stop: Claude is not set up |
| `self._semaphore = asyncio.Semaphore(settings.MAX_CONCURRENT)` | Limit how many requests run at once |
| `logger.error('Claude request failed \| model=%s request_id=%s', model, rid)` | Record the failure |
| `response.stop_reason == 'refusal'` | Did Claude refuse to answer? |
| `content = ''.join(b.text for b in response.content if b.type == 'text').strip()` | Combine the answer text |
| `case CLAUDE → ClaudeClient(temperature=temperature)` | If the provider is Claude → use the Claude client |
| step `create()` with desc "Opus 5.5 returns 400 on temperature/top_p…" | step "Ask Claude for an answer"; the temperature detail as a `check` note |

These rules apply to generated flows too: the extractor writes literal code, so tidy lines
that break them when you validate (section 8). Editing a generated flow makes it hand-kept;
`codeflow_sync` then reports code changes to it as conflicts instead of overwriting it.

## 5. Planning a change: complete and wired

A plan is a promise that the code will work after implementing exactly what it shows. A piece
that exists but is never constructed, imported, registered or called is a bug in the plan.
Work through this for every change, however small.

### 5.1 Trace it end to end

Start at an entry point (route, CLI command, job, event handler) and follow the call path to
the new or changed code and back out to the response. Every hop on that path is in the plan:
either an existing flow (linked), or a step you add. If a new piece cannot be reached from an
entry point, find its caller and plan the edit to that caller. Only flows that are themselves
called from outside the code (HTTP routes, CLI, scheduled jobs) may stand alone; mark those
`entrypoint: true`.

### 5.2 Every new piece needs its wiring

For each new class, function, method or module, plan all of these that apply, each as its
own step or line with the right `change`:

| Wiring | What to show |
|---|---|
| Definition | the flow of the new code itself (its own flow if it has logic of its own) |
| Contract | the base class / port / protocol it implements, in a `refs` table; signatures match the base (no narrowed parameters, no `NotImplementedError` overrides) |
| Import | a `new` line in plain words in the step that uses it ("Bring in the Claude client"); the module path goes in that step's `module` |
| Construction | where the object is created and from what (a provider switch, a setup step, the owner's constructor), as a `new` line in plain words ("If the provider is Claude → use the Claude client") |
| Registration | enum members, factory / match cases, router `include_router`, dependency providers, plugin lists, `__all__` exports |
| Configuration | new settings fields and env vars in a `refs` table (`change: new`), where they are read, defaults, and what happens when they are missing |
| Dependencies | new packages: a `check` note naming the package and version for requirements / pyproject |
| Callers | every existing call site that must change to use it, each an `edit` step or a `new` line |
| Errors | the exceptions it raises and where each one is caught (a `try` with its `except` panel), so no new error escapes unhandled |
| Data | new fields, models, migrations, and every reader / writer of them |
| Tests | a `check` note listing the tests to add or update |

### 5.3 Link every hop

Any step, line or gather task that calls, constructs or imports something that has a flow in
the plan carries `link: { tab: <folder>, flow: <flow id> }` to that flow, in the same folder
or another one. For a call to code that is planned but has no flow yet, write that flow
first, then link to it. Never leave a call to a planned piece as plain text: the user follows
links to review the wiring, and the `check` in every edit result reports unlinked calls and broken links.

### 5.4 Mark what changes, precisely

Every planned item gets a `change`: `new` (adds code), `edit` (changes existing code) or
`remove` (deletes it). Code that stays as it is (shown for context) gets no `change`.

- Mark the most specific item. A new `case` inside an existing function is a `new` line inside
  an `edit` step; a new member on an existing enum is an `edit` step with a `new` line.
- Do not repeat a change that the container already has: inside a `new` flow, steps and lines
  are new already. Mark only the items that differ (an `edit` to an existing model called from
  a new flow).
- `new` means the symbol does not exist in the repo today; `edit` and `remove` mean it does.
  Check the code before choosing. The `check` in edit results flags disagreements.
- Status (`proposed` → `approved` → `in_progress` → `done` / `failed`) is separate and tracks
  review and implementation.

### 5.5 Removals

For anything marked `remove`, plan every import, call site, registration, setting and test
that refers to it: each becomes `remove` or an `edit` that redirects to the replacement.
Search the repo for the name before presenting the plan.

### 5.6 Follow the repo's structure

Put new code where the repo already puts code of that kind, following its existing patterns
(how its other clients, services and routes are built and wired). Do not restructure existing
code unless the user asks. If layers are mapped, new code also follows the dependency rule
(section 6): domain and application do not import or construct adapters or infrastructure;
show the wiring step that injects the implementation.

### 5.7 Self-review before presenting

Ask these for the whole change and fix the plan until every answer is yes:

1. Can each new piece be reached from an entry point by following links on the canvas?
2. Is every new symbol imported where it is used, and constructed or registered somewhere?
3. Does every call to planned code carry a `link`, and does every link resolve?
4. Is every new setting defined, read and documented, with behaviour when it is missing?
5. Is every new exception caught somewhere on the path?
6. Is every existing caller that must change marked `edit`?
7. Does every planned item have the right `change`, with no repeats inside a `new` container?
7b. Could a non-technical reader follow every card and line (section 4.1: plain words, no
   code expressions or jargon, rationale in notes)?
8. Are open decisions written as `question` notes instead of guessed?

Then fix everything the `check` in your last `codeflow_edit` result reports (`orphans`, `unlinked`, `broken`,
`changeMismatches`), and run `codeflow_classes` for dependency-rule errors.

### 5.8 Tell the user what the plan changes

After the plan is on the canvas, summarise in a few lines: the files touched with A / M / D
(new / edited / removed), the entry point(s) the change is reached from, the open questions,
and anything you deliberately left out.

## 6. Keep the architecture clean

Before implementing and after finishing, run `codeflow_classes`. When layers are mapped, new
code must not add dependency-rule **errors** (an inner layer importing or constructing something
from an outer layer); existing errors are reported, not fixed, unless the user asks. Treat SOLID **warnings** on classes you touched as review items: fix them or explain in
a thread why they are acceptable.

## 7. Execution plan (only when the user asks)

The Execution view stays hidden until the user asks to see or plan the execution.

- **Plan**: split the approved work into tasks (each with refs to the flow nodes it implements
  and `deps` on other tasks) and propose sub-agents: one orchestrator (you) plus workers grouped
  by independent area, usually by layer or folder so they do not edit the same files. Save with
  `codeflow_execution({ op: "write", plan })`, then `codeflow_execution({ op: "reveal" })`, and
  tell the user they can drag tasks between agents.
- **Execute** (when the user says so): `codeflow_execution({ op: "read" })` and follow the
  user's assignment exactly. Do not reassign tasks. Run in waves: a task starts only when all its
  `deps` are `done`. For each agent with ready tasks, spawn one sub-agent (in parallel within a
  wave) whose prompt contains its tasks, the relevant flows (`codeflow_read`), the layer rules,
  and the instruction to report back. Use the agent's `model` if set, and `isolation: worktree`
  when the agent's isolation is `worktree` and the repo is a git repo. Mark tasks
  `in_progress` / `done` / `failed` with `codeflow_execution({ op: "set_status" })` as they go,
  and the matching flow nodes with `codeflow_edit`. If a task fails, stop its dependants and ask.
- Unassigned tasks are yours (the orchestrator) to do directly.

## 8. Sub-agents for repo-wide reading and validation

Reading a whole codebase in one context is slow and loses detail. Split it across sub-agents
(Claude Code's Agent tool, or your client's equivalent) whenever the work covers many folders:

- the first sync of an existing repo (state **created**): validate every generated flow;
- whenever the user asks to validate, verify or review the flows ("are the flows correct?");
- after `codeflow_sync` reports many updates or conflicts, or after large code changes;
- layer mapping, when the user asks for it: one sub-agent per group gathers the evidence.

If your client has no sub-agents, do the same steps yourself, folder by folder.

### 8.1 Split

- Group the plan folders into at most 6 groups of similar size (count flows per folder from
  `codeflow_read`). Keep a folder and its subfolders together; put small related folders in
  one group.
- **One owner per folder.** No two sub-agents ever edit the same folder: `codeflow_edit` writes the
  whole folder file. Cross-folder fixes go in the report
  instead, and you apply them after the sub-agents finish.
- Run the sub-agents in parallel. Reading and comparing is fine on a faster model.

### 8.2 What each sub-agent gets

Write the prompt so it works with no other context:

- the repo root and its folders, and that it may change only those folders' plans, never code;
- these steps, for every flow in its folders:
  1. `codeflow_read({ folder })`, then read the flow's entry file and the code it calls.
  2. Compare the flow with the code: the entry line is right; the steps exist in this order;
     every call, condition, loop, try/except, raise and return in the panels matches the code;
     nothing is invented and nothing important is missing (a call into this repo, an awaited
     call, a raise, an early return).
  3. Fix what is wrong with `codeflow_edit` (`edits`, or `flow` for a flow that needs a
     rewrite). Keep ids, status, notes and threads. Do not add `status` or `change` to describe
     existing code: those are for planned changes.
  3b. Rewrite cards and lines into the plain language of 4.1 so a non-technical reader can
     follow them: plain-verb step names (code location in `module`), questions for decisions,
     "Stop: …" for errors, no code expressions or jargon. Keep the meaning; move detail that
     matters into notes.
  4. Add links: a step or line that calls code whose flow is in another folder gets
     `link: { tab, flow }` when that flow exists; if it is in another sub-agent's folder,
     report it instead.
  5. When the code is ambiguous or the right answer needs the user, add a `question` or
     `check` note to the step instead of guessing.
  6. Flag public code with no flow that should have one (an entry point the extractor
     missed) and draw it if it's in its folders.
- what to send back, kept short: per flow `ok`, `fixed: <what>`, or `needs user: <question>`;
  the cross-folder links or fixes it could not make; anything the extractor got
  systematically wrong.

### 8.3 After the sub-agents

1. Apply the cross-folder links and fixes they reported.
2. Fix what the `check` reports (from your last `codeflow_edit`, or `codeflow_read` with no folder).
3. Tell the user in a few lines: flows checked, flows fixed (and the most common kind of
   fix), questions left on the canvas, and anything the extractor can't capture that they
   should know about.

