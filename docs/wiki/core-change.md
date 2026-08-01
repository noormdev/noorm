---
type: Domain
description: Versioned database changes — scaffold, parse, execute, revert, and track history
---

# core-change

## What it does

Manages versioned database changes: scaffold (create/add/remove/rename/reorder change files on disk), parse (discover + validate change folders), execute (forward/revert with checksum-based skip detection), and history (per-change and per-file execution records).

A change directory holds a `change/` folder, an optional `revert/` folder, an optional `changelog.md`, and SQL or `.txt` manifest files. Execution state is stored in the `__noorm_change__` and `__noorm_executions__` tables ([`src/core/shared/tables.ts`](../../src/core/shared/tables.ts)).

## CLI code

- [`src/cli/change/index.ts`](../../src/cli/change/index.ts) — registers the `change` command group: `add|edit|ff|list|next|rm|run|revert|history|rewind|history-detail`
- [`src/cli/change/_prompt.ts`](../../src/cli/change/_prompt.ts) — shared interactive change-name pickers (`selectChangeFromFs`, `selectChangeFromStatus`, `requireTty`) used across the offline (add/edit/rm) and DB-aware (run/revert/rewind/history-detail) commands
- [`src/cli/change/add.ts`](../../src/cli/change/add.ts) — offline; scaffolds a new change via `createChange`
- [`src/cli/change/edit.ts`](../../src/cli/change/edit.ts) — offline; spawns `$EDITOR`/`$VISUAL`/`code` against the change folder
- [`src/cli/change/rm.ts`](../../src/cli/change/rm.ts) — offline; gates on `change:rm` via `checkConfigPolicy` (not `assertPolicy`), then calls `deleteChange`
- [`src/cli/change/run.ts`](../../src/cli/change/run.ts) — applies one named change
- [`src/cli/change/next.ts`](../../src/cli/change/next.ts) — applies the next N pending changes
- [`src/cli/change/ff.ts`](../../src/cli/change/ff.ts) — fast-forward: applies all pending changes; warns rather than fails when the changes directory is missing
- [`src/cli/change/revert.ts`](../../src/cli/change/revert.ts) — reverts one applied change
- [`src/cli/change/rewind.ts`](../../src/cli/change/rewind.ts) — reverts applied changes back to (and including) a named change
- [`src/cli/change/list.ts`](../../src/cli/change/list.ts) — lists all changes with status; an orphaned change appends `, orphaned` inside the same parenthetical (e.g. `myname (success, orphaned)`)
- [`src/cli/change/history.ts`](../../src/cli/change/history.ts) — combined change/revert execution history
- [`src/cli/change/history-detail.ts`](../../src/cli/change/history-detail.ts) — per-file history for one change's operations

## Docs

- [`docs/dev/change.md`](../dev/change.md) — developer reference for change internals
- [`docs/guide/changes/overview.md`](../guide/changes/overview.md) — user-facing: what changes are
- [`docs/guide/changes/forward-revert.md`](../guide/changes/forward-revert.md) — forward and revert semantics
- [`docs/guide/changes/history.md`](../guide/changes/history.md) — history querying
- [`docs/cli/run.md`](../cli/run.md) — run command docs for `noorm run` (build/file/dir/files/exec); a separate command family from `noorm change`

## Coupling

- Calls `runner`'s checksum utilities (`computeChecksum`, `computeCombinedChecksum` from [`src/core/runner/checksum.ts`](../../src/core/runner/checksum.ts)) — checksum algorithm changes propagate here.
- `ChangeTracker` ([`src/core/change/tracker.ts`](../../src/core/change/tracker.ts)) extends `Tracker` from [`src/core/runner/tracker.ts`](../../src/core/runner/tracker.ts) — base tracker changes affect revert/stale logic.
- Reads config via [`src/core/config/`](../../src/core/config) to resolve the active database connection — config schema changes affect `ChangeContext` construction.
- Emits `change:*` events (`change:start`, `change:file`, `change:complete`, `change:skip`, `change:created`, `file:dry-run`) via [`src/core/observer.ts`](../../src/core/observer.ts) — the TUI's `useChangeProgress` hook ([`src/tui/hooks/useChangeProgress.ts`](../../src/tui/hooks/useChangeProgress.ts)) subscribes, consumed by `ChangeNextScreen`, `ChangeFFScreen`, `ChangeRevertScreen`, `ChangeRewindScreen`, `ChangeRunScreen` under [`src/tui/screens/change/`](../../src/tui/screens/change).
- Writes to `__noorm_change__` and `__noorm_executions__` tables defined in [`src/core/shared/tables.ts`](../../src/core/shared/tables.ts) — table renames propagate to executor and history queries.
- `executeChange`/`revertChange` call `assertPolicy` from [`src/core/policy/`](../../src/core/policy) before executing, gated on `change:run`/`change:revert`; [`src/cli/change/rm.ts`](../../src/cli/change/rm.ts) gates `change:rm` separately via `checkConfigPolicy` — `ChangeContext` carries `access`/`channel` for the gate; policy-matrix changes in [`src/core/policy/matrix.ts`](../../src/core/policy/matrix.ts) affect which roles can run/revert/rm changes.
- `ChangeTracker.markAllAsStale` is called from [`src/core/teardown/operations.ts`](../../src/core/teardown/operations.ts) (core-db domain) after a teardown, to mark applied changes as needing re-application.
- [`src/sdk/namespaces/changes.ts`](../../src/sdk/namespaces/changes.ts) wraps `ChangeManager` and the scaffold functions for the programmatic SDK — SDK's `Changes` namespace API shape changes with `ChangeManager`'s public methods.
- [`src/rpc/commands/changes.ts`](../../src/rpc/commands/changes.ts) exposes change operations (e.g. `change_history`) as MCP/RPC commands, delegating to `ctx.noorm.changes` — same SDK surface as above.
- CLI commands in [`src/cli/change/`](../../src/cli/change) call `ChangeManager` + scaffold functions directly — `ChangeManager`/scaffold signature changes require CLI command updates.

## Conventions worth knowing

- Change directory names follow `YYYY-MM-DD-<slugified-description>` (`DATE_PREFIX_REGEX` in `parser.ts`); a name without a date prefix is parsed with `date: null` and the whole name as `description`.
- Change files are ordered by 3-digit sequence prefix: `NNN_description.{sql,sql.tmpl,txt}` (`SEQUENCE_REGEX`); `.txt` files are manifests referencing other SQL files, resolved in the manifest's own line order (not re-sorted).
- `createChange` always scaffolds one stub file into `change/` and one into `revert/` (`CHANGE_STUB_TEMPLATE` / `REVERT_STUB_TEMPLATE` in `scaffold.ts`) — an empty `change/`+`revert/` pair fails `parseChange`'s validation, so the stub exists purely so the change is runnable immediately.
- `executor.ts`'s pre-execution content gate (`hasExecutableSql`) checks for any non-blank, non-`--`-comment line — it does not call `validateChangeContent` from `validation.ts`. `validation.ts`'s `SQL_TEMPLATE` constant (`'-- TODO: Add SQL statements here\n'`) is a stale exact-match check no longer used at the executor seam; it is still imported and called only by the TUI's `ChangeFFScreen.tsx` and `ChangeRunScreen.tsx` for pre-flight UI checks.
- `DEFAULT_CHANGE_OPTIONS` and `DEFAULT_BATCH_OPTIONS` (`types.ts`) define `force`/`dryRun`/`preview`/`output`/`abortOnError` defaults; `executor.ts` and `manager.ts` each keep their own local copy of the same defaults (`DEFAULT_OPTIONS`, `DEFAULT_BATCH`).
- Error classes (`ChangeValidationError`, `ChangeNotFoundError`, `ChangeAlreadyAppliedError`, `ChangeNotAppliedError`, `ChangeOrphanedError`, `ManifestReferenceError`) extend `Error` with a `name` and structured fields; callers distinguish failure modes by class, not a `code` field.
- Only Postgres wraps a change's file execution in a DB transaction (`TRANSACTIONAL_DIALECTS` in `executor.ts`): MySQL's DDL implicitly commits, MSSQL's GO-batch execution hasn't been verified to compose with a wrapping transaction, and SQLite is excluded so per-file partial success (used by unit tests) keeps working. On a failed Postgres change, neither the DDL nor its history rows persist — the caller still sees the failure via the returned `ChangeResult`, unwrapped from a thrown `ChangeRollback` sentinel.
- `history.ts`'s `hydrateDate` normalizes `executed_at` to UTC: Postgres and MySQL drivers (`pg`, `mysql2`) parse the naive `timestamp`/`datetime2` column in the host's local zone, so their `Date` values are reinterpreted field-by-field as UTC; SQLite returns text and is parsed by appending `Z`. MSSQL (`tedious`) is deliberately left unmodified — not measured, left as-is to avoid a correction in the wrong direction.
- `ChangeStatus`/`ChangeListItem` carry `appliedHistoryId?: number | null` — the `__noorm_change__` row's autoincrement id, used as the true apply-order tiebreaker (over second-precision `appliedAt`) in `ChangeManager.rewind()`.
- `ChangeHistory.needsRunFile` excludes `pending` and `skipped` execution rows from its lookback, and bounds the lookback at the most recent opposite-direction operation's id — a prior success only licenses a per-file skip while no revert/re-apply has happened since.
- `RESET_MARKER = '__reset__'` is a reserved change name: `ChangeHistory.recordReset` writes a `db teardown` audit row under this name so it appears in `getHistory`/`getUnifiedHistory`, but `getAllStatuses` explicitly filters it out so it never appears in `change list`.
- `isPendingChange` (types.ts) is the single shared predicate for "needs a forward run" (`pending`, `reverted`, or `stale` status, and not orphaned) — used by `ChangeManager.next`/`ff` and the CLI's interactive pickers; the file's own doc comment warns this predicate must be updated everywhere at once when a new status is added.
