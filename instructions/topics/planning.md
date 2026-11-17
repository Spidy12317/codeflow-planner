# Codeflow guide: planning a change

## 4.1 Write flows anyone can follow

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

Generated flows are literal code: the extractor writes them that way. Reword them only when
the user asks for it (the plain-language option of a validation, or a direct request), not as a
side effect of other work. Editing a generated flow makes it hand-kept; `codeflow_sync` then
reports code changes to it as conflicts instead of overwriting it.

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
  review and implementation. Do not clear `change` when an item is done: the explorer stops
  showing its letter (A / M / D) on its own once the item is `done`, and a flow's once every
  item with a status in it is `done`.

### 5.5 Removals

For anything marked `remove`, plan every import, call site, registration, setting and test
that refers to it: each becomes `remove` or an `edit` that redirects to the replacement.
Search the repo for the name before presenting the plan.

### 5.6 Follow the repo's structure

Put new code where the repo already puts code of that kind, following its existing patterns
(how its other clients, services and routes are built and wired). Do not restructure existing
code unless the user asks. If layers are mapped, new code also follows the dependency
rule: domain and application do not import or construct adapters or infrastructure;
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
7b. Could a non-technical reader follow every card and line (4.1: plain words, no
   code expressions or jargon, rationale in notes)?
8. Are open decisions written as `question` notes instead of guessed?

Then fix everything the `check` in your last `codeflow_edit` result reports (`orphans`, `unlinked`, `broken`,
`changeMismatches`), and run `codeflow_classes` for dependency-rule errors.

### 5.8 Tell the user what the plan changes

After the plan is on the canvas, summarise in a few lines: the files touched with A / M / D
(new / edited / removed), the entry point(s) the change is reached from, the open questions,
and anything you deliberately left out.
