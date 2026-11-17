# Codeflow guide: validating flows with sub-agents

Checking flows against the code reads a lot of code, so it runs in sub-agents and only when the
user wants it:

- after the first sync of an existing repo (state **created**), as an offer;
- when the user asks to validate, verify or review the flows ("are the flows correct?");
- after `codeflow_sync` reports many updates or conflicts, as an offer.

The user decides whether it runs, on which model, and how much it does. You never choose.

1. `codeflow_validate()` (optionally `folders` to limit it). It returns the `size` of the job
   (flows, folders, sub-agents; trivial generated flows are left out) and `ask`: two questions,
   the model (Haiku / Sonnet / Opus / Skip) and the scope (accuracy only, or accuracy plus a
   plain-language rewrite). Ask both in one call of your question tool, with the size in the
   question and no option marked as recommended or default. On **Skip**, stop.
2. `codeflow_validate({ model, rewrite })` with the user's answers. It returns `agents`: one
   ready-made prompt per sub-agent, with its folders. Spawn them in parallel, every one on the
   chosen model, with the prompt as given: do not add the protocol, flows or code to it. One
   sub-agent owns each folder; do not split a folder or add agents.
3. When they report, follow `after` in that result: apply the cross-folder links and fixes,
   fix what `check` reports, and summarise for the user (flows checked, flows fixed, questions
   left on the canvas).

If your client has no sub-agents, work through the prompts yourself, one folder at a time.

For other repo-wide reading (evidence for a layer mapping, a large review), the same rules
hold: at most one sub-agent per ~30 flows, the user chooses the model first, and each prompt
tells the sub-agent to read flows with `codeflow_read({ folder, format: "outline" })`.
