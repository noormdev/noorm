---
type: Domain
---

# core-change

## What it does

Manages versioned database changes: scaffold (create/add/remove/reorder files), parse (discover + validate), execute (forward/revert with tracking), and history (execution records per change and per file).

Change directories hold a `manifest.json` and SQL files. Each change has a description-based name, forward files, and optional revert files. Execution state is stored in the `__noorm_change__` and `__noorm_executions__` noorm tables.

## CLI code

- `src/core/change/scaffold.ts` — create/add/remove/rename/reorder change files on disk
- `src/core/change/parser.ts` — `parseChange`, `discoverChanges`, `resolveManifest`, `validateChange`, `parseSequence`, `parseDescription`
- `src/core/change/executor.ts` — `executeChange`, `revertChange`; applies SQL via the runner, records results
- `src/core/change/history.ts` — `ChangeHistory`; queries `__noorm_change__` and `__noorm_executions__` for per-change and per-file history
- `src/core/change/tracker.ts` — `ChangeTracker`; `canRevert` logic, orphaned-change detection
- `src/core/change/manager.ts` — `ChangeManager`; high-level facade: `list`, `run`, `revert`, `ff` (fast-forward)
- `src/core/change/validation.ts` — `validateChangeContent`; structural content checks
- `src/core/change/types.ts` — all change types, error classes (`ChangeValidationError`, `ChangeNotFoundError`, etc.)

## Docs

- `docs/dev/change.md` — developer reference for change internals
- `docs/guide/changes/overview.md` — user-facing: what changes are
- `docs/guide/changes/forward-revert.md` — forward and revert semantics
- `docs/guide/changes/history.md` — history querying
- `docs/cli/run.md` — run command docs (also covers change run)

## Coupling

- Calls `runner` (`runFile`) to execute SQL inside a change — changes in runner's `RunOptions` or file-execution semantics propagate here.
- Reads config via `src/core/config/` to resolve the active database connection — config schema changes affect `ChangeContext` construction.
- Emits events via `src/core/observer.ts` (`change:*` events) — the TUI subscribes via `useChangeProgress` hook.
- Writes to `__noorm_change__` and `__noorm_executions__` tables defined in `src/core/shared/tables.ts` — table renames propagate to executor and history queries.
- CLI commands in `src/cli/change/` call manager + scaffold functions — CLI argument shape changes here require CLI command updates.

## Conventions worth knowing

- Change directory names follow the pattern `YYYY-MM-DD-<description>`.
- `manifest.json` lists files in execution order; reorder functions rewrite it.
- `parseSequence` extracts a numeric prefix from filename for ordering.
- `DEFAULT_CHANGE_OPTIONS` and `DEFAULT_BATCH_OPTIONS` define timeout and retry defaults.
- Error classes extend `Error` with a `code` field; callers check `code` to distinguish failure modes.
