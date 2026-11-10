# SQL pipelines

## Goal

Provide named operational SQL workflows against one resolved database, with fresh execution, explicit transaction boundaries, and independent history. Operators and applications invoke the same contract through the CLI, SDK and TUI.

## Non-goals

- Cross-database execution, ETL or network loaders, automatic database import, scheduling, retries, resume, checksum-based skipping, undo, and request-key idempotency.
- New MCP surfaces, interactive pipeline authoring, caller identity model, retention scheduler, arbitrary progress transport, domain rowset language, or caller-owned transaction boundary.
- A general SQL parser, a sandbox for trusted template helpers, or a guarantee that hidden and nontransactional effects roll back. Application SQL owns business idempotency.

## Success criteria

- [x] A valid named workflow is prepared in full and runs fresh on each invocation. Linear declarations execute serially; valid dependency graphs respect dependencies and bounded concurrency. Invalid definitions, inputs, paths, template rendering and recognizable managed transaction controls fail before workflow SQL; arbitrary SQL syntax and runtime errors are execution failures.
- [x] `pipeline`, `step` and `none` honor the pinned-session and failure contracts below on PostgreSQL, MySQL, SQLite and MSSQL. Interruption stops scheduling without claiming unsupported cancellation. A managed step that ends or replaces noorm's transaction is caught at runtime and never recorded as committed or rolled back.
- [x] Dedicated pipeline history survives workflow rollback, captures all intended declarations and their dependencies, and distinguishes execution from transaction outcomes. Existing generic history and its execution gates remain independent.
- [x] Optional protected admission is atomic for the resolved config and slug, reports busy without creating history on collision, and retains ownership while workflow activity may still be running. Administrator recovery is documented for each dialect.
- [x] CLI and SDK enforce existing policy, resolve and validate the same structured input contract, and expose config-scoped results without publishing raw input or rendered SQL by default. Identifier spelling remains exact across database collations, before history limits and during ownership checks.
- [x] The behavioral checks in the checkpoints cover real dialect behavior and actual CLI and SDK entry points, including migration, failure, uncertainty, contention and regression cases.
- [x] CLI execution uses `noorm pipeline run <slug>` without a bare-slug alias. Safe pipeline names, including `history`, `show`, and `run`, work through CLI execution/history and the SDK. Group and generic run help remain offline without loading a manifest; slug-specific help retains generated input details.
- [x] Home `[p] Pipelines` discovers definitions, reviews steps/dependencies, preserves typed input presence through explicit Save/Cancel/Reset, confirms the captured target and exposes run, dry run and scoped history.
- [x] Pipeline operations retain their exact caller connection through context construction, execution and bookkeeping despite unmount, config change or shutdown. Managed release also awaits physical destruction after the final lease; disposal failure stays nonzero. Memory SQLite retains its handle except for fatal invalidation. Timeout/force never claims clean completion.
- [x] Actual terminal interaction proves typed inputs, dry-run nonexecution, SQL effects, independent history and truthful failure/stop behavior without exposing input, SQL or active keys.
- [x] Returning from step details or metadata preserves the highlighted item and visible list position in review, execution results and history. Selection uses stable item keys, remains scoped to the current pipeline/run/configuration, and resets safely for a different dataset or a removed row.

## Approach

Use pipeline-specific orchestration and history over existing templates and dialect-aware SQL execution primitives; see the [SQL pipelines design](../design/sql-pipelines.md).

## Change tree

Paths are intended implementation targets; equivalent splits or renames are allowed without changing the success contract. `A` denotes a proposed new file and `M` an existing file to update.

```
src/cli/index.ts                                      M
src/cli/pipeline/index.ts                             A
src/cli/pipeline/input.ts                             A
src/cli/pipeline/run.ts                               A
src/cli/pipeline/history.ts                           A
src/cli/pipeline/show.ts                              A
src/core/pipeline/definition.ts                       A
src/core/pipeline/input.ts                            A
src/core/pipeline/prepare.ts                          A
src/core/pipeline/history.ts                          A
src/core/pipeline/context.ts                          A
src/core/pipeline/errors.ts                           A
src/core/pipeline/parse.ts                            A
src/core/pipeline/exact-identifier.ts                  A
src/core/pipeline/admission.ts                        A
src/core/pipeline/executor.ts                         A
src/core/pipeline/scheduler.ts                        A
src/core/pipeline/types.ts                            A
src/core/settings/types.ts                            M
src/core/settings/schema.ts                           M
src/core/settings/defaults.ts                         M
src/core/settings/manager.ts                          M
src/core/template/context.ts                          M
src/core/template/types.ts                            M
src/core/runner/context.ts                            A
src/core/shared/tables.ts                             M
src/core/version/types.ts                             M
src/core/version/schema/index.ts                      M
src/core/version/schema/migrations/v3.ts              A
src/core/transfer/planner.ts                          M
src/core/teardown/operations.ts                       M
src/sdk/noorm-ops.ts                                  M
src/sdk/namespaces/index.ts                           M
src/sdk/namespaces/pipelines.ts                       A
src/sdk/index.ts                                      M
src/tui/types.ts                                      M
src/tui/screens.tsx                                   M
src/tui/screens/home.tsx                              M
src/tui/screens/pipeline/index.ts                     A
src/tui/screens/pipeline/PipelineListScreen.tsx        A
src/tui/screens/pipeline/PipelineRunScreen.tsx         A
src/tui/screens/pipeline/PipelineHistoryScreen.tsx     A
src/tui/screens/pipeline/PipelineHistoryDetailScreen.tsx A
src/tui/screens/pipeline/PipelineInputEditor.tsx       A
src/tui/hooks/usePipelineOperations.ts                A
src/tui/utils/run-context.ts                          M
src/tui/providers/ConnectionProvider.tsx              M
src/tui/components/lists/SearchableList.tsx            M
src/core/connection/manager.ts                        M
src/core/lifecycle/manager.ts                         M
src/tui/shutdown.tsx                                  M
src/cli/ui.ts                                        M
src/cli/sql/repl.ts                                  M
tests/cli/screens/pipeline/inputs.test.tsx            A
tests/cli/screens/pipeline/operations.test.tsx        A
tests/cli/screens/pipeline/screens.test.tsx           A
tests/core/pipeline/definition.test.ts                A
tests/core/pipeline/input.test.ts                     A
tests/core/pipeline/prepare.test.ts                   A
tests/core/pipeline/history.test.ts                   A
tests/core/pipeline/admission.test.ts                 A
tests/core/pipeline/executor.test.ts                  A
tests/core/pipeline/scheduler.test.ts                 A
tests/core/pipeline/context.test.ts                   A
tests/core/pipeline/errors.test.ts                    A
tests/core/pipeline/parse.test.ts                     A
tests/core/settings/manager.test.ts                   M
tests/core/settings/env-override.test.ts              M
tests/core/template/context.test.ts                    M
tests/cli/pipeline/input.test.ts                      A
tests/cli/pipeline/commands.test.ts                   A
tests/cli/pipeline/failure.test.ts                    A
tests/cli/citty-help.test.ts                          M
tests/cli/json-envelope.test.ts                       M
tests/cli/exit-codes.test.ts                          M
tests/sdk/pipelines.test.ts                           A
tests/sdk/noorm-ops.test.ts                           M
tests/sdk/dts-surface.test.ts                         M
tests/sdk/bundle-smoke.test.ts                        M
tests/integration/pipeline/storage-admission.test.ts  A
tests/integration/pipeline/config-scope.test.ts       A
tests/integration/pipeline/step-identity.test.ts      A
tests/integration/pipeline/boundaries.test.ts         A
tests/integration/pipeline/graph-settlement.test.ts   A
tests/integration/pipeline/caller-parity.test.ts      A
tests/integration/version/schema.test.ts              M
tests/integration/version/schema-v3.test.ts           A
docs/cli/pipeline.md                                  A
docs/cli/flags.md                                     M
docs/headless.md                                      M
docs/dev/settings.md                                  M
docs/dev/template.md                                  M
docs/dev/sdk.md                                       M
docs/reference/sdk.md                                 M
docs/guide/sql-files/execution.md                     M
docs/tui.md                                          M
docs/guide/sql-pipelines.md                           A
docs/guide/pipeline-terminal.md                       A
docs/.vitepress/config.mts                           M
docs/datamodel/data/pipelines/pipeline_run.md         M
docs/datamodel/data/pipelines/pipeline_step.md        M
docs/datamodel/flows/pipeline-execution/Prepare-Pipeline.md M
docs/datamodel/flows/pipeline-execution/Reserve-Run.md M
docs/datamodel/flows/pipeline-execution/Execute-Workflow.md M
docs/datamodel/flows/pipeline-execution/Finalize-Run.md M
docs/datamodel/flows/pipeline-history/Read-Pipeline-History.md M
docs/datamodel/stores/pipeline-definitions.md         M
docs/datamodel/stores/prepared-invocations.md         M
docs/datamodel/stores/active-runs.md                  M
docs/datamodel/stores/single-run-guard.md             M
docs/datamodel/stores/execution-outcomes.md           M
docs/datamodel/externals/Caller.md                     M
docs/datamodel/schema.html                            M
.changeset/sql-pipelines.md                           A
```

## Outline

```
src/cli/index.ts — register pipeline command lazily
src/cli/pipeline/index.ts — dispatch run and history commands
src/cli/pipeline/input.ts — generate flags, help and prompts
src/cli/pipeline/run.ts — invoke and present runs and dry runs
src/cli/pipeline/history.ts — present bounded scoped history
src/cli/pipeline/show.ts — present one scoped run
src/core/pipeline/definition.ts — validate manifests, paths and graphs
src/core/pipeline/input.ts — resolve and validate typed inputs
src/core/pipeline/prepare.ts — authorize and render immutable step snapshots
src/core/pipeline/history.ts — persist intent and outcomes; query scoped history
src/core/pipeline/context.ts — migrate, check abort, then build the pipeline context
src/core/pipeline/errors.ts — define coded errors, definition rules and class-only causes
src/core/pipeline/parse.ts — validate run IDs and history limits
src/core/pipeline/exact-identifier.ts — preserve exact scope under dialect collations
src/core/pipeline/admission.ts — claim and safely release protected ownership
src/core/pipeline/executor.ts — execute pinned SQL boundaries and record outcomes
src/core/pipeline/scheduler.ts — schedule dependencies and settle in-flight work
src/core/pipeline/types.ts — define plans, results and errors
src/core/settings/types.ts — declare pipeline path setting
src/core/settings/schema.ts — validate pipeline path setting
src/core/settings/defaults.ts — supply default pipeline path
src/core/settings/manager.ts — resolve path with existing overlays
src/core/template/context.ts — reserve invocation input for steps and includes
src/core/template/types.ts — type pipeline template context
src/core/runner/context.ts — build a run context with resolved secrets
src/core/shared/tables.ts — declare pipeline table names and records
src/core/version/types.ts — advance schema version
src/core/version/schema/index.ts — register migration and bootstrap
src/core/version/schema/migrations/v3.ts — create pipeline tables and indexes
src/core/transfer/planner.ts — exclude pipeline metadata
src/core/teardown/operations.ts — exclude pipeline metadata
src/sdk/noorm-ops.ts — expose lazy pipelines namespace
src/sdk/namespaces/index.ts — export pipelines namespace
src/sdk/namespaces/pipelines.ts — provide run and scoped history operations
src/sdk/index.ts — export public pipeline API and types
src/tui/types.ts — declare pipeline routes, section and slug/run-ID parameters
src/tui/screens.tsx — register pipeline screens and breadcrumb labels
src/tui/screens/home.tsx — expose the pipeline section with the free p shortcut
src/tui/screens/pipeline/index.ts — export native operator screens
src/tui/screens/pipeline/PipelineListScreen.tsx — discover definitions and expose history lookup
src/tui/screens/pipeline/PipelineRunScreen.tsx — review metadata, collect overrides, confirm and present results
src/tui/screens/pipeline/PipelineHistoryScreen.tsx — select a slug and list scoped bounded runs
src/tui/screens/pipeline/PipelineHistoryDetailScreen.tsx — inspect a run and ordered safe step evidence
src/tui/screens/pipeline/PipelineInputEditor.tsx — save typed presence without changing generic Form semantics
src/tui/hooks/usePipelineOperations.ts — retain captured invocation ownership through core settlement and shutdown
src/tui/utils/run-context.ts — keep the cancel message; buildRunContext moved to core
src/tui/providers/ConnectionProvider.tsx — retain, retire and fatally invalidate exact connection records
src/tui/components/lists/SearchableList.tsx — forward optional native row rendering without changing search labels
src/core/connection/manager.ts — preserve shutdown state while deferring automatic close to managed releasing
src/core/lifecycle/manager.ts — retain completing-before-release cleanup ownership
src/tui/shutdown.tsx — distinguish completed phases from timeout/forced abandonment
src/cli/ui.ts — preserve the shutdown event's exit code
src/cli/sql/repl.ts — preserve the shared TUI shutdown exit code
tests/cli/screens/pipeline/inputs.test.tsx — verify presence, reset, choices and strict parsing
tests/cli/screens/pipeline/operations.test.tsx — verify retained ownership, isolation and settlement
tests/cli/screens/pipeline/screens.test.tsx — verify policy, outcomes, history and keyboard transitions
docs/tui.md — document the operator workflow and shortcuts
docs/guide/sql-pipelines.md — link authoring to native operator execution
docs/guide/pipeline-terminal.md — teach definition review, explicit input editing, execution and scoped history
docs/.vitepress/config.mts — expose the operator guide in public navigation
tests/core/pipeline/definition.test.ts — validate definitions, paths and graphs
tests/core/pipeline/input.test.ts — validate input definitions and values
tests/core/pipeline/prepare.test.ts — exercise policy, rendering and preflight
tests/core/pipeline/history.test.ts — exercise provenance, outcomes and scoped queries
tests/core/pipeline/admission.test.ts — exercise claim, collision and safe release
tests/core/pipeline/executor.test.ts — exercise pinned boundaries and uncertainty
tests/core/pipeline/scheduler.test.ts — exercise graph order, limits and settlement
tests/core/pipeline/context.test.ts — verify an abort during migration skips secrets
tests/core/pipeline/errors.test.ts — verify error codes, rules and withheld cause text
tests/core/pipeline/parse.test.ts — verify run ID and history limit parsing
tests/core/settings/manager.test.ts — verify pipeline setting persistence
tests/core/settings/env-override.test.ts — verify nonpersistent environment overlays
tests/core/template/context.test.ts — verify reserved input and include precedence
tests/cli/pipeline/input.test.ts — exercise flags, help, prompts and cancellation
tests/cli/pipeline/commands.test.ts — exercise run, history and show commands
tests/cli/pipeline/failure.test.ts — verify exit-code mapping and SIGINT handling
tests/cli/citty-help.test.ts — verify help and parser integration
tests/cli/json-envelope.test.ts — verify sanitized JSON envelopes
tests/cli/exit-codes.test.ts — verify pipeline exit codes
tests/sdk/pipelines.test.ts — exercise namespace, policy and scoped reads
tests/sdk/noorm-ops.test.ts — verify lazy namespace construction
tests/sdk/dts-surface.test.ts — verify public declarations
tests/sdk/bundle-smoke.test.ts — verify bundled public exports
tests/integration/pipeline/storage-admission.test.ts — prove schema, audit and admission across dialects
tests/integration/pipeline/config-scope.test.ts — prove exact reads and ownership before limits
tests/integration/pipeline/step-identity.test.ts — prove portable exact labels and metadata text
tests/integration/pipeline/boundaries.test.ts — prove SQL boundaries, sessions and failures across dialects
tests/integration/pipeline/graph-settlement.test.ts — prove graph concurrency and settlement across dialects
tests/integration/pipeline/caller-parity.test.ts — exercise real CLI and SDK workflows
tests/integration/version/schema.test.ts — cover bootstrap, upgrade and reset
tests/integration/version/schema-v3.test.ts — prove v3 retries finish after partial runs
docs/cli/pipeline.md — document commands, dynamic flags and outputs
docs/cli/flags.md — document pipeline flag placement
docs/headless.md — document operation and dialect-specific guarded recovery
docs/dev/settings.md — document pipeline path and overlays
docs/dev/template.md — document reserved input and rendering
docs/dev/sdk.md — document SDK pipeline usage
docs/reference/sdk.md — specify public methods and result types
docs/guide/sql-files/execution.md — explain authoring and transaction limitations
docs/datamodel/data/pipelines/pipeline_run.md — model audit and active-key ownership
docs/datamodel/data/pipelines/pipeline_step.md — model dependency snapshots
docs/datamodel/flows/pipeline-execution/Prepare-Pipeline.md — model input resolution and preparation
docs/datamodel/flows/pipeline-execution/Reserve-Run.md — model admission and dependency snapshots
docs/datamodel/flows/pipeline-execution/Execute-Workflow.md — model graph execution
docs/datamodel/flows/pipeline-execution/Finalize-Run.md — model outcomes and safe release
docs/datamodel/flows/pipeline-history/Read-Pipeline-History.md — model scoped sanitized reads
docs/datamodel/stores/pipeline-definitions.md — model manifest input declarations
docs/datamodel/stores/prepared-invocations.md — model transient input context
docs/datamodel/stores/active-runs.md — model active graph and input context
docs/datamodel/stores/single-run-guard.md — model run-owned protection
docs/datamodel/stores/execution-outcomes.md — model outcome and ownership handoff
docs/datamodel/externals/Caller.md — model structured CLI and SDK invocation
docs/datamodel/schema.html — export aligned model
.changeset/sql-pipelines.md — describe the CLI, SDK and TUI release
```

## Flows

**Flow: resolve and prepare**

1. CLI or SDK selects a slug and one resolved config. Core enforces `pipeline:run`, including for dry runs.
2. Core validates the manifest, contained paths, graph, inputs and dialect restrictions. CLI gathers only eligible missing required values; SDK does not prompt.
3. Core injects the resolved input into every template and include, renders every declaration once and retains those bytes. Dry run reports the plan without admission, history or workflow SQL.

**Flow: admission and execution**

1. Core inserts a pending run and every intended step in one bookkeeping transaction. A protected run claims its active key in that transaction; a collision rolls it back and returns busy.
2. The scheduler executes eligible declarations on pinned sessions under the selected boundary and concurrency limit. On failure or interruption it stops scheduling and waits for in-flight activity to settle.
3. Core persists truthful outcomes outside workflow boundaries, releases an owned guard only when activity is settled, and returns ordered step results with primary and secondary errors.

**Flow: history and recovery**

1. A connected, authorized caller requests history or a run in the resolved config. Core returns sanitized runs and declaration-ordered steps; a run from another config is not found.
2. An administrator investigating an abandoned protected run inspects and terminates or waits for its database activity before comparing its run ID and key in a bookkeeping transaction. The administrator marks unresolved outcomes truthfully and clears the key only after activity has settled.

**Flow: terminal operation**

1. Home opens Pipelines. The operator selects a definition or looks up history by slug/run ID without requiring a local definition.
2. The operator reviews steps and explicitly saves typed overrides. Reset removes an override; defaults and required presence remain core-owned.
3. Run/dry run validates the complete input object and applies existing policy/protected confirmation to the captured target. A changed target requires fresh review.
4. The operation retains its exact connection, registers lifecycle work, builds captured context and invokes core. Stop, navigation and quit request abort without discarding the promise.
5. Core settles started work and bookkeeping before connection release. A mounted screen shows safe evidence; detached screens receive no stale results. Timeout/force remains incomplete and nonzero.

## Checkpoints

| # | Checkpoint | Files/areas | Agent | Est. files | Verifies |
|---|---|---|---|---:|---|
| 1 | Definitions and settings | `src/core/pipeline/`, `src/core/settings/`, corresponding core tests | atomic-implementer (mode: feature) | ~6 | Validate manifests, graphs, contained paths and settings overlays independently of execution. |
| 2 | Input resolution and template preparation | `src/core/pipeline/`, `src/core/template/`, corresponding core tests | atomic-implementer (mode: feature) | ~6 | Depends on 1. Validate typed inputs and defaults, reserved context, includes, rendering and preflight policy without workflow SQL. |
| 3 | Schema v3 and internal metadata | `src/core/shared/tables.ts`, `src/core/version/`, transfer and teardown exclusions, schema tests | atomic-implementer (mode: feature) | ~8 | Fresh bootstrap, v2 upgrade, reset, names, constraints and exclusions on all dialects; independent of 1–2. |
| 4 | History and scoped queries | `src/core/pipeline/`, history tests | atomic-implementer (mode: feature) | ~4 | Depends on 1 and 3. Persist independent intent and outcomes, preserve provenance and privacy, and validate bounded, ordered config-scoped reads. |
| 5 | Protected admission and safe release | `src/core/pipeline/`, admission tests | atomic-implementer (mode: feature) | ~4 | Depends on 4. Verify atomic pending admission, contention without rows, ownership comparison and activity-settled release. |
| 6 | Pinned boundary executor | `src/core/pipeline/`, boundary execution tests | atomic-implementer (mode: feature) | ~5 | Depends on 2 and 4–5. Exercise pinned transaction and session boundaries, managed-control checks, persistence, rollback and uncertain outcomes for serial execution. |
| 7 | Dependency scheduler | `src/core/pipeline/`, scheduler tests | atomic-implementer (mode: feature) | ~4 | Depends on 6. Verify stable graph ordering, pool and concurrency limits, global stop, in-flight settling, skips and interruption. |
| 8 | Public SDK integration | `src/sdk/`, `tests/sdk/` | atomic-implementer (mode: feature) | ~6 | Depends on 7 and 17. Public exports, connected context, policy, typed input, outcomes and scoped reads. |
| 9 | CLI input and help | `src/cli/pipeline/`, `tests/cli/` | atomic-implementer (mode: feature) | ~4 | Depends on 2. Dynamic flag parsing and collision checks, offline help, prompt modes, precedence and cancellation before admission. |
| 10 | CLI invocation and history | `src/cli/index.ts`, `src/cli/pipeline/`, `tests/cli/` | atomic-implementer (mode: feature) | ~5 | Depends on 8–9. Wire run, dry run, history and show to actual operations; verify policy, sanitized output and exit codes. |
| 11 | Dialect storage and admission acceptance | `tests/integration/pipeline/storage-admission.test.ts`, `tests/integration/version/schema.test.ts` | atomic-implementer (mode: feature) | ~2 | Depends on 3–6. On all four dialects verify upgrade, bootstrap, reset, constraints, null-key uniqueness, protected contention and no collision rows; verify exclusions, generic-history independence, durable audit after rollback and audit failure handling. Transfer exclusions apply to existing supported transfer dialects; SQLite retains its existing unsupported-transfer boundary. |
| 12 | Dialect SQL boundaries and failures | `tests/integration/pipeline/boundaries.test.ts` | atomic-implementer (mode: feature) | ~1 | Depends on 6, 11 and 17. On all four dialects prove transactional marker outcomes, pinned sessions, managed-control recognition, rollback and commit uncertainty, error preservation and SQLite finite-timeout behavior. |
| 13 | Dialect graph concurrency and settlement | `tests/integration/pipeline/graph-settlement.test.ts` | atomic-implementer (mode: feature) | ~1 | Depends on 7 and 12. On all four dialects prove bounded branching, pipeline and SQLite serialization, global stop, in-flight settlement, skips, abort behavior and activity-aware guard retention. |
| 14 | Actual caller parity | `tests/integration/pipeline/caller-parity.test.ts`, `tests/cli/`, `tests/sdk/` | atomic-implementer (mode: feature) | ~4 | Depends on 8, 10 and 11–13. Run actual CLI and SDK workflows, including repeated runs, config scope, policy, failures and privacy. |
| 15 | Operational documentation and recovery | `docs/cli/`, `docs/headless.md`, `docs/dev/`, `docs/reference/`, `docs/guide/`, `.changeset/` | atomic-implementer (mode: feature) | ~8 | Depends on 8–10. Document final API, authoring, limitations and executable dialect-specific administrator recovery; check examples against actual APIs. |
| 16 | Data model alignment | `docs/datamodel/` | atomic-implementer (mode: feature) | ~14 | Depends on 3–7. Align history entities, dependency fields, flow examples and exported model with implemented behavior without presenting examples as runtime proof. |
| 17 | Owned workflow connection lifecycle | `src/core/pipeline/`, SDK context construction, pipeline execution fixtures | atomic-implementer (mode: feature) | ~8 | Isolate workflow pools from admission/history/caller queries; preserve graph caps and session affinity; dispose owned pools before returning, retain uncertain guards, and fail closed before releasing an unrecoverable shared in-memory SQLite handle. Prove busy admission cannot commit an earlier failed workflow. |
| 18 | Explicit run command cutover | `src/cli/pipeline/`, `src/cli/index.ts` if needed, `src/core/pipeline/definition.ts`, CLI/core/SDK and caller-parity tests, affected public docs and wiki | atomic-implementer (mode: feature) | ~12 | Register static run/history/show subcommands; consume a required slug positional under run, reject the bare form, remove command-name restrictions from core, preserve offline help/input/privacy/exit contracts, and prove command-named workflows work through actual CLI and SDK entry points. |
| 19 | Retained terminal operation lifecycle | TUI provider/hook/shutdown, `src/core/connection/manager.ts`, lifecycle cleanup, CLI TUI entry points, operation regressions | atomic-implementer (mode: feature) | ~9 | Retain exact connections through context/core/bookkeeping; remove early global teardown in favor of existing releasing cleanup; track provider physical destruction through settlement even after final lease release; preserve nonzero cleanup status; prove actual app:shutdown dispatch waits for completion; retire safely on config change/unmount and memory fatal invalidation; never falsely complete on timeout/force. |
| 20 | Native pipeline operator screens | `src/tui/screens/pipeline/`, routes/registry/Home, shared input coercion and CLI caller, input/screen regressions | atomic-implementer (mode: feature) | ~12 | Use 19's lifetime contract; discover/review definitions, edit exact input presence, confirm/run/dry-run and inspect truthful scoped history, including removed definitions, with native focus and safe errors. Preserve highlighted stable keys and scroll position across detail overlays; do not reset the reader to the first row or carry selection into an unrelated dataset. |
| 21 | Terminal acceptance and documentation | `tests/cli/screens/pipeline/`, `docs/tui.md`, pipeline CLI guide, design/spec, `.changeset/sql-pipelines.md`, affected wiki | atomic-implementer (mode: feature) | ~7 | Exercise the actual compiled TUI with real database effects, typed input edges, dry run, policy/failure/history and delayed stop; publish the operator contract without changing the database model. |

Estimated file counts are planning sketches, not acceptance criteria or limits on scope.

### Definitions and preparation

| Area | Required behavior and behavioral checks |
|---|---|
| Selection | `paths.pipelines` defaults to `./db/pipelines`, resolves from project root and follows existing settings and environment overlay rules. Editing the `sql` and `changes` paths keeps `paths.pipelines`. An unknown slug fails with `PIPELINE_NOT_FOUND`. Select one safe slug segment and its exact `pipeline.yml`; CLI command names impose no slug restrictions, including `history`, `show`, and `run`. Reject absolute paths, traversal and symlink escapes; each referenced existing relative step file must remain inside its selected folder and end in `.sql` or `.sql.tmpl`. Distinct step IDs may refer to the same file and execute independently. |
| Manifest | Accept only `description`, `transaction`, `concurrency`, `singleRun`, `inputs` and nonempty `steps`; reject unknown keys at each declared level. Transaction is `pipeline`, `step` or `none` (default `step`); concurrency is a positive integer (default 4); singleRun is boolean (default false); inputs defaults to an empty map. Each flat step has unique nonempty `id`, `sql` and optional `needs`. |
| Dependencies | No `needs` keys means linear declaration order, serially. If any step declares `needs`, every step declares an array, including `[]` on roots. Reject mixed modes, duplicate IDs or dependencies, unknown or self dependencies and cycles. Among eligible nodes choose lowest declaration number first. `step_no` is one-based declaration identity, not execution order. |
| Input declarations | Each lowerCamelCase input name begins with a letter and contains only letters and digits. It declares `type`, nonempty `description`, optional `required` (default false), `default` and `choices`. Types are `string`, finite `number`, safe `integer`, `boolean`, `object` and `array`. Objects and arrays are JSON values without nested schema declarations. Choices are scalar values matching the declared scalar type. Validate definitions, defaults and choices when loading the manifest. Required plus default is valid and the default satisfies it. |
| Input values | Accept plain JSON-compatible data only; reject nonfinite numbers, cycles, functions, class instances and prototype-polluting keys at any depth. Reject undeclared top-level input keys. Optional missing values remain absent, not null or empty. Explicit false, zero and empty string are values. SDK values must already have the declared JSON type. |
| Precedence and prompts | CLI `--input` accepts a JSON object. Explicit generated flags override its properties; defaults fill remaining gaps. Validate explicit values rather than prompting over invalid input. Prompt only for missing required values when stdin and stdout are TTYs, not CI, JSON, `--yes`/`NOORM_YES`, or agent channel. Choices use select, booleans confirm, other types text with shared validation; object and array text is JSON. In other modes report all missing required values. Cancellation occurs before admission, history and SQL. |
| Flags | Generate kebab-case flags from input names. Reject collisions with each other and all root and leaf built-ins, aliases and help, including `slug`, `input`, `config`, `cwd`, `json`, `yes`, `force` and `dry-run`. String values remain literal; parse numbers, integers and booleans strictly, and object/array values as JSON. Boolean flags accept explicit `--flag=true` and `--flag=false`. |
| Rendering | Bind validated invocation input as `$.input` with final reserved precedence in every step and include, even when a neighboring input file or helper uses that name. Pipeline `$.quote` emits a string literal whose meaning does not depend on session modes, and never queries or changes them: PostgreSQL `U&'...'` with every code point as `\XXXX` or `\+XXXXXX`, which fails closed when `standard_conforming_strings` is off; MySQL `_utf8mb4 X'<hex>'`; MSSQL `N'...'`, with a `\` before a line break doubled so T-SQL line continuation keeps it; SQLite a standard `'...'` literal. Non-string values use the shared `sqlQuote`. Pipeline `$.escape` throws `PipelineEscapeError`, which preparation reports as an invalid definition with rule `escape-unavailable`: no escaping inside an author-written quote is correct under both MySQL backslash modes, and a step can change the mode. Nonpipeline rendering remains unchanged. Missing property access fails preparation; authors guard optional properties with membership checks. Existing neighboring CSV, JSON and YAML loaders remain available; there is no automatic DB import. Render each declaration exactly once before workflow SQL and execute those bytes, so rendering cannot depend on earlier workflow mutations. Template errors must not echo secret input. |
| Preflight and policy | Reject malformed YAML, missing files, invalid paths, definitions, values, graph, templates and recognizable managed transaction controls before workflow SQL. Arbitrary SQL syntax and runtime errors are execution failures; preflight does not parse or validate arbitrary SQL. Core enforces `pipeline:run` policy, identity, channel and confirmation for both run and dry run. Dry run performs preparation but writes no pipeline history, claims no guard and executes no workflow SQL; trusted template helpers can have side effects. Interpolation is not parameter binding; use existing `$.quote` for SQL literals. |

### Execution and transaction boundaries

| Mode | Connection and observable failure behavior |
|---|---|
| `pipeline` | One pinned transaction spans all steps, including a graph, serialized at concurrency 1. On a confirmed rollback, successful earlier step executions have `rolled_back` outcomes. |
| `step` | Each step uses its own transaction. Eligible graph branches may execute on separate pinned connections. Confirmed earlier commits survive a later failed step. |
| `none` | No workflow transaction is added. Linear execution pins one session; graph steps use separate pinned sessions. A failure may have effects that cannot be proven. |

Graph `step` and `none` concurrency is `max(1, min(manifest concurrency, config.pool.max ?? 10))`; 10 is the existing driver pool default when unset. Linear execution, pipeline transactions and all SQLite executions use concurrency 1. On first failure or interruption, stop scheduling globally, allow already-running SQL and transaction activity to settle, and mark unstarted steps skipped. `AbortSignal` stops future scheduling; it does not promise server-side SQL cancellation. Never release protection merely because a client stopped waiting.

Workflow SQL uses an invocation-owned connection pool separate from the caller's pool used for admission/history. Size it to the resolved execution concurrency (minimum zero idle connections); there are no bookkeeping or unrelated application acquisitions in that pool. Stop dispatch before a failed lease can be reused, await started jobs, and dispose the entire owned pool before returning. This avoids relying on unsupported native per-lease discard APIs in the installed Kysely drivers. The extra connection setup per invocation is an intentional ownership cost; do not create one pool per step or shut down the caller's network/file-database pool.

SQLite `:memory:` is necessarily the existing single handle, not a second empty database. Keep it pinned for workflow execution. Its bounded empty-transaction settlement probe may prove the handle reusable after a lost rollback acknowledgement, without changing the unknown original transaction outcome. If settlement cannot be proven, close/invalidate that handle before releasing its pinned lease and mark the SDK context disconnected. This fatal failure cannot preserve an in-memory database; normal success/failure with confirmed rollback preserves it. File-backed SQLite uses an owned handle. Disposal alone does not prove remote server activity settled: uncertain activity retains its guard and pending intent for administrator recovery. Never allow subsequent bookkeeping admission to commit an earlier workflow's transaction.

An owned-pool opening failure before workflow dispatch has no workflow activity to retain. Persist the admitted failure with `no_effects` and skipped steps, and release its protected key; a connection setup error must not leave every retry busy.

Under `none`, recognized author-controlled transaction or autocommit changes make commit provenance uncertain. Do not label affected steps committed solely because their SQL returned successfully. Preserve earlier independently confirmed autocommits, and use unknown outcomes where commits cannot be established. Successful SQL execution can coexist with an unknown transaction outcome; uncertainty alone is not a partial execution failure. Settle or invalidate the session safely before reuse, including shared in-memory SQLite, without adding a managed workflow transaction. This bounded recognition does not verify transaction effects hidden in routines or dynamic SQL.

Use `executeSqlBody` in `src/core/runner/mssql-batches.ts`, not the generic runner's `Tracker` or applied-state gate. Treat its error string as failure that triggers managed rollback. MySQL bodies retain the existing single-body statement driver limitation; SQLite statements and MSSQL `GO` fragments use the supplied pinned executor. Do not silently downgrade managed mode.

Managed modes reject recognizable direct transaction controls throughout each body, including later statements and `GO` batches, before workflow SQL. The scan is a fail-closed preflight, not the correctness boundary. It masks comments and quoted text with per-dialect lexer rules: backslash escapes apply only to MySQL strings and PostgreSQL `E'...'` strings, and MySQL is scanned under three readings (default, `ANSI_QUOTES` and `NO_BACKSLASH_ESCAPES`) because a step can change `sql_mode`. PostgreSQL, MySQL and SQLite reject applicable `BEGIN`/`START TRANSACTION`, `COMMIT`, `ROLLBACK`, `SAVEPOINT` and `RELEASE SAVEPOINT` at statement starts; PostgreSQL also rejects `END`, `ABORT` and `PREPARE TRANSACTION`, and SQLite also rejects `END` and `RELEASE`. A PostgreSQL `BEGIN ATOMIC` function body is rejected, since its `END` cannot be told from a transaction end. MSSQL rejects `BEGIN [DISTRIBUTED] TRAN[SACTION]`, `COMMIT`, `ROLLBACK`, `SAVE TRAN[SACTION]` and `SET IMPLICIT_TRANSACTIONS` at any token boundary, including without semicolons and inside `IF`, `TRY` and routine bodies, while allowing ordinary `BEGIN ... END` and `BEGIN TRY ... END TRY` blocks. MySQL also rejects direct `CREATE`, `ALTER`, `DROP`, `TRUNCATE`, `RENAME`, `LOCK TABLES`, `UNLOCK TABLES`, `SET autocommit` and `XA` control. Recognition is bounded, not a general parser: it does not inspect dynamic SQL or every implicit-commit form. Authors must avoid hidden commits and nontransactional effects in managed modes. `none` does not impose these restrictions.

After opening each managed transaction, the executor marks it as noorm's, and after each managed step it proves the open transaction is still that one. PostgreSQL compares `pg_current_xact_id()` and keeps a per-run savepoint; MySQL and SQLite release and re-create that savepoint; MSSQL requires `@@TRANCOUNT = 1`, `XACT_STATE() = 1` and an unchanged `CURRENT_TRANSACTION_ID()`. Before a rollback it proves ownership again with `ROLLBACK TO SAVEPOINT`, or on MSSQL an open transaction with the same ID. A step whose check proves the transaction was ended or replaced fails with error code `TRANSACTION_ESCAPED` (phase `execute`) and an `unknown` outcome. A check that itself fails proves nothing: it records `OWNERSHIP_UNVERIFIED` (phase `cleanup`), keeps the outcome `unknown`, and treats activity as unsettled, so the guard is retained unless a SQLite settlement probe proves the session has no open transaction. Both codes are public `PipelineError.code` values in the run result. The checks need PostgreSQL 13 or later and SQL Server 2016 or later; below those versions the marker query fails when the transaction opens, and the run fails in phase `execute` before workflow SQL.

### History, admission and outcomes

| Area | Required behavior and behavioral checks |
|---|---|
| Schema | Schema v3 adds only independent `pipeline_run` and `pipeline_step` tables. Use the model's run fields (`id`, `slug`, `config_name`, `executed_by`, `cli_version`, `created_at`, `manifest_checksum`, `transaction_policy`, `single_run`, `status`, `transaction_outcome`, timestamps, bounded safe error and duration), plus nullable `active_key VARCHAR(64)`. Steps retain `pipeline_run_id`, `step_no`, `name`, `filepath`, `checksum`, status, transaction outcome, timestamps, error, skip reason and duration; add `needs TEXT` containing a JSON array of prerequisite declaration numbers. Linear mode stores its normalized predecessor and graph mode maps labels to numbers. Use composite PK `(pipeline_run_id, step_no)`, FK to run with delete cascade and unique `(pipeline_run_id, name)`. Use `noorm` schema on PostgreSQL/MSSQL and `__noorm_*__` names on SQLite/MySQL. Preserve the existing six metadata tables and generic history. The v3 migration checks each table, index and the MySQL/MSSQL `name_key` column before creating it, so a retry after a partial run completes. The move is one way: an older CLI or TUI connecting to a v3 database fails with `VersionMismatchError`; an older SDK ignores the pipeline tables except that `vault.copy` to a v3 destination throws `VersionMismatchError`. The CLI and TUI migrate on connect, for a caller that can write and outside a dry run (`docs/spec/config-access-roles.md`, Enforcement 5c). The SDK migrates on `pipelines.run` without `dryRun`. `pipelines.history`, `pipelines.getRun` and the TUI pipeline history never create or migrate tables. |
| Provenance | Generate an independent run ID per admitted invocation. Record manifest and rendered checksums as provenance, never applied state or a skip decision. Do not store raw input or rendered SQL. No `change_type:pipeline`, shared change IDs, `execution_id`, generic history writes or history-based execution gating. |
| Admission | In one bookkeeping transaction insert the pending run and all intended steps. Protected runs set `active_key` to the full SHA-256 of an unambiguous JSON array `[config_name, slug]`; unprotected runs use null. A unique index permits multiple nulls, using a filtered `WHERE active_key IS NOT NULL` unique index on MSSQL. Concurrent protected invocations of the same key yield one owner and busy for the other; rollback the collision without a run or step row. Pending counts as active. Different keys and unprotected runs may overlap. A manifest-required guard cannot be disabled by a caller; this is not a tool-wide lock. |
| Persistence | Create intent before workflow transactions. Buffer outcomes while any workflow boundary is active and flush resolved outcomes atomically in a separate bookkeeping transaction after activity quiesces, before reusing that pool/session. In particular, SQLite must not have an auxiliary bookkeeping writer competing with workflow activity. Reads may lag execution; do not promise live per-statement durable progress. A required history persistence failure cannot produce clean success. |
| Release and recovery | Compare both run ID and active key before clearing ownership, and only after all workflow SQL and transaction activity has settled, including audit failure cleanup. Unknown commit acknowledgement alone is not proof of ongoing SQL; retain the key when activity itself is uncertain. No TTL, lease, automatic steal or force-unlock API. Document administrator inspection of the correct database and run, dialect-specific session/activity inspection and termination or waiting, and a transactional compare of run ID/key that marks unresolved run outcome unknown and pending steps interrupted or skipped truthfully before clearing the key. Never delete active protected rows. |
| States | Run status: `pending`, `running`, `success`, `failed`, `partial`, `interrupted`, `unknown`. Step status: `pending`, `running`, `success`, `failed`, `skipped`, `interrupted`, `unknown`. Transaction outcome: `pending`, `committed`, `rolled_back`, `partial`, `no_effects`, `unknown`; skipped steps also use `not_started`. Unattempted steps have null timestamps and zero duration. Record execution success separately from later rollback. Unmanaged failure with unprovable effects is `unknown`, not `no_effects` or `partial` without evidence. Confirmed earlier commits can make a workflow partial while its failing step remains unknown. Lost commit acknowledgement and failed rollback must not be presented as confirmed outcomes. |
| Errors and reads | Preserve the primary execution error and secondary rollback, audit and cleanup errors in structured results; persist only bounded safe error text. All reads are scoped to the resolved config. Slug history defaults to 20 runs, accepts only integer limits from 1 through 100 inclusive, rejects invalid limits, and orders by generated run ID descending; run steps are declaration ordered. Run IDs must be positive safe integers; a run ID from another config returns null. Queries never expose input or rendered SQL. Administrators may delete inactive runs, cascading to their steps. |

Step labels preserve their exact spelling, including case, trailing spaces and Unicode, within the portable metadata width of 255 UTF-16 code units. Declared relative SQL paths fit 500 UTF-16 code units. Both must be well-formed Unicode without U+0000, which PostgreSQL text cannot store. Enforce these storage bounds during definition validation, not after admission. Native metadata text must preserve Unicode. MySQL and MSSQL may use a database-generated binary `name_key` to enforce exact per-run label uniqueness; it is an index implementation detail, not a new step identity or a public result field. The composite position PK and logical uniqueness of `(pipeline_run_id, name)` remain unchanged.

### Public interfaces

| Surface | Contract |
|---|---|
| SDK | A connected `ctx.noorm.pipelines` provides `run(slug, { input, dryRun, signal })`, `history(slug, { limit })` and `getRun(runId)`. It never prompts and accepts no caller-owned transaction. `run` checks `pipeline:run` policy and then builds its context through the shared `buildPipelineContext`, which calls `prepareTrackingSchema` with the caller's channel, config and `dryRun`, and then rejects an aborted signal before reading secrets. `prepareTrackingSchema` creates or migrates the tracking tables for a caller that can write, outside a dry run. A dry run creates no tracking tables and does not migrate older ones. Only the TUI passes its signal to the builder; an SDK abort is seen by the executor after admission and records an interrupted run. `history` and `getRun` are gated by `explore` on the agent channel, as change history is. `history` validates its limit and `getRun` its run ID, then reads without writing. On a database with no tracking tables `history` returns `[]` and `getRun` returns `null`. On tables that need a migration both throw an error that names the current and the required schema version. Preflight, authorization and busy errors throw; busy throws the exported `PipelineBusyError`, and the other coded classes and their codes stay internal; admitted execution returns a structured result even on workflow failure, with run ID, status, transaction outcome, ordered step timing/status/outcomes and primary/secondary errors. Do not promise arbitrary domain results or affected-row statistics unsupported by the shared executor. |
| CLI | `noorm pipeline run <slug> [flags]`, `noorm pipeline history <slug> [--limit N]` and `noorm pipeline show <run-id>`. There is no bare-slug execution alias. Support `--input`, dynamic flags, `--dry-run`, `--json`, `--config` and existing `--yes` semantics, with flags after the command. `pipeline --help` and `pipeline run --help` list static commands or the slug positional without loading manifests, secrets or a database. `pipeline run <slug> --help` reads only the selected definition offline and displays descriptions, types, required/default/choices without rendering, history or secret loading. Use the existing citty parser and JSON envelope conventions. |
| Exit and privacy | Exit 0 for success, dry run or help; 2 for invalid definition, input or invocation; 1 for failure, busy or unknown without confirmed partial committed work; 3 for confirmed partial committed work. Preflight failures are classified by the internal `code` on `PipelineCodedError`, never by message text: `PIPELINE_INVALID_DEFINITION`, `PIPELINE_INVALID_INPUT` and `PIPELINE_NOT_FOUND` (unknown slug) exit 2; `PIPELINE_POLICY_BLOCKED`, `PIPELINE_CONFIRMATION_REQUIRED`, a `ProtectedConfigError` and `PIPELINE_BUSY` exit 1. The code is not printed. A `PipelineDefinitionError` carries a required fixed `rule`, and the CLI prints `Invalid pipeline definition (<rule>)` without values. At the `unreadable-path`, `yaml` and `step-prepare` sites, `classOnlyCause` keeps only the cause's class name, never its text; `escape-unavailable` carries the `PipelineEscapeError` itself, whose text is fixed. `pipeline show` reports not found only when the run is absent; other failures exit 1. A second SIGINT during `pipeline run` exits 130 without waiting for settlement. Outputs, including dry run and errors, must not disclose raw input or rendered SQL by default. |
| TUI | `noorm ui`, Home `[p] Pipelines`, and `pipeline`, `pipeline/run`, `pipeline/history`, `pipeline/history/detail` routes. Route parameters contain only slug/run ID, never input or SQL. Call core directly, not a subprocess or additional SDK context. Browse definitions independently of connection readiness; execution/history use the selected config. |

### Terminal behavior

| Area | Required behavior and behavioral checks |
|---|---|
| Discovery/review | Resolve configured project paths. Missing roots are empty; invalid/escaping definitions cannot run and show only their failed definition rule. Show ordered step identity/dependencies, transaction/mode, single-run protection and configured/effective concurrency. Do not render templates while browsing/editing. |
| Input presence | List declaration-ordered inputs with Supplied, Default, Omitted or Unset state and descriptions, not values. Enter opens a one-input existing Form. Save explicitly supplies even empty/false/zero; Cancel preserves the previous state; Reset deletes only the override. Opening a checkbox/choice editor does not supply its draft. Required means present, not Form's nonempty check. |
| Input types | Preserve literal text/spaces/Unicode. Checkbox booleans and positional choice IDs preserve scalar types. Share CLI textual coercion through core utilities for strict numeric/JSON parsing and validation, without coercing SDK values or adding a generic Form touched API. Validate all saved overrides with core before confirmation. |
| Policy/modes | Apply `pipeline:run` and existing protected confirmation to both modes. Reject stale target confirmation. Global dry-run applies to the next invocation; its captured mode is fixed while running. Do not claim tmp-file rendering. Force has no pipeline effect or admission bypass. Cancel before confirmation creates no invocation. |
| Ownership | Retain the exact ready config/DB pair before awaits and capture configuration/settings/identity. Config change, ordinary destruction and provider unmount retire retained connections without early physical destruction. Release idempotently after all context/core/bookkeeping settles. Stale owners cannot invalidate replacements. A retained-connection disposal failure preserves the original run ID, outcomes and primary/secondary evidence; report cleanup failure separately and retain a nonzero shutdown outcome rather than replacing the result or swallowing failure. |
| Global teardown | Factory connections, including workflow pools, remain globally tracked. Preserve the early shutdown-state notification but remove its independent `closeAll()` path; existing managed releasing cleanup owns automatic destruction after completing. All production event emitters already use that lifecycle; CLI/SDK explicit disconnect remains unchanged. Bare notification emission is not a shutdown API. Prove actual shutdown dispatch preserves a real connection through completing and closes it during releasing. No factory ownership opt-out or second connection manager. |
| Memory/shutdown | Reuse original memory SQLite; fatal invalidation immediately destroys that exact handle without waiting for its own retention. Register stopping/completing before async preparation; unmount requests stop, not removal of the waiter. Shared completing timeout may advance to releasing before settlement; show incomplete/nonzero, never rollback/cancellation proof or synthetic guard/history cleanup. No new core lifecycle API. |
| Stop/results | Prevent duplicate UI submission. Stop future scheduling and remain busy until settlement, without promising server-side cancellation or zero admission when abort races core preparation. Show spinner/elapsed time, not fake live progress. Separate execution status from transaction outcome; partial/unknown is not clean success. Display only safe phase/step evidence, never arbitrary thrown/stored messages, input, SQL or active keys. |
| History/focus | Default 20, newest-first, limits 1–100 and positive safe run IDs. Scope not-found and reads to config; discard stale async results. Allow slug/run-ID lookup without local definitions and show declaration-ordered steps. Pending reads show loading, not false empty/not-found results. Counted list entries occupy one bounded terminal row even for maximum-length labels/dependencies, with full text available in detail. Preserve native Form/list/confirmation Escape/focus behavior, scroll long lists and keep actions reachable at ordinary terminal sizes. |

### Behavioral verification

- Test manifest and input validation for every declaration and value domain, defaults and choices, unknown keys, collisions, repeated paths, symlink escape, dependency errors, stable eligible ordering, all prompt modes, cancellation and secret-safe error output. Include includes and a conflicting adjacent `input.json` to prove reserved input precedence without changing nonpipeline rendering.
- Exercise actual settings/environment overlays and ensure environment values are not persisted. Test policy denial, confirmation and agent restrictions through core, SDK and CLI, including dry run.
- Verify history's default limit of 20, accepted limits 1 and 100, rejection of nonintegers and out-of-range limits, positive safe run IDs, descending generated run ID ordering and config scope across reads.
- On all four real dialects, prove v2-to-v3 upgrade, fresh bootstrap, reset, null-key uniqueness and protected collision; verify teardown and truncation exclude both tables and generic histories remain unaffected in both directions. Verify both tables are excluded from existing supported transfers; SQLite transfer remains unsupported and must not be enabled by this feature. Verify history survives workflow rollback and a failed audit never reports clean success.
- For each dialect use a transactional table: step A inserts a marker, step B inserts then fails, step C would insert another marker. Assert pipeline rollback removes A and B, step mode retains A but rolls back B, and none reports only observed effects; C is absent. MySQL uses single-statement steps and a setup routine that inserts and signals without committing; MSSQL includes multiple `GO` fragments inside the failed step. Assert persisted status, outcome and declaration order.
- Exercise branching with controlled in-flight steps, max concurrency and pool bounds; assert pipeline and SQLite serialization, global stop after first failure, settling of running branches, unstarted skips, and no false cancellation after abort. Show pinned session-local state for linear `none` and managed boundaries. Use a finite timeout for real SQLite success and rollback with durable history.
- Test recognizable controls in later statements, dialect aliases and comment/quoted-text boundaries, while permitting MSSQL block forms. On each dialect, prove that a step which ends the managed transaction records `TRANSACTION_ESCAPED` and that a failing ownership probe records `OWNERSHIP_UNVERIFIED`, both with `unknown` outcomes. Prove MySQL `$.quote` literals keep their value when a step changes `sql_mode`, PostgreSQL literals fail closed when `standard_conforming_strings` is off, and `$.escape` fails preparation. Prove a partial v3 migration completes on retry. Simulate failed rollback, audit failure, lost commit acknowledgement and uncertain ongoing activity; assert primary and secondary errors, unknown outcomes and retained guard as appropriate. Test run ID/key compare, different keys, pending contention and no rows on busy.
- Invoke identical workflows repeatedly, including repeated file declarations and a failed prior run, to prove fresh execution and distinct audit without checksum gating. Spawn the actual CLI for success, invalid input/definition, dry run, failure, partial and help; assert output, selected config, exit code and absence of secrets. Exercise SDK run and config-scoped history/getRun against a real database. Recovery instructions must provide executable dialect-aware administrator queries and guarded updates, with a warning to establish that sessions have stopped first.
- Exercise the compiled TUI in a PTY against a disposable database: discovery/review, explicit empty/false/zero, choices/JSON, Save/Cancel/Reset, missing inputs, dry run without workflow/history writes, SQL success, independent history, rollback/failure, unknown presentation and history after definition removal. Verify delayed stop, config A-to-B retirement, shutdown waiting, timeout/force labeling and memory invalidation with behavioral regressions. Unchanged four-dialect executor acceptance need not be repeated solely for adding a caller.

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Dialect transaction controls or implicit commits escape a managed boundary | High | Fail-closed preflight recognition, runtime ownership proof after each managed step, explicit author constraints and real-dialect transaction checks. |
| Session modes change how an input literal is read | High | Mode-independent `$.quote` per dialect and no pipeline `$.escape`. |
| SQLite bookkeeping blocks a workflow writer | High | Buffer outcomes until workflow activity quiesces; test with a finite timeout. |
| Abandoned or prematurely released protection permits overlap | High | Atomic unique admission, activity-aware release, no automatic expiry and explicit administrator recovery. |
| Commit uncertainty or failed audit is reported as success | Medium | Separate execution and transaction outcomes; preserve unknowns and primary/secondary errors. |
| Inputs or rendered SQL leak through diagnostics | Medium | Reserved context, strict validation, sanitized errors and behavioral privacy checks. |
| Pipeline history changes generic build or change behavior | Medium | Independent tables and gates, internal exclusions and cross-history regression checks. |
| Terminal unmount destroys the caller before bookkeeping settles | High | Retain exact records through settlement; verify navigation, config switch, shutdown and memory invalidation. |
| Form defaults silently supply omitted values or lose empty/false/zero | High | Explicit per-input Save/Reset presence and shared typed validation with keyboard regressions. |

## Change log

### 2026-11-10: Pipeline reads and dry runs leave the tracking tables alone

**What changed:**

- `pipelines.history`, `pipelines.getRun` and the TUI pipeline history create and migrate nothing. No tracking tables gives `[]` or `null`; tables that need a migration give an error that names both schema versions.
- `buildPipelineContext` calls `prepareTrackingSchema` in place of `ensureSchemaVersion`, so `pipelines.run(slug, { dryRun: true })` and a TUI dry run write nothing.
- The CLI and TUI migrate on connect only for a caller that can write, outside a dry run.

**Why:** A read or a preview that creates tables changes a database the caller only asked to look at, and it let a role denied every write create noorm's tables.

**Superseded:** SDK `history` and `getRun` running `ensureSchemaVersion` after validating their arguments, the shared context builder migrating on every call, and the CLI and TUI migrating on connect for every caller.

### 2026-11-09: Runtime ownership, mode-free literals and coded errors

**What changed:**

- Runtime ownership checks after each managed step record `TRANSACTION_ESCAPED` or `OWNERSHIP_UNVERIFIED`. The floors are PostgreSQL 13 and SQL Server 2016.
- The preflight is a fail-closed scan with per-dialect lexer rules, three MySQL readings and MSSQL controls at any token boundary. `BEGIN ATOMIC` stays rejected.
- Pipeline `$.quote` on PostgreSQL emits `U&'...'`, and on MSSQL keeps a `\` before a line break. Pipeline `$.escape` throws `PipelineEscapeError`.
- Schema v3 is idempotent and retryable, and its one-way effect on older clients is stated.
- Preflight errors and CLI exit codes are classified by code, with the failed definition rule named in the CLI and TUI. An unknown slug is `PIPELINE_NOT_FOUND` (exit 2). A second SIGINT exits 130.
- The SDK validates `history`/`getRun` arguments and then runs `ensureSchemaVersion`. The shared context builder migrates and checks for an abort before reading secrets.

**Why:** Live dialect probes showed that no lexer can serve as the correctness boundary for transaction control. They also showed that escaping fixed at render time breaks when a step changes the session mode. Message-text matching misclassified failures, and a partial v3 run failed every retry.

**Superseded:** The preflight scan as the only transaction-control check, the statement-start-only MSSQL scan, backslash escapes in every dialect's masking, `$.escape` and plain PostgreSQL `'...'` literals in pipelines, a v3 migration that could not resume, message-matched exit codes, and SDK pipeline reads that skipped schema migration.

### 2026-11-08 — Native pipeline operator interface

**What changed:** Add native definition review, typed input editing, policy-aware execution/dry run and independent history; retain connections through settlement and make bounded/forced shutdown truthful.

**Why:** The delivered CLI/SDK workflow needs an operator interface consistent with existing terminal screens.

**Superseded:** TUI operation is no longer a non-goal. Interactive authoring and new MCP surfaces remain outside scope.

### 2026-11-07 — Graph workflows, independent admission and structured inputs

**What changed:** Reconciled the implementation contract around dependency graphs, bounded execution, independent pipeline history, atomic optional single-run protection, typed invocation input, SDK and CLI operations, and dialect-aware recovery.

**Why:** The approved workflow and input requirements require a complete, current contract for implementation and review.

**Superseded:** The historical draft specified linear CLI-only execution, a shared config lock, and no structured invocation inputs or public SDK surface.

### 2026-11-07 — Explicit run command

**What changed:** Execution uses `noorm pipeline run <slug>`; `history` and `show` remain sibling commands. Pipeline names are independent of command names in both CLI and SDK.

**Why:** A separate execution verb removes namespace ambiguity instead of imposing CLI-specific naming restrictions on workflows.

**Superseded:** Bare-slug execution and reserved `history`/`show` pipeline names. No alias preserves the ambiguous form.

## Implementation log

### Implemented, unreleased — 2026-11-07

Built across 23 iterations of /subagent-implementation. Commits (chronological):

- `8b4a13bd` — Finalize the implementation plan.
- `6c5a9089` — CP-1 definitions and settings.
- `7eaa42e4` — CP-3 independent schema-v3 history.
- `75a0fca0` — CP-2 immutable invocation input and preparation.
- `d094e965` — CP-4 intent, outcomes and scoped history.
- `d027e2fb` — CP-5 protected admission and safe release.
- `856d315e` — CP-9 dynamic flags, help and prompts.
- `a112542b` — CP-6 pinned transaction boundaries.
- `5becf52f` — CP-7 dependency scheduling and stop precedence.
- `3613793a` — CP-11 native storage and admission acceptance.
- `7cfe88f0` — Dialect-aware pipeline literals.
- `bb146641` — Define safe workflow-session ownership.
- `4c36196d` — CP-17 invocation-owned sessions and truthful uncertainty.
- `9d10c227` — CP-8 public SDK operations.
- `6241352e` — CP-10 CLI invocation and history.
- `ae361d52` — CP-12 native transaction and acknowledgement failures.
- `d1566904` — CP-13 native graph concurrency and settlement.
- `c6ca72c1` — CP-14 actual caller parity.
- `5795c61c` — Exact identifier scope across native collations.
- `53227221` — Schema-v3 fixture cleanup.
- `617b6d98` — CP-15 authoring, API and recovery documentation.
- `9af1c28e` — CP-16 data model and flows.
- `22184e7c` — Portable exact labels, Unicode metadata and native generated keys.

**Out-of-scope work performed during this build:**

- None.

**Unforeseens — surprises that emerged during implementation:**

- A later bookkeeping transaction could commit an earlier MySQL workflow after failed rollback; invocation-owned pools isolate it, while unrecoverable shared in-memory SQLite handles fail closed.
- Lost native MSSQL acknowledgements require distinguishing unknown commit outcome from ongoing activity; pinned-session transaction probes preserve that distinction.
- Native quoting and collation defaults could alter Unicode, backslashes, configuration scope and step-label uniqueness; dialect literals, exact predicates and generated byte keys preserve the intended values and identities.
- Existing reset lists omitted new metadata, and combined test processes leaked global mocks; reset owners were corrected and every test file was executed in a clean process without production workarounds.

**Deferred items still open:**

- None for SQL pipelines; no follow-ups remain open.

**Verification:** Source typecheck, build and lint passed; the complete isolated suite passed 5,622 tests with three skips across 383 files. Actual four-dialect SQL, graph, admission, uncertainty and metadata checks passed, as did packaged SDK, bundled CLI, host-native CLI, human prompts, guarded recovery scripts, documentation build and model validation/export. The cumulative audit passed at `9af1c28e`; the subsequent metadata correction passed fresh code and model reviews.

**Existing repository limits:** Test typechecking retains its 323 baseline diagnostics, with no pipeline diagnostics. Combined-process tests retain pre-existing global-mock contamination; the complete-suite result above uses explicit per-file isolation. Three unrelated historical specs still fail unscoped structural validation; the pipeline spec, config and artifacts validate separately.

### Release-quality pass — 2026-11-07

The requested independent Astra audit exposed CLI boundary and recovery-documentation defects. Correction `332c9f33` preserves successful core execution with unknown transaction provenance while making the CLI exit 1 and emit `success: false`; missing required input names now reach JSON and noninteractive text without supplied values. SQL Server recovery uses Unicode-safe declarations in both batches, and the model describes implemented schema-v3 tracking.

Fresh correction reviews found no issues. Typecheck, build and lint passed; all 383 test files passed in isolated processes: 5,625 tests, three skips, zero failures. The actual packaged CLI passed the same previously failing scenarios. Native `sqlcmd` reproduced the old Unicode lookup failure, rejected wrong keys without mutation, and durably reconciled the correct owner without altering confirmed evidence. Ignatius validation, indexing and export passed, and the regenerated model rendered with its review note.

### Explicit run cutover

Execution now uses `noorm pipeline run <slug>` with static sibling `history` and `show` commands. The bare form is rejected, and command names no longer restrict workflow names in the CLI or SDK. Two-pass Citty selection supports built-in and generated options before the slug without changing final input validation or loading a definition for generic help.

Fresh source and documentation reviews passed. Typecheck, build, lint and 226 targeted tests passed; the complete isolated suite passed 5,631 tests with three skips across 383 files. Actual rebuilt CLI and SDK artifacts executed workflows named `history`, `show`, and `run`, retained scoped history and option-order-independent help, and rejected bare execution without effects. Unknown-outcome exit handling and missing-input privacy remained correct. Published SDK declarations have no diagnostics, and test typechecking retains the existing 323 diagnostics with none in pipelines. The updated usage pages built and rendered; the schema and invocation-agnostic model were unchanged.

### Shell completion isolation

The run command selects a definition only for an actual `pipeline run` invocation because completion imports lazy commands with its own argument layout. A failing-before actual CLI request and regression became green: completion inside or outside a project returns command candidates and a shell directive without reading invalid workflow definitions or writing SQL/history, while generic help and normal execution retain their existing behavior.

### Native pipeline terminal — 2026-11-08

Built across eight iterations of `/subagent-implementation`. Commits (chronological):

- `4aec6494` — CP-19–21 native operation, explicit input editing, scoped history and managed connection ownership.

**Out-of-scope work performed during this build:**

- None.

**Unforeseens — surprises that emerged during implementation:**

- Factory-tracked connections could close before completing work; automatic closure moved to managed releasing, and provider-owned destruction stays tracked even after the final lease.
- Cleanup rejection could erase confirmed execution evidence or reset exit status; separate cleanup reporting preserves the result and sticky nonzero status.
- Long slugs and counted rows could exceed a small terminal; single-row summaries retain full text in scrollable details.
- Native Form display waits and persistent module mocks obscured regressions; consumer-value assertions and restored modules pass together without production workarounds.

**Deferred items still open:**

- None.

**Verification:** Typecheck, lint, source and package builds passed. The complete isolated suite passed 5,703 tests with three skips across 386 files; the three new TUI files also passed together, 69 tests. Actual native terminal interaction proved typed presence, dry-run nonexecution, independent SQL/history, rollback and uncertainty, scoped lookups, maximum-size identifiers, cooperative stop and managed PostgreSQL quit. Native destruction and terminal-height regressions failed before and passed after their corrections. Public SDK declarations have no diagnostics; test typechecking retains 323 unrelated baseline diagnostics with none in pipelines. Documentation built and rendered, and scoped structural checks passed.

**Audit:** The independent Astra final audit passed at `4aec6494` with no findings; source and operator correction reviews also passed.

### Pipeline cursor retention — 2026-11-08

Built across three iterations of `/subagent-implementation`. Commits (chronological):

- `96360c49` — CP-20 preserve step and history-row selection through details, metadata, refresh and lookup cancellation.

**Out-of-scope work performed during this build:**

- None.

**Unforeseens — surprises that emerged during implementation:**

- Router Back state can outlive a return to review; an explicit fresh-invocation default prevents an old result cursor from entering a new run.
- Initial list defaults do not reset a mounted list; source and target identity transitions require a scoped remount.

**Deferred items still open:**

- None.

**Verification:** The five focused source suites passed 98 tests; the compiled screen suite passed 31. The complete isolated suite passed 5,710 tests with three skips across 386 files. Source typecheck, lint, package builds and the rebuilt native Darwin ARM64 CLI passed. Native terminal interaction retained the third review/dry-run step and the second recorded step through repeated inspection, metadata, refresh and lookup cancellation without workflow SQL. Pipeline test types have no diagnostics; the unrelated baseline remains 323. Scoped spec, config and artifact validation and documentation flag lint passed.

**Audit:** The independent final Astra audit passed at `96360c49` with no findings.

### Review fixes: 2026-11-08

Commits (chronological):

- `7065dcc5`: verify transaction ownership after managed steps.
- `b7abdb22`: make input literals independent of session modes.
- `aa516b61`: make schema v3 retryable, keep the pipelines path.
- `44b3130f`: classify errors by code, not message text.
- `739fa132`: migrate tracking tables before pipeline calls.
- `d0067656`: split `runPipeline` into phases.
- `74304c08`: document schema v3, exit codes and quoting.
- `50bee01a`: stop mock and act-env leaks between test files.
- `8ac595f4`, `62dd1397`: final audit findings; index checks after a v3 retry and the abort check before secrets.

**Unforeseens:**

- Live probes found guard bypasses in every dialect's lexer, and executors that inferred outcomes from a `COMMIT` or `ROLLBACK` returning OK after an author had ended the transaction. Runtime ownership proof replaced the scanner as the boundary.
- A PostgreSQL step running `SET standard_conforming_strings = off` made the old `$.quote` injectable, and MSSQL `N'...'` dropped a `\` before a line break.

**Deferred items still open:** 26 follow-ups in `.claude/project/followups/pr-120-review-fixes-f-*.md`.
