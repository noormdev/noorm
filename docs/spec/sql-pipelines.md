# SQL pipelines

> **Historical planning draft, not an implementation contract.** This spec predates the linked operation/pipeline history model and the `(pipeline_run_id, step_no)` step key. The [working design](../design/sql-pipelines.md) records the current discussion, including unresolved SDK and history APIs. Do not implement from the checkpoints below; reconcile this draft after design review.

## Goal

Provide named, manifest-ordered SQL workflows against one resolved database, with fresh execution on every invocation, explicit transaction boundaries, and truthful independent history. Operators can invoke and inspect these workflows through the headless CLI without changing build or migration behavior.

## Non-goals

- Cross-database operations, external data movement, scheduling, DAGs, parallel execution, retries, resume, and automatic compensation.
- Migration-style revert scripts, management commands, or new TUI, MCP, or public SDK command surfaces.
- A new input parameter language or CLI transaction override; existing template context, configuration, environment, secrets, and helpers remain available.
- A general SQL parser, sandbox for trusted template code, or guarantee that arbitrary SQL effects can be rolled back.

## Success criteria

- [ ] A selected valid manifest runs every declared SQL step sequentially against one database, stops at the first failure, and starts from the first step on every invocation, including repeated file declarations.
- [ ] `pipeline`, `step` (default), and `none` have the transactional DML outcomes specified below on PostgreSQL, MySQL, SQLite, and MSSQL; managed transactions never silently degrade to `none`.
- [ ] Independent run and ordered step history survives workflow rollback, accurately distinguishes committed, rolled-back, failed, unattempted, and unknown outcomes, and does not affect build/change histories or execution decisions.
- [ ] CLI and core enforce existing `run:dir` policy; real runs coordinate using the shared config lock, while dry runs prepare and report without workflow SQL, history writes, or an execution lock.
- [ ] Invalid definitions fail before workflow SQL; actual CLI output, exit codes, settings resolution, and documentation expose the contract without disclosing rendered SQL or secrets by default.

## Approach

Implement pipeline-specific orchestration and history over existing template and dialect-aware SQL execution primitives — see [SQL pipelines design](../design/sql-pipelines.md).

## Change tree

```text
src/
├── cli/index.ts ................................ M  (root command registration)
├── cli/pipeline/ ............................... A  (command, output and argument handling)
├── cli/_utils.ts ............................... M  (context plumbing if required)
├── core/pipeline/ .............................. A  (manifest, preparation, execution, history and result types)
├── core/settings/{types,schema,defaults,manager}.ts  M  (pipeline path and overlays)
├── core/shared/tables.ts ....................... M  (internal history names and database types)
├── core/version/types.ts ....................... M  (schema version)
├── core/version/schema/index.ts ................ M  (migration registry/bootstrap/reset)
├── core/version/schema/migrations/v3.ts ........ A  (pipeline history migration)
├── core/transfer/planner.ts .................... M  (internal-table exclusion where needed)
├── core/teardown/operations.ts ................. M  (internal-table exclusion where needed)
└── core/runner/ ................................ M  (shared SQL preparation/execution seams as needed)
tests/
├── core/pipeline/ .............................. A  (definitions, preparation, policy and results)
├── core/settings/ .............................. M  (path defaults and overlays)
├── cli/pipeline/ ............................... A  (command behavior and actual CLI smoke)
└── integration/ ................................ M  (four-dialect execution, history, schema and isolation)
docs/
├── headless.md, cli/run.md ..................... M  (command reference and distinction from runs)
├── dev/settings.md ............................. M  (pipeline path configuration)
└── guide/ ...................................... M  (pipeline authoring and transaction limitations)
.changeset/ ..................................... A  (CLI feature release note)
```

## Outline

```text
src/cli/index.ts
  pipeline command — lazy root registration
src/cli/pipeline/
  pipeline command — arguments, context, output and exit mapping
src/core/pipeline/
  manifest and preparation — selection, validation, path containment and rendered snapshots
  pipeline executor — authorization, locking, transaction boundaries and ordered execution
  pipeline history — run/step persistence and resolved outcomes
  result types — identity, ordered outcomes and errors
src/core/settings/
  path configuration — pipeline default, validation and environment overlays
src/core/shared/tables.ts
  pipeline history tables — dialect-specific names and typed records
src/core/version/
  schema version and migration — fresh bootstrap, upgrade and reset coverage
src/core/transfer/planner.ts and src/core/teardown/operations.ts
  internal-table exclusion — preserve pipeline history as noorm metadata
src/core/runner/
  shared SQL execution — prepare once and execute through the selected session
 tests/core/pipeline/ and tests/core/settings/
  manifest, path, settings and policy behavior — deterministic validation coverage
 tests/cli/pipeline/
  CLI behavior — parsing, output, exit statuses and real command smoke
 tests/integration/
  dialect execution and history — actual transactions, isolation, locking and migration
 docs/headless.md, docs/cli/run.md, docs/dev/settings.md and docs/guide/
  pipeline reference — configuration, authoring, operation and limitations
.changeset/
  CLI release note — pipeline feature
```

## Flows

**Flow: preparation and dry run**

1. Operator invokes `noorm pipeline <slug>` with shared flags after the command; project, config and identity resolve through existing CLI context and settings rules.
2. Core enforces `run:dir`, resolves exactly one pipeline folder, validates the entire manifest and all paths, reads and renders every step, and retains the prepared bytes in declaration order.
3. With `--dry-run`, report the selected ordered steps and policy without executing workflow SQL, acquiring the execution lock, or writing pipeline history. Template helpers are trusted code and may themselves have side effects.

**Flow: real execution**

1. Core acquires the shared config/database lock before creating history; a competing lock prevents execution. Record a distinct run and ordered intended steps before beginning workflow transactions.
2. Execute the prepared steps in manifest order on one pinned workflow session, preserving the selected transaction boundary; turn SQL helper error results into transaction failure. Stop at the first failure.
3. Buffer step outcomes while a workflow transaction is open and persist them after its boundary resolves, including rollback and unattempted outcomes. Finalize history and release the lock in cleanup; preserve the original database error alongside rollback or history errors.
4. Return ordered results, transaction and commit/rollback outcomes, and run identity. A later invocation repeats all declarations from step one, independently of checksums or prior results.

**Flow: interruption or uncertain outcome**

1. An interruption prevents later steps from starting; do not claim that an in-flight statement was cancelled on a dialect without server-side cancellation.
2. A crash may leave pending records. A lost commit acknowledgement is unknown, not a confirmed rollback or success; retain any separately observable errors and return a nonzero outcome when possible.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|---|---|---|---:|---|
| 1 | Define and prepare manifests, paths and settings | `src/core/pipeline/`, `src/core/settings/`, `tests/core/pipeline/`, `tests/core/settings/` | atomic-implementer (mode: feature) | ~8 | The authoring and preparation contract below, including complete preflight, actual settings/env overlays, containment and repeated paths. |
| 2 | Add durable isolated history and migration | `src/core/shared/tables.ts`, `src/core/version/`, `src/core/transfer/planner.ts`, `src/core/teardown/operations.ts`, integration tests | atomic-implementer (mode: feature) | ~8 | Fresh bootstrap, upgrade from current schema and reset; dialect table naming and exclusion; ordered distinct run/step records; build/change isolation and rollback-surviving history. |
| 3 | Implement authorized, locked, pinned execution | `src/core/pipeline/`, `src/core/runner/`, integration tests | atomic-implementer (mode: feature) | ~8 | Four-dialect DML matrix below, error propagation, session affinity, SQLite history without writer deadlock, real lock contention and policy enforcement. |
| 4 | Expose CLI and operational documentation | `src/cli/index.ts`, `src/cli/pipeline/`, CLI tests, `docs/`, `.changeset/` | atomic-implementer (mode: feature) | ~8 | Actual CLI smoke plus JSON/human output, exit statuses, dry run, selected config and documented limitations; no transaction override or force requirement. |

### Authoring, preparation, and access contract

| Area | Required behavior and observable checks |
|---|---|
| Location | `paths.pipelines` defaults to `./db/pipelines`, uses existing settings and environment overlay conventions, and resolves relative to the project root. Select a single slug that is one folder segment, with exactly `pipeline.yml` in that folder. |
| Manifest | Optional `description`, optional `transaction` (`pipeline`, `step`, or `none`; default `step`), and a nonempty ordered `steps` array. Every step has a unique nonempty `id` and relative `sql` path ending in `.sql` or `.sql.tmpl`. Unknown fields are invalid. |
| Paths | Reject traversal, absolute paths, and symlink escapes; all referenced files must resolve inside the selected folder and exist. Different IDs may name the same file and each declaration executes. |
| Preflight | Reject malformed YAML, absent/invalid manifest, duplicate IDs, missing files, unsupported extensions, invalid transaction values, and template preparation errors before any workflow SQL. Prepare every declared file once and execute the prepared bytes, not later file contents. Later templates cannot depend on earlier workflow mutations during rendering. |
| Policy | Enforce existing `run:dir` authorization in the core entry point for direct as well as CLI calls, including viewer denial, operator confirmation and agent-channel rules. Use resolved identity and policy overrides; do not introduce a separate pipeline permission. |
| Lock | Real execution takes the existing config lock before history creation and releases it after transaction resolution and final history persistence, including failures. Test contention against another lock-aware operation and cleanup. Existing unlocked run commands are not serialized by this guarantee. |

### Transaction and managed-SQL contract

| Policy | Boundary and failure outcome for supported transactional SQL |
|---|---|
| `pipeline` | One transaction spans all steps; first failure rolls back changes from all attempted steps. |
| `step` | One transaction per step; completed steps stay committed, the failing step rolls back, and later steps do not start. |
| `none` | No transaction is added by noorm; prior committed work remains and a failing step may leave partial effects. |

All fragments of a managed boundary use its pinned transaction executor. `none` also uses one pinned workflow session so session-local objects survive between steps. Tracking and lock connections, if needed, target the same database; a config alone is not a session pin. MySQL step bodies must follow the existing single-statement execution constraint; MSSQL `GO` batches and SQLite statements compose within their enclosing boundary. The runner's checksum gate and build/change tracker must not determine pipeline execution.

Managed modes reject direct, recognizable transaction-control statements before workflow SQL. PostgreSQL, MySQL and SQLite reject their applicable `BEGIN`/`START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT`, and `RELEASE SAVEPOINT` forms, including SQLite's `RELEASE` form; PostgreSQL additionally rejects `END`, `ABORT`, and `PREPARE TRANSACTION`, and SQLite additionally rejects `END`. MSSQL rejects `BEGIN TRANSACTION`/`BEGIN TRAN`, `COMMIT`, `ROLLBACK`, and `SAVE TRANSACTION`/`SAVE TRAN`, but permits ordinary `BEGIN ... END` and `BEGIN TRY ... END TRY` blocks. MySQL also rejects direct `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `LOCK TABLES`, `UNLOCK TABLES`, `SET autocommit`, and `XA` transaction control, which can escape the managed boundary. Recognition is dialect-aware and covers these forms at statement boundaries throughout a multi-statement body, including later statements and `GO` batches, while accounting for whitespace, comments and quoted text. This bounded recognition is not a general parser and does not inspect dynamic SQL, routine bodies, or every vendor-specific implicit-commit statement. Authors must not hide commits in routines or use nontransactional/implicit-commit effects in managed modes. Unsupported effects are not promised reversible; do not silently switch modes or report universal rollback. `none` does not impose the managed-mode rejection.

### History, results, and verification

| Area | Required behavior and observable checks |
|---|---|
| History | Dedicated internal run and ordered step tables follow `getNoormTables` naming, schema version/migration, typed database, bootstrap, upgrade and reset conventions. Persist intended steps before the workflow boundary; buffer and flush outcomes outside it, avoiding a competing SQLite writer. Store identity, declaration order and step ID/path, content identity if recorded, and truthful status/outcome. A crash may leave pending history. |
| Isolation | Pipeline history is excluded from transfer and teardown like other internal tables; execution neither writes build/change operation or execution history nor changes their checksum decisions. Existing build/change runs do not suppress pipelines and pipeline runs do not suppress them. |
| Result | Report slug, run identity, transaction policy, ordered results, commit/rollback or unknown outcomes and errors; distinguish unattempted, failed, committed and rolled-back work. A persistence failure is failure even if workflow SQL committed. Preserve original SQL failure when rollback or history persistence also fails. JSON and normal output must not expose rendered SQL or secret values by default. |
| Exit | `0` only for success; `2` for invalid invocation/definition; `1` for failure without confirmed partial committed work; `3` for confirmed partial committed work. Unknown commit outcomes remain explicit and nonzero, not claimed as confirmed partial. |
| Four-dialect DML | Against real PostgreSQL, MySQL, SQLite and MSSQL databases, set up a transactional table and deterministic ordered steps: first inserts marker A; failing step inserts marker B then fails; last would insert C. Assert `pipeline` leaves neither A nor B, `step` retains A but not B, and `none` retains committed A and reports any actually committed B truthfully; C is always absent. Use dialect-appropriate transactional SQL; for MySQL use single-statement steps and a setup routine that inserts then signals failure without committing, called as one statement. For MSSQL include multiple `GO` fragments within the failing step and verify the earlier fragment rolls back. Assert persisted history after each outcome. |
| Session and rerun | On each dialect demonstrate session-local state across steps, fresh identical reruns with distinct history, and two IDs referencing one path executing twice in order. Check a failed first attempt reruns from step one and no checksum or build/change record gates it. |
| SQLite | Run real SQLite managed success and rollback cases with a finite timeout and assert completion plus durable step/run history, proving history writes do not deadlock against the workflow writer. |
| Failure and smoke | Exercise malformed manifests, missing/escaping paths, unsupported direct managed statements (including later statements in multi-statement bodies and dialect-specific transaction aliases), template errors, denied/confirmed policy and lock contention with no workflow SQL. Cover PostgreSQL `END`/`ABORT`/`PREPARE TRANSACTION`, SQLite `END`/`RELEASE`, and MySQL autocommit/XA controls as rejected cases; verify ordinary MSSQL `BEGIN ... END` and `BEGIN TRY ... END TRY` blocks remain accepted. Dry-run leaves workflow and pipeline-history data unchanged. Spawn the actual CLI against a real configured database for success, failed execution, invalid manifest and dry run; assert output, ordered steps, selected config and exit codes. These are behavioral assertions, not source/wiring tests. |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dialect transaction behavior or implicit commits differ from expectations | High | Real-database DML matrix on all four dialects; bounded rejection of known direct incompatibilities and explicit author responsibility for hidden or nontransactional effects. |
| SQLite history writes contend with the workflow writer | High | Persist intent before execution and flush buffered outcomes only after each boundary resolves; verify with a finite-time real SQLite test. |
| Commit acknowledgement loss, interruption or history failure is mistaken for success | Medium | Preserve explicit unknown/pending outcomes, original and secondary errors, and return nonzero unless execution and required persistence succeed. |
| Pipelines leak into migration/build lifecycle or internal data transfer | Medium | Separate tables and execution path, naming/exclusion conventions, and behavioral cross-history isolation tests. |
| Unsafe project paths or trusted templates cause unintended access | Medium | Validate containment including symlinks, preflight all declarations, and document that dry run does not sandbox template helpers. |

## Change log

<!-- Populated on first amendment after the spec is approved. Do not log drafting/refinement turns. -->
