# AGENTS.md — codex-dashboard

AI coding agents and human contributors guidelines for this repository.

## Language & communication
- Explanations/PR notes: **Japanese by default** (unless English requested).
- Code identifiers/UI labels: **English** (unless an existing file is consistently different).
- Reports must reference concrete files/locations (paths, line ranges, commands).

## Coding conventions
- Prefer arrow functions; React components are arrow functions.
- Prefer `interface` for object shapes; use `type` mainly for unions/mapped/aliases.
- Avoid `any`; if unavoidable, add a short **English** comment with rationale.
- Naming: `camelCase`, correct singular/plural; booleans start with `is`/`has`.
- Strings: single quotes; semicolons; prefer template literals for concatenation.
- Imports grouped with blank lines: built-in → third-party → local.

## TypeScript / React
- Keep modules small and composable; avoid long files that mix unrelated concerns.
- Validate external inputs (HTTP/WS payloads, env) and return explicit errors.
- Avoid implicit defaults; make default values and branches explicit.
- Prefer `readonly` where appropriate and avoid mutating shared state.
- React:
  - Keep state minimal; derive values instead of duplicating state.
  - Prefer controlled components for forms.
  - Avoid sync `setState` patterns inside effects that can cascade renders.

## Error handling & logging
- Fail fast: surface invalid state and errors clearly; no silent failure.
- Use consistent error shapes for APIs (e.g., `{ error: { code, message } }`).
- Log reproducible context (inputs, ids, config keys used), but never log secrets.

## Repository invariants
- Do not introduce hidden behavior changes.
- Do not add arbitrary command execution paths.
- Keep filesystem operations scoped and validated; avoid path traversal patterns.

## Documentation & tests
- Exported functions/components: add **Japanese TSDoc** (purpose, params/returns, constraints, failure modes).
- Non-trivial logic: add short Japanese comments for assumptions and edge cases.
- Tests should be readable; use realistic fixtures where helpful.

## Git Worktree
When instructed to create a worktree and work on it, you generally perform your work within that worktree.

## Branch naming
Use short, readable branch names with a consistent prefix and 3–4 English words.

**Format**
- `<type>/<word1>-<word2>-<word3>` or `<type>/<word1>-<word2>-<word3>-<word4>`
- Lowercase only
- Words are hyphen-separated
- Avoid abbreviations unless they are widely understood (e.g., `api`, `ui`, `ci`)

**Types**
- `feat/` — new features
- `fix/` — bug fixes (non-urgent)
- `hotfix/` — urgent production fixes
- `chore/` — maintenance, refactors, tooling, CI, docs (non-feature work)

**Examples**
- `feat/add-pty-sessions`
- `feat/terminal-chat-toggle`
- `fix/prevent-path-traversal`
- `chore/cleanup-ws-protocol`

## DO / DON’T
- DO: keep changes minimal and scoped; add explicit error handling; log reproducible context.
- DON’T: edit generated artifacts; introduce implicit fallbacks; change major architecture without agreement.
