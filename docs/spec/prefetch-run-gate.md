# Spec: prefetch run gate


## Approach

One prefetch query per batch replaces the per-file skip lookups. A pure decision function, applied in memory, decides skip or run. See `docs/design/prefetch-run-gate.md`.


## Goal

`run build`, `run dir`, `run files`, `run file`, `checkFilesStatus` and the change executor decide skip-or-run for a whole batch with a fixed number of tracking queries, independent of file count. A skipped file leaves no trace in the tracking tables.


## Non-goals

- No parallel execution. Files still run sequentially, in discovery order.
- No change to the change-level `ChangeHistory.needsRun` (one query per change).
- No schema change to `__noorm_change__` or `__noorm_executions__`.
- No change to cascade skips: when `abortOnError` stops a batch, the run-set files it never reached keep their pending rows, which `skipRemainingFiles` turns into `skipped`.
- No change to dry-run or preview modes in `executeFiles`.


## Success criteria

1. A pure exported function `decideNeedsRun(record, checksum, force)` holds the runner's skip rules. It returns the same `NeedsRunResult` the per-file `Tracker.needsRun` lookup returned, which is removed:
    - `force` → run, reason `force`
    - lookup error → run, reason `error`
    - no record → run, reason `new`
    - `failed` → run, reason `failed`
    - `pending` → run, reason `new`
    - `skipped` with `skip_reason` other than `unchanged` → run, reason `new`
    - parent change `stale` → run, reason `stale`
    - checksum differs → run, reason `changed`
    - otherwise skip, `skipReason: 'unchanged'`. This includes a `skipped/unchanged` row with a matching checksum, a shape written by older builds.
2. `Tracker.latestExecutions()` returns the newest execution row per filepath for the config in one SELECT, as a `Map<filepath, record>`. It uses the `MAX(id) GROUP BY filepath` form, which runs on all four dialects. On error it emits `observer` `error` and returns the error, so the gate treats every file as reason `error`.
3. `executeFiles`, for non-`change` change types, runs this gate before any tracking write:
    1. Load and render every file once, then hash the rendered SQL. A `.sql.tmpl` is decided on its rendered hash, and a plain `.sql` on its content hash. A file that fails to load goes into the run set with its load error and fails at its turn in the loop.
    2. One `latestExecutions()` call. `force` skips it.
    3. `decideNeedsRun` per file.
    4. Run set empty → return a `BatchResult` with `status: 'success'`, every file `skipped`, no `changeId`, and zero rows written to `__noorm_change__` or `__noorm_executions__`.
    5. Otherwise create the operation, then `createFileRecords` for the run set only, seeded with the rendered checksum.
    6. Walk the files in discovery order. A skip pushes a `skipped` `FileResult` and emits `file:skip` with no database call. A run executes the SQL already rendered in step 1 and updates its row.
4. Skipped files produce no `__noorm_executions__` rows of any status.
5. Tracking queries per `runBuild` are constant in file count. Going from 3 files to 30, with the same skip/run mix, adds zero SELECTs against `__noorm_executions__`.
6. A template whose raw bytes are unchanged but whose rendered output changed (a config or secret input changed) runs. A template whose rendered output is unchanged skips.
7. `runFile` routes through `executeFiles`. A skipped single file writes no operation row. `runFile(..., { preview: true })` renders without executing or writing tracking rows, the same as every other entry point. `executeSingleFile`, `Tracker.recordExecution` and `RecordExecutionData` are removed.
8. `checkFilesStatus` uses `latestExecutions()` + `decideNeedsRun`, so one query for any file count, with categories unchanged.
9. Change executor:
    1. `ChangeHistory` gains a pure `decideNeedsRunFile(record, checksum, force)` and a batch `latestFileExecutions(name, direction)`. The batch method runs one boundary SELECT plus one history SELECT per change, applying the filters the per-file lookup used (name, direction, config, change status not in `reverted`/`stale`, exec status not in `pending`/`skipped`, `id > boundary`). The per-file `needsRunFile` lookup is removed. A filepath listed more than once in a change (through `.txt` manifests) runs at its first occurrence and skips with `already applied` at each later one.
    2. Per-file decisions happen before `createFileRecords`. Pending rows are created for the run set only. Skipped files emit their `skipped` `ChangeFileResult` and make no database call.
    3. The operation row is still written when every file skips, so the change's combined checksum is recorded.
    4. The apply → revert → apply cycle and retry-after-fix behavior are unchanged. The existing `executor.test.ts`, `executor-retry.test.ts` and `history.test.ts` stay green.
10. `bun run typecheck`, `bun run typecheck:tests`, `bun run lint` and `bun test --serial` show no new type errors or test failures against the loop base `bc3ace00`. The integration suites under `tests/integration/runner` and `tests/integration/change` pass where their databases are available.


## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|------------|-------------|-------|------------|----------|
| 1 | Pure decision + batch prefetch | `src/core/runner/tracker.ts`, `types.ts` | atomic-implementer | 4 | 1, 2 |
| 2 | Runner gate | `src/core/runner/runner.ts`, `tracker.ts` | atomic-implementer | 10 | 3–8 |
| 3 | Change-path prefetch | `src/core/change/history.ts`, `executor.ts` | atomic-implementer | 10 | 9, 10 |


## Change tree

```
src/core/runner/
    M tracker.ts        decideNeedsRun, latestExecutions; needsRun, recordExecution removed
    M runner.ts         gate in executeFiles; runFile via executeFiles; checkFilesStatus batched; executeSingleFile removed
    M types.ts          ExecutionRecord added; RecordExecutionData, FileInput.checksum removed
    M index.ts          export decideNeedsRun, ExecutionRecord
src/core/change/
    M history.ts        decideNeedsRunFile, latestFileExecutions; needsRunFile removed
    M executor.ts       runFileBatch decides via findSkippedFiles before createFileRecords
    M types.ts          FileExecutionRecord
    M index.ts          export decideNeedsRunFile, FileExecutionRecord
src/core/
    M index.ts          RecordExecutionData export removed
    M shared/tables.ts  skip_reason doc
tests/core/runner/
    A needs-run-decision.test.ts   every rule in decideNeedsRun
    A prefetch-gate.test.ts        no skip rows, no op row when all skip, constant query count, runFile skip
    M template-dedup.test.ts       rendered-output change runs; unchanged output skips with no rows
    M tracker.test.ts              latestExecutions + decideNeedsRun
tests/core/change/
    A prefetch-gate.test.ts        change path: constant query count, skipped files no rows, op row kept
    M executor-retry.test.ts       skipped files leave no execution rows
tests/integration/
    M runner/tracker-dialects.test.ts    latestExecutions per dialect
    M change/history-dialects.test.ts    latestFileExecutions per dialect
tests/cli/run/
    M build.test.ts                skip-on-rerun comments
tests/sdk/
    M run-build-filtering.test.ts  mock comment
docs/
    M dev/runner.md
    M dev/change.md
    M dev/datamodel.md
    M guide/changes/history.md
    M guide/sql-files/execution.md
    M reference/sdk.md
    M tui.md
    M spec/v1-49-54-cli-field-defects.md
skills/noorm/references/
    M cli.md            file status covers executed files only
.changeset/
    A prefetch-run-gate.md
```


## Outline

```
src/core/runner/tracker.ts
    decideNeedsRun — pure skip/run rules from a latest record (or lookup error) and checksum
    Tracker
        latestExecutions — newest execution row per filepath for the config, one SELECT
src/core/runner/runner.ts
    prepareFiles — render once and hash each file, carrying rendered SQL or the load error
    applyRunGate — one latestExecutions call, decideNeedsRun per file
    skipFile — skipped FileResult with no tracking write
    executeFiles — gate, then operation and pending rows for the run set, then sequential walk
    executeSingleFileWithUpdate — executes pre-rendered SQL, no lookup
    runFile — thin wrapper over executeFiles returning the single FileResult
    checkFilesStatus — batch decision via latestExecutions
    statusCategory — maps a NeedsRunResult to a file status category
src/core/change/history.ts
    decideNeedsRunFile — pure per-file rules for the change path
    ChangeHistory
        latestFileExecutions — boundary plus newest qualifying row per filepath, one change
src/core/change/executor.ts
    findSkippedFiles — latestFileExecutions + decideNeedsRunFile, first occurrence of a repeated filepath wins
    runFileBatch — decide before createFileRecords, pending rows for run set only
```


## Flows

**Build with mixed run set**

1. Runner calls `executeFiles` with N discovered files.
2. `prepareFiles` renders and hashes each file, keeping its SQL.
3. `latestExecutions()` returns the newest row per filepath (one SELECT).
4. `decideNeedsRun` splits the files into a run set and a skip set.
5. `createOperation` inserts one `__noorm_change__` row. `createFileRecords` inserts pending rows for the run set.
6. Each file in discovery order is either skipped (`file:skip`, result pushed) or executed (`file:before`, SQL, `updateFileExecution`, `file:after`).
7. `finalizeOperation` writes the status and combined checksum.

**Build where everything is unchanged**

1. Steps 1–4 above. The run set is empty.
2. Every file emits `file:skip`.
3. `executeFiles` returns `status: 'success'` with no `changeId`. The tracking tables are untouched.

**Change apply**

1. The executor checks the change-level `needsRun` (unchanged).
2. `latestFileExecutions(name, direction)` runs the boundary SELECT and one history SELECT.
3. `decideNeedsRunFile` per file splits the files into a run set and a skip set.
4. `createOperation`, then `createFileRecords` for the run set.
5. Skipped files push a result with no database call. Run-set files execute and update their rows.
6. `finalizeOperation` records the change checksum.


## Risks

- Templates render before the first file executes, so a render side effect (a helper script) now happens for files after a failing one. Accepted: rendering has no database access.
- Rendered SQL for every file is held in memory for the batch. SQL files are small, and builds run in the thousands of files at most.
- Older databases hold `skipped/unchanged` rows. `decideNeedsRun` keeps treating them as covering a skip.


## Change log

### 2026-10-07 — Initial spec

**What changed:** First version.

**Why:** The per-file skip lookup costs two round trips per file.

### 2026-10-07 — runFile preview, dead tracker surface

**What changed:** Criterion 7 now states that `runFile` honors `preview`. It also removes `RecordExecutionData` and `needsRun`'s `excludeOperationId`.

**Why:** Routing `runFile` through `executeFiles` made it honor `preview`. Before, `run.file(path, { preview: true })` executed the SQL. The CP2 review also found the parameter and the type had no callers left.

**Superseded:** `runFile` ignored `preview` and executed the file.

### 2026-10-07 — Remove the per-file lookups, keep duplicate-entry skip

**What changed:** Criteria 1, 7 and 9.1 now remove `Tracker.needsRun` and `ChangeHistory.needsRunFile`. Criterion 9.1 now states that a filepath repeated in one change runs once.

**Why:** After the gate, neither lookup had a caller in `src/`. The CP3 review found that deciding every file up front would run a duplicated manifest entry twice. Before, the second occurrence saw the first one's success row and skipped.

**Superseded:** `needsRun` and `needsRunFile` were kept and delegated to the pure functions.

### 2026-10-07 — Correction: criterion 10 baseline

**What changed:** Criterion 10 now requires no new type errors or test failures against the loop base `bc3ace00`, instead of a clean pass.

**Why:** `bun run typecheck:tests` reports 323 errors at `bc3ace00` and at the delivered HEAD, none in a file this work touched. `tests/cli` keeps one failure that predates the work: `cli: components/TextInput > rendering > should draw the cursor, placeholder and suggestion exactly as upstream does`.

**Superseded:** Criterion 10 required all four commands to pass outright.


## Implementation log

### shipped — 2026-10-07

Built across 7 iterations of /autopilot. Commits (chronological):

- `1695a0e8` — CP-1 pure `decideNeedsRun`, batched `Tracker.latestExecutions`
- `adbdba89` — CP-2 runner gate, `runFile` via `executeFiles`, batched `checkFilesStatus`
- `3c00902e` — CP-3 change-path prefetch, per-file lookups removed
- `405b9418` — docs: SDK reference, changeset
- `89848b70` — audit fixes: docs, spec, changeset

**Out-of-scope work performed during this build:**

- `checkFilesStatus` looked up absolute paths against relative rows, so the TUI re-run prompt never fired. Fixed in CP-2 because the batched rewrite touched the same lookup.

**Unforeseens — surprises that emerged during implementation:**

- `runFile` ignored `preview` and executed SQL. Routing through `executeFiles` fixed it, and criterion 7 was amended.
- Deciding change files up front would run a path repeated through `.txt` manifests twice. Repeats now skip, and criterion 9.1 was amended.
- `Tracker.needsRun` and `ChangeHistory.needsRunFile` lost every caller and were removed.

**Deferred items still open:**

- none. `Tracker.needsRunByName` was dead before this build and is out of scope.

**Squashed into one commit on `perf-prefetch-gate` and rebased onto `next` (2026-10-07).** The per-iteration SHAs above are historical and unreachable from any branch. The rebase merged this work with the statement-watcher cancel feature in `executeFiles`.
