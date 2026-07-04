---
type: Domain
---

# core-runner

## What it does

Executes SQL files against a database connection with checksum-based deduplication. Processes `.sql` and `.sql.tmpl` files. Template files are rendered via Eta before execution. Results are tracked in `__noorm_executions__`. Preview mode renders and returns SQL without executing.

The template engine (`src/core/template/`) is co-owned by the runner: runner calls `processFile`/`isTemplate` to render `.sql.tmpl` files before execution.

## CLI code

- `src/core/runner/runner.ts` — `runBuild`, `runFile`, `runDir`, `preview`, `discoverFiles`; core execution loop
- `src/core/runner/tracker.ts` — `Tracker`; records execution results, computes `needsRun`, queries `__noorm_executions__`
- `src/core/runner/checksum.ts` — `computeChecksum`, `computeChecksumFromContent`, `computeCombinedChecksum`; SHA-based change detection
- `src/core/runner/mssql-batches.ts` — `executeSqlBody`; splits MSSQL `GO`-delimited batches before execution
- `src/core/runner/types.ts` — `RunOptions`, `RunContext`, `FileResult`, `BatchResult`, `SkipReason`, etc.
- `src/core/template/engine.ts` — Eta-based `renderTemplate`; called by runner for `.sql.tmpl` files
- `src/core/template/context.ts` — `buildContext`; assembles variables injected into templates
- `src/core/template/helpers.ts` — built-in SQL helpers (`sqlEscape`, `sqlQuote`, `generateUuid`, `isoNow`)
- `src/core/template/loaders/` — data loaders for JSON5, YAML, CSV, JS, SQL side-car files
- `src/core/template/types.ts` — `TemplateContext`, `Loader`, `LoaderRegistry`

## Docs

- `docs/dev/runner.md` — runner internals reference
- `docs/dev/template.md` — template engine internals
- `docs/guide/sql-files/execution.md` — user guide: file execution
- `docs/guide/sql-files/templates.md` — user guide: template syntax
- `docs/guide/sql-files/organization.md` — user guide: file layout conventions

## Coupling

- Runner calls `src/core/template/` (`processFile`, `isTemplate`) — template API changes affect runner's file loop.
- Runner writes to `__noorm_executions__` table defined in `src/core/shared/tables.ts`.
- Change executor (`src/core/change/executor.ts`) calls `runFile` — runner `RunOptions` changes propagate to change execution.
- MSSQL batch splitting (`mssql-batches.ts`) is only invoked for MSSQL dialect; dialect info flows in via `RunContext`.
- CLI commands in `src/cli/run/` call `runBuild`, `runFile`, `runDir`, `preview` — CLI surface reflects `RunOptions` defaults.

## Conventions worth knowing

- `DEFAULT_RUN_OPTIONS` defines timeout, skip-unchanged, and preview-mode defaults.
- `.sql.tmpl` extension triggers template rendering; `.sql` files are executed verbatim.
- `$helpers.ts` file in the SQL directory is loaded as helper functions for templates.
- MSSQL batches split on `GO` token (case-insensitive) per `mssql-batches.ts`.
- Checksum is SHA-256 of file content; combined checksum used for directory-level change detection.
- `SkipReason` enum: `unchanged`, `preview`, `dry-run`.
