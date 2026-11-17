# Codeflow guide: new project, Clean Architecture by default

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
