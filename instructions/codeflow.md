# Codeflow working protocol

Codeflow is a visual planning canvas for this repo. The plan lives in `<repo>/.codeflow/` and is
shown in a browser UI that belongs to this session (it stops when the session ends). You change
the plan only through the `codeflow_*` tools; the canvas updates live.

The canvas has four views: **Flows** (code flow per folder), **Classes** (UML class diagram with
SOLID findings), **Messages**, and **Execution** (orchestrator + sub-agent task split; hidden
until the user asks for it).

This is the core protocol. The rules for each kind of work are in guides you read once, right
before that work, with `codeflow_guide({ topic })`:

| Before you… | Read |
|---|---|
| draft or change a flow, or plan a change | `planning` (includes the plan's JSON shape) |
| make a small status or link edit and only need the JSON shape | `format` |
| map folders to Clean Architecture layers (only when the user asks) | `layers` |
| start a plan for an empty repo | `new-project` |
| plan or run the execution with sub-agents (only when the user asks) | `execution` |
| validate flows against the code | `validation` |

Do not read a guide you do not need for the request, and do not read one twice.

## 1. Open

Call `codeflow_open` with `root` = the repo root (your working directory). Give the user the
returned `url` in one line. Then act on `state`:

- **existing**: run `codeflow_sync` and summarise its report and its `check` in a few lines
  (added / updated / conflicts / stale; plan gaps to fix).
- **created** (code, but no plan yet): run `codeflow_sync` so the code's flows are drawn as they
  are and summarise its report (folders, flows, warnings) in a few lines. Then call
  `codeflow_validate()` with no arguments and put the questions it returns to the user (whether
  to validate the flows with sub-agents, on which model, and how thoroughly). Do not start the
  validation, and do not pick a model, until the user answers; then follow the `validation`
  guide. On skip, stop after the summary.
- **new** (empty repo): follow the `new-project` guide.

**Existing code is drawn as it is.** Do not propose restructuring it, moving folders, or
mapping it to Clean Architecture on your own. The plan mirrors the repo's current folders;
changes come only from what the user asks for.

## 2. Read only what you need

- `codeflow_read()` gives the overview: folders with flow counts, and `check`.
- `codeflow_read({ folder, format: "list" })` lists a folder's flows (ids, titles, entries).
- `codeflow_read({ folder, flow, format: "outline" })` is the compact view of one flow, with
  every id an edit can target. Use it for reading and for targeted `edits`.
- Ask for JSON (the default format) only for a flow you are about to rewrite whole.
- Read one flow rather than a whole folder when you know which one you need.

## 3. Working loop

1. Draft or change flows (`codeflow_edit` with `flow` for new or rewritten flows, with `edits`
   for targeted changes), following the `planning` guide. New items get status `proposed` and a
   `change`.
2. Before you show the plan: do the self-review in the `planning` guide and fix what the `check`
   in each `codeflow_edit` result reports until it is `ok`. Then tell the user what changed.
3. The user reviews on the canvas and comments on nodes, classes or tasks.
4. When the user says "check the canvas": `codeflow_messages`, act on each thread (edit the plan
   if asked), answer with `codeflow_messages({ op: 'reply' })`, and resolve threads that are
   done. Any plan edit you make there goes through the self-review again.
5. When the user approves, set the approved items to `approved` and implement exactly what the
   plan says. If the code needs something the plan doesn't show, add it to the plan first.
6. While implementing, keep status current with `codeflow_edit` (`in_progress` → `done` or
   `failed`), several items per call. Leave `change` as it is: it records what was planned.
   After code changes, run `codeflow_sync` for the folders you touched.

Conventions: one step per function call or processing stage, detail in side panels; left and
right panels are alternative views of the same step, not a sequence; open points go in `notes`
(`question`, `check`, `idea`, `fix`) and are removed once resolved.

## 4. Keep the architecture clean

Before implementing and after finishing, run `codeflow_classes`. When layers are mapped, new
code must not add dependency-rule **errors** (an inner layer importing or constructing something
from an outer layer); existing errors are reported, not fixed, unless the user asks. Treat SOLID
**warnings** on classes you touched as review items: fix them or explain in a thread why they
are acceptable.

## 5. Sub-agents: the user chooses the model

Sub-agents are the most expensive thing Codeflow does. Start them only for a validation or an
execution the user asked for or agreed to, and never on a model you chose: `codeflow_validate`
and `codeflow_execution` return the question to ask when a model is missing. Use the number of
sub-agents those tools give you, and give each one a short prompt that tells it what to read
with the `codeflow_*` tools instead of pasting flows, code or this protocol into it.
