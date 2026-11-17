# Codeflow guide: map the layers (only when the user asks)

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
