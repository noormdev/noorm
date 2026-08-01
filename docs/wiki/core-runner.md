---
type: Domain
description: SQL file execution with checksum dedup and Eta templating
---

# core-runner

## What it does

- Executes `.sql` and `.sql.tmpl` files against a Kysely connection ([`src/core/runner/runner.ts`](../../src/core/runner/runner.ts)), tracking each run in `__noorm_change__`/`__noorm_executions__` via `Tracker` ([`src/core/runner/tracker.ts`](../../src/core/runner/tracker.ts)) so unchanged files are skipped on the next run.
- Renders `.sql.tmpl` files through an Eta-based engine ([`src/core/template/engine.ts`](../../src/core/template/engine.ts)) with auto-loaded data side-cars, inherited `$helpers` files, and built-in helpers (`quote`, `escape`, `include`, `json`, `now`, `uuid`).
- Exposes five execution modes — `runBuild`, `runFile`, `runDir`, `runFiles`, `preview` — plus `checkFilesStatus` for pre-execution status categorization ([`src/core/runner/runner.ts`](../../src/core/runner/runner.ts)).

## Artifacts

- [`src/core/runner/runner.ts`](../../src/core/runner/runner.ts) — `runBuild`/`runFile`/`runDir`/`runFiles`/`preview`/`checkFilesStatus`/`discoverFiles`/`executeFiles`; the first six form the policy-gated entrypoint set every SDK/TUI/CLI caller funnels through — `discoverFiles` and `executeFiles` are not policy-gated.
- [`src/core/runner/tracker.ts`](../../src/core/runner/tracker.ts) — `Tracker` class: `needsRun`, `needsRunByName`, `createOperation`, `recordExecution`, `createFileRecords`, `updateFileExecution`, `finalizeOperation`, `skipRemainingFiles`, `priorSuccessfulExecutions`.
- [`src/core/runner/checksum.ts`](../../src/core/runner/checksum.ts) — `computeChecksum`, `computeChecksumFromContent`, `computeCombinedChecksum` (SHA-256).
- [`src/core/runner/mssql-batches.ts`](../../src/core/runner/mssql-batches.ts) — `splitMssqlBatches` (splits on line-only `GO`), `executeSqlBody` (dialect dispatch: mssql splits on `GO`, sqlite splits on statement boundaries, postgres/mysql execute the body whole).
- [`src/core/runner/sqlite-statements.ts`](../../src/core/runner/sqlite-statements.ts) — `splitSqliteStatements`, a boundary scanner (not a SQL parser) that tracks string/identifier quoting, comments, and `BEGIN`/`CASE`…`END` trigger bodies to find real statement boundaries.
- [`src/core/runner/types.ts`](../../src/core/runner/types.ts) — `RunOptions`, `RunContext`, `FileResult`, `BatchResult`, `NeedsRunResult`, `FileInput`, `ExecuteFilesOptions`, `FilesStatusResult`, and `DEFAULT_RUN_OPTIONS`.
- [`src/core/runner/index.ts`](../../src/core/runner/index.ts) — public export surface for the domain.
- [`src/core/template/engine.ts`](../../src/core/template/engine.ts) — `processFile`, `processFiles`, `renderTemplate`, `isTemplate`; owns the configured `Eta` instance (custom `{% %}` tags, `$` varName, `autoEscape: false`) and the `-- {% %}` directive-line stripping convention.
- [`src/core/template/context.ts`](../../src/core/template/context.ts) — `buildContext` assembles the `$` template context (helpers, auto-loaded data files, config, secrets, `env`, built-ins); `MissingSecretError` and the `$.secrets` proxy that throws on an unresolved key instead of stringifying `undefined`.
- [`src/core/template/helpers.ts`](../../src/core/template/helpers.ts) — `findHelperFiles`/`loadHelpers` walk from a template's directory up to `projectRoot`, merging `$helpers.{ts,js,mjs}` files root-to-leaf (child overrides parent).
- [`src/core/template/loaders/`](../../src/core/template/loaders) — per-extension data loaders: `json5.ts`, `yaml.ts`, `csv.ts` (lazy-imported), `js.ts` (dynamic import, `Bun.build()` bundling path for compiled binaries), `sql.ts`, `dt.ts` (`.dt`/`.dtz`, not `.dtzx`). `loaders/index.ts` registers extensions and marks `.js`/`.mjs`/`.ts` as `isExecutableExtension`.
- [`src/core/template/utils.ts`](../../src/core/template/utils.ts) — `toContextKey` (filename → camelCase), `sqlEscape`, `sqlQuote` (throws `UndefinedSqlValueError` on `undefined`), `isWithinRoot` (segment-aware path containment), `generateUuid`, `isoNow`.
- [`src/core/template/types.ts`](../../src/core/template/types.ts) — `TemplateContext`, `BuiltInHelpers`, `RenderOptions`, `ProcessResult`, `Loader`/`LoaderRegistry`, `DATA_EXTENSIONS`, `TEMPLATE_EXTENSION` (`.tmpl`), `HELPER_FILENAME` (`$helpers`), `HELPER_EXTENSIONS`.

## CLI code

- [`src/cli/run/index.ts`](../../src/cli/run/index.ts) — registers the `run` command group with subcommands `build`, `dir`, `exec`, `file`, `files`, `inspect`, `preview`.
- [`src/cli/run/build.ts`](../../src/cli/run/build.ts) — `run build`; runs `ctx.noorm.run.build`, reports `unmatchedInclude`/`unmatchedExclude` warnings and dry-run tmp/ output.
- [`src/cli/run/dir.ts`](../../src/cli/run/dir.ts) — `run dir <path>`; validates the directory exists, reports `EXIT.USAGE` (not success) when zero SQL files are found.
- [`src/cli/run/exec.ts`](../../src/cli/run/exec.ts) — `run exec <path>`; accepts a directory (delegates to `discoverFiles`) or a glob pattern (expanded via `Bun.Glob` when available, else Node's `fs/promises.glob`).
- [`src/cli/run/file.ts`](../../src/cli/run/file.ts) — `run file <path>`; executes a single file via `ctx.noorm.run.file`.
- [`src/cli/run/files.ts`](../../src/cli/run/files.ts) — `run files --paths <a,b,...>`; comma-separated file list via `ctx.noorm.run.files`.
- [`src/cli/run/inspect.ts`](../../src/cli/run/inspect.ts) — `run inspect <path>`; builds the template `$` context without rendering, categorizes entries into data files/helpers/builtins, reports helper load errors and secret counts.
- [`src/cli/run/preview.ts`](../../src/cli/run/preview.ts) — `run preview <path>`; renders a `.sql.tmpl` and writes raw SQL to stdout (or `--json`), without executing.
- [`src/cli/run/_render-secrets.ts`](../../src/cli/run/_render-secrets.ts) — `resolveRenderSecrets` shared by `preview`/`inspect`: probes the vault tier with retry disabled so an offline render degrades to local-only secrets (`vaultProbeFailed`) instead of hanging.

## Docs

- [`docs/dev/runner.md`](../dev/runner.md) — runner design notes.
- [`docs/dev/template.md`](../dev/template.md) — template engine design notes.
- [`docs/cli/run.md`](../cli/run.md) — `noorm run` subcommand reference.
- [`docs/guide/sql-files/execution.md`](../guide/sql-files/execution.md) — how execution/change-detection works for end users.
- [`docs/guide/sql-files/organization.md`](../guide/sql-files/organization.md) — file/directory ordering conventions.
- [`docs/guide/sql-files/templates.md`](../guide/sql-files/templates.md) — `.sql.tmpl` authoring guide.

## Coupling

- **core-change**: `ChangeTracker` ([`src/core/change/tracker.ts`](../../src/core/change/tracker.ts)) extends `Tracker`, giving it constructor-compatible checksum tracking — but core-change does not call the core runner's `executeFiles` or depend on its `ExecuteFilesOptions` contract. [`src/core/change/executor.ts`](../../src/core/change/executor.ts) defines its own private, same-named `executeFiles` function with an unrelated signature (`ChangeContext`/`Change`/`ChangeFile[]`/`direction`/`checksum`/`force`/`history`/`startTime`), and the need-to-run check for change execution is a separate `needsRun` implementation on `ChangeHistory` ([`src/core/change/history.ts`](../../src/core/change/history.ts)), not the inherited `Tracker.needsRun`.
- **core-policy**: every exported entrypoint (`runBuild`/`runFile`/`runDir`/`runFiles`/`preview`/`checkFilesStatus`) gates through `assertPolicy` from [`src/core/policy/index.ts`](../../src/core/policy/index.ts) against the `run:build`/`run:file`/`run:dir` permissions (matrix: viewer deny, operator confirm, admin allow). Adding a new run entrypoint or changing the permission matrix touches both domains.
- **sdk**: [`src/sdk/namespaces/run.ts`](../../src/sdk/namespaces/run.ts) (`RunNamespace`) wraps 6 of the 8 exported runner functions (`discoverFiles`, `preview`, `runFile`, `runFiles`, `runDir`, `runBuild`) and builds `RunContext` (secrets, dialect, identity, access) for every call; `checkFilesStatus` has no `RunNamespace` wrapper and is called directly by the TUI (`RunDirScreen.tsx`, `RunFileScreen.tsx`), bypassing the SDK layer. [`src/sdk/namespaces/templates.ts`](../../src/sdk/namespaces/templates.ts) wraps the template engine for `ctx.noorm.templates`.
- **tui**: `src/tui/screens/run/*.tsx` (`RunBuildScreen`, `RunDirScreen`, `RunExecScreen`, `RunFileScreen`, `RunInspectScreen`) and [`src/tui/utils/run-context.ts`](../../src/tui/utils/run-context.ts) consume the same core runner/template functions as the CLI and SDK.
- **core-state**: emits `build:start`/`build:complete`, `run:file`/`run:dir`/`run:files`, `file:before`/`file:after`/`file:skip`/`file:dry-run`, `template:render`/`template:load`/`template:helpers`, and `error` events, typed in the shared observer at [`src/core/observer.ts`](../../src/core/observer.ts) (a core-state artifact).
- **core-identity**: `formatIdentity` ([`src/core/identity/resolver.ts`](../../src/core/identity/resolver.ts)) stamps `executedBy` on every tracked operation.
- **sdk**: [`src/core/template/loaders/dt.ts`](../../src/core/template/loaders/dt.ts) reads `.dt`/`.dtz` files via `DtReader` from [`src/core/dt/reader.ts`](../../src/core/dt/reader.ts) (the DT binary format lives in the sdk domain).

## Conventions worth knowing

- Checksums are computed from *rendered* content for `.sql.tmpl` files, not raw file bytes — `executeSingleFileWithUpdate` recomputes the checksum after rendering and overwrites the pending row's raw-file checksum, because comparing raw bytes made every template re-execute on every build ([`tests/core/runner/template-dedup.test.ts`](../../tests/core/runner/template-dedup.test.ts)).
- `executeFiles` inserts a `pending` execution row for every file in a batch upfront (before any file runs), so `Tracker.needsRun` must exclude the running operation's own id (`excludeOperationId`) or every file reads as "new" forever.
- Dry-run output writes rendered SQL — including every resolved secret in plaintext — to `<projectRoot>/tmp/`, mirroring the source path and stripping `.tmpl`; files and any created directories are written owner-only (`mode: 0o600`/`0o700`), and `tmp/` is not gitignored by `noorm init`.
- `run preview`/`run inspect` reuse the `run:file` permission cell rather than a dedicated permission — both resolve every secret tier into plaintext and can execute `$helpers`/side-car scripts even though nothing is written to the database.
- Data-file auto-loading in `buildContext` skips `.js`/`.mjs`/`.ts` side-cars unless the template source textually references the resulting context key (`$.key` or `$['key']`) — otherwise `preview`/`inspect`/`--dry-run` would execute arbitrary code with no way for the user to know.
- `include()` and the `$helpers` directory walk both enforce project-root containment via `isWithinRoot` (segment-aware, not a bare `startsWith`), so a sibling directory like `<root>-evil` cannot be traversed into.
- `$.secrets` is a `Proxy` that throws `MissingSecretError` on an unresolved key instead of resolving to `undefined` — `sqlQuote(undefined)` also throws `UndefinedSqlValueError` rather than stringifying to the literal text `undefined`.
- MSSQL batch splitting (`splitMssqlBatches`) and SQLite statement splitting (`splitSqliteStatements`) are the only two dialects requiring file-content splitting before execution; postgres and mysql receive the full file body via `sql.raw(...)`.
