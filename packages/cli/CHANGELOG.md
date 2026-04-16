# @noormdev/cli

## 1.0.0-alpha.31

### Minor Changes

- e10b7a4: Add two new CLI commands:

  - `noorm init` — interactive project bootstrap. Creates identity (if missing), project structure, and settings. Requires an interactive TTY.
  - `noorm sql repl` — launches the TUI directly on the SQL Terminal screen. Supports `--config <name>` to switch active config before launching. Requires an interactive TTY.

## 1.0.0-alpha.30

### Patch Changes

- 0951b7e: ## Fixed
  - `fix(ci):` Pin bun to 1.3.11 in release binary workflow — bun 1.3.12 produces binaries that crash on startup (OOM kill, exit 137)

## 1.0.0-alpha.29

### Minor Changes

- 850b2d3: ## Added

  - `feat(cli):` Migrate CLI from meow to citty with structured subcommands, built-in `--help` examples, and `noorm ui` launcher
  - `feat(cli):` Add shell completion via `@bomb.sh/tab`

  ## Fixed

  - `fix(change):` Populate `cli_version` in change history rows
  - `fix(cli):` Suppress `logger.info` inside `fn()` callbacks when `--json` is active
  - `fix(cli):` Restore vault cp dry-run preview and 3-positional CLI surface
  - `fix(cli):` Wire JSON output for change run/revert and unify history JSON path
  - `fix(cli):` Restore human-readable db transfer output

## 1.0.0-alpha.28

### Minor Changes

- 4373083: ## Added
  - `feat(mcp):` Add MCP server for coding agent integration — `noorm mcp serve` starts a stdio JSON-RPC server, `noorm mcp init` generates `.mcp.json` config files
  - `feat(rpc):` Add transport-agnostic RPC command registry with Zod-validated commands: `connect`, `disconnect`, `list_configs`, `overview`, `list`, `detail`, `sql`, `change_history`, `change_run`, `change_ff`, `change_revert`, `run_build`, `run_file`
  - `feat(rpc):` Add SQL protection for read-only enforcement on protected configs using `sql-parser-cst` with keyword fallback

## 1.0.0-alpha.27

## 1.0.0-alpha.26

### Patch Changes

- 66e6fb8: ### Fixed

  - `fix(teardown):` Sort composite types (TVPs) before domain types during teardown to prevent dependency failures on MSSQL, which lacks `DROP TYPE ... CASCADE`

## 1.0.0-alpha.25

## 1.0.0-alpha.24

## 1.0.0-alpha.23

### Patch Changes

- 715cddc: ### Fixed

  - `fix(teardown):` Schema-qualify all DROP statements in teardown to prevent failures when the connection user's default schema differs from `dbo` (MSSQL) or `public` (PostgreSQL)

## 1.0.0-alpha.22

## 1.0.0-alpha.21

## 1.0.0-alpha.20

### Minor Changes

- 88b33ce: ## Added

  - `feat(dt):` DT file modifier — drop, add, or rename columns and filter rows from exported `.dt`/`.dtz`/`.dtzx` files without re-exporting from the source database
  - `feat(cli):` "Modify .dt file" option in the Data Transfer screen with interactive recipe builder, schema preview, and streaming output

- 2955758: ### Added

  - `feat(headless):` Add `run inspect` command — inspect template context (data files, helpers, builtins, config, secrets) without executing, with `--json` support
  - `feat(headless):` Add `run preview` command — render .sql.tmpl files and output raw SQL to stdout, pipeable to files or other tools

  ### Fixed

  - `fix(errors):` Propagate SQL Server TDS diagnostic info (line numbers, error codes, procedure names, severity) through to TUI — errors now show e.g. `[Line 42, Err 207] Invalid column name` instead of just the message text
  - `fix(errors):` Propagate PostgreSQL and MySQL diagnostic info (error codes, SQLSTATE, severity) through to TUI
  - `fix(errors):` Handle Kysely-unpacked `AggregateError` arrays from TDS with multi-line display
  - `fix(template):` Eta `autoTrim` left-trim was eating newlines after interpolation tags, joining SQL lines (e.g. `ENDAS`, `ENDIF NOT EXISTS`) — disabled autoTrim and implemented directive-line stripping for `-- {% %}` convention
  - `fix(db):` Disconnect shared TUI connection before `DROP DATABASE` to prevent ECONNRESET errors
  - `fix(db):` Show friendly "Not Created" notice instead of aggressive ERROR badge when database does not exist
  - `fix(tui):` Show full multi-line SQL errors in all run/change screens instead of truncating to 60 characters

### Patch Changes

- 2328fa2: ### Fixed

  - `fix(headless):` Produce structured JSON error output (`{ success, error }`) when `--json` is set — previously errors were only logged as text, leaving CI pipelines with no parseable output on failure
  - `fix(headless):` Enrich SQL error messages with dialect-aware diagnostics (line numbers, error codes, procedure names, severity) via `getSqlErrorMessage` in all headless command error paths
  - `fix(headless):` Standardize `run build` exit code from `2` to `1` to match the `0`/`1` convention used by all other headless commands
  - `fix(headless):` Replace stale `.sql.eta` file extension references with `.sql.tmpl` across CLI argument parsing, help text, and documentation

  ### Added

  - `feat(headless):` Add `sql` command to the home help commands list
  - `feat(headless):` Document `.sql.tmpl` template file support in `run` help text

- 3ab86b8: ### Fixed

  - `fix(template):` Resolve `$helpers` loading in compiled binaries — bare specifier resolution now uses `Bun.build()` to bundle helper files with all dependencies, fixing `Cannot find package` errors in pnpm projects
  - `fix(inspect):` Show `$helpers` exports in Inspect Template screen — categorization now uses source-based tracking instead of type-guessing, and load errors are surfaced instead of silently swallowed

  ### Added

  - `feat(cli):` Add `dev/test-helpers` diagnostic command for verifying `$helpers` loading from any execution context

## 1.0.0-alpha.19

### Patch Changes

- 18e36b6: ## Fixed
  - `fix(mssql):` Resolve SQL Server build failures caused by Kysely emitting unsupported `LIMIT` and `RETURNING` syntax
  - `fix(mssql):` Add MssqlLimitPlugin to translate `.limit()` to `TOP` for all MSSQL queries
  - `fix(mssql):` Use `OUTPUT inserted.id` instead of `RETURNING` for insert-and-get-id operations
  - `fix(mssql):` Pass dialect from connection through all run screens to runner context
  - `fix(schema):` Make v2 migration fully idempotent — handles partial migration states, orphaned tables, and interrupted runs
  - `fix(schema):` Handle interrupted v1 migrations where tables exist but version record is missing
  - `fix(schema):` Run `ensureSchemaVersion` before identity sync to prevent queries against unmigrated tables
  - `fix(schema):` Move `waitForIdentityToLoad` out of connection factory into schema migration lifecycle
  - `fix(logger):` Preserve Error objects in log redaction filter instead of spreading into empty `{}`
  - `fix(logger):` Surface `.cause` chain in error log messages for wrapped errors
  - `fix(runner):` Handle non-standard error objects from tedious driver including `AggregateError`
  - `fix(runner):` Propagate batch-level errors to TUI when build fails before file execution
  - `fix(runner):` Truncate `skip_reason` to prevent column overflow on MSSQL
  - `fix(tui):` Show relative file paths in failed files list instead of basename only
- 431f9b9: ## Fixed
  - `fix(shutdown):` Force `process.exit()` after graceful shutdown to prevent process hanging from lingering connection pool handles
  - `fix(shutdown):` Remove duplicate `app:exit` emission that caused `unmount()` to fire twice
  - `fix(shutdown):` Clear timeout timer in connection close race to prevent 5-second event loop leak

## 1.0.0-alpha.18

### Minor Changes

- a18bfbe: ### Added

  - `feat(worker-bridge):` Worker thread infrastructure for parallel DT export/import. WorkerBridge class (ObserverRelay subclass), WorkerPool with round-robin dispatch, OrderBuffer for index-ordered reassembly.
  - `feat(workers):` Persistent Connection Worker (Kysely-backed DB operations) and stateless Compute Worker (serialize/deserialize) as standalone entry points.
  - `feat(dt):` Export and import pipelines now run through worker threads — Connection Worker handles DB queries, Compute Pool parallelizes CPU-bound serialization across N cores.
  - `feat(dt):` Three-tier progress events (`loaded`/`processed`/`saved`) for both export and import, enabling granular TUI progress display.
  - `feat(connection):` ConnectionManager tracks WorkerBridge instances alongside direct Kysely connections for coordinated shutdown.
  - `feat(cli):` `noorm -H dev/test-workers` diagnostic command for verifying worker thread infrastructure across execution contexts.
  - `build:` Worker entry points included in `bun build --compile` for single binary support.

## 1.0.0-alpha.17

### Minor Changes

- 2174274: ## Added
  - `feat(cli):` Add `info` command for project and database status display (`noorm -H info`, `noorm -H --json info`)
  - `feat(cli):` Show CLI version, schema/state/settings versions, install/upgrade dates, and DB object stats on Home screen

## 1.0.0-alpha.16

### Patch Changes

- 365f437: ## Connection

  ### Fixed

  - `fix(mssql):` Connection hangs when target database does not exist — now verifies via `sys.databases` on `master` first
  - `fix(mssql):` `ECONNRESET` on MSSQL Server 2022+ due to `encrypt: false` — now defaults to `encrypt: true`
  - `fix(mssql):` Tarn pool silently retries failed connections — enabled `propagateCreateError` for fast failure
  - `fix(connection):` Retry logic retried non-transient errors like `login failed` and `access denied`

## 1.0.0-alpha.15

### Patch Changes

- ef88aeb: ## Schema

  ### Fixed

  - `fix(schema):` MSSQL schema migration fails with `auto_increment` syntax error — use `identity(1,1)` instead
  - `fix(schema):` MSSQL schema migration fails when multiple `timestamp` columns exist — use `datetime2` for MSSQL
  - `fix(schema):` MySQL schema migration fails on `TEXT` columns with default values — use `varchar(2000)` for error messages
  - `fix(schema):` MySQL and MSSQL `DROP INDEX` requires `ON table_name` — made `down()` dialect-aware

## 1.0.0-alpha.14

### Patch Changes

- eb95caf: ## Added
  - `feat(ci):` Automated binary builds on release with install script

## 1.0.0-alpha.13

### Major Changes

- 6753ebd: **BREAKING:** Reorganize flat `NoormOps` into domain-aligned sub-namespaces

  The flat `ctx.noorm.*` API has been replaced with sub-namespaces that mirror the TUI home screen:

  - `ctx.noorm.changes.*` — scaffold, discover, validate, apply, revert, ff, status, pending, history
  - `ctx.noorm.run.*` — discover, preview, file, files, dir, build
  - `ctx.noorm.db.*` — listTables, describeTable, overview, previewTeardown, truncate, teardown, reset
  - `ctx.noorm.lock.*` — acquire, release, status, withLock, forceRelease
  - `ctx.noorm.vault.*` — init, status, set, get, getAll, list, delete, exists, propagate, copy
  - `ctx.noorm.secrets.*` — get
  - `ctx.noorm.templates.*` — render
  - `ctx.noorm.transfer.*` — to, plan
  - `ctx.noorm.dt.*` — exportTable, importFile
  - `ctx.noorm.utils.*` — checksum, testConnection

  **Migration examples:**

  | Before                        | After                           |
  | ----------------------------- | ------------------------------- |
  | `ctx.noorm.build()`           | `ctx.noorm.run.build()`         |
  | `ctx.noorm.fastForward()`     | `ctx.noorm.changes.ff()`        |
  | `ctx.noorm.applyChange(name)` | `ctx.noorm.changes.apply(name)` |
  | `ctx.noorm.listTables()`      | `ctx.noorm.db.listTables()`     |
  | `ctx.noorm.acquireLock()`     | `ctx.noorm.lock.acquire()`      |
  | `ctx.noorm.truncate()`        | `ctx.noorm.db.truncate()`       |
  | `ctx.noorm.runFile(f)`        | `ctx.noorm.run.file(f)`         |
  | `ctx.noorm.transferTo(c)`     | `ctx.noorm.transfer.to(c)`      |

  **New capabilities:** change authoring/scaffolding, dry-run previews, file discovery, vault operations, teardown preview

### Minor Changes

- 6753ebd: Add graceful shutdown screen with phase progress display on exit. Migrate test runner from vitest to bun test. Extract shared CLI hooks and utilities to reduce duplication across screens.
- 6753ebd: Add curl|sh installer and npm binary wrapper for streamlined installation. The published npm package now acts as a thin shim that downloads and executes the platform-specific compiled binary.

### Patch Changes

- 8797eb4: ### Fixed

  - `fix(settings):` NOORM\_\* environment variables now override any settings.yml field (e.g. `NOORM_PATHS_SQL` overrides `paths.sql`)

- 6753ebd: Fix display of created-at timestamps and file sizes in the change list and change run screens.

## 1.0.0-alpha.12

### Patch Changes

- a22973c: ## Fixed

  - `fix(change):` Use `settings.paths` from `settings.yml` for change directory resolution instead of per-config `activeConfig.paths`, matching the pattern used by runner screens

## 1.0.0-alpha.11

### Patch Changes

- d279232: ## Fixed

  - `fix(change):` Resolve change paths using `projectRoot` instead of bare relative paths, matching the SDK pattern
  - `fix(form):` Add Shift+Tab support for backward field navigation
  - `fix(config):` Guard ConfigImportScreen `useInput` handler with `isActive` to prevent focus interference
  - `fix(config):` Constrain ConfigEditScreen form height to terminal bounds with `overflowY="hidden"`
  - `fix(transfer):` Update aggregate `rowsTransferred` in real-time during dt:import and db-to-db transfers
  - `fix(transfer):` Prevent `dt:import:complete` from setting phase to `complete` prematurely during multi-file imports
  - `fix(transfer):` Show spinner instead of misleading 0% progress bar for same-server transfers

## 1.0.0-alpha.10

## 1.0.0-alpha.9

### Major Changes

- 8e47888: ### Cross-Database Data Transfer

  Add a complete data transfer system for copying data between databases, including cross-dialect transfers (PostgreSQL ↔ MySQL ↔ MSSQL).

  **Planning & Execution**

  - Schema introspection via dialect-specific system catalogs to discover tables, columns, primary keys, identity columns, and row estimates
  - Foreign key dependency graph with topological sort ensures parent tables transfer before children; graceful fallback on circular dependencies
  - Same-server detection with localhost normalization (`127.0.0.1`, `::1`, `localhost.localdomain`) enables direct `INSERT INTO ... SELECT` optimization, bypassing application-level marshalling
  - Cross-server path uses configurable batch streaming (default 1000 rows) with per-batch progress events
  - Automatic exclusion of internal `__noorm_*` tables

  **Conflict Resolution**

  Four strategies for handling primary key conflicts:

  - `fail` (default) — abort on first conflict
  - `skip` — skip conflicting rows (`INSERT IGNORE`, `ON CONFLICT DO NOTHING`, `MERGE ... WHEN MATCHED THEN skip`)
  - `update` — upsert existing rows (`ON DUPLICATE KEY UPDATE`, `ON CONFLICT DO UPDATE`, `MERGE ... THEN UPDATE`)
  - `replace` — delete and re-insert (`REPLACE INTO`, delete+insert for PG/MSSQL)

  **Dialect-Specific Handling**

  - **PostgreSQL**: `session_replication_role = replica` for FK bypass, `OVERRIDING SYSTEM VALUE` for identity insert, `setval(pg_get_serial_sequence(...))` for sequence reset, `TRUNCATE ... CASCADE`
  - **MySQL**: `SET FOREIGN_KEY_CHECKS = 0`, backtick quoting, cross-database `db.table` notation, `ALTER TABLE ... AUTO_INCREMENT` reset
  - **MSSQL**: Per-table `NOCHECK CONSTRAINT ALL`, `SET IDENTITY_INSERT ON/OFF`, `DBCC CHECKIDENT` for reseed, `MERGE` statements for all conflict strategies, `[bracket]` quoting, four-part `[db].[schema].[table]` naming

  **Options**: `--tables`, `--on-conflict`, `--batch-size`, `--truncate`, `--no-fk`, `--no-identity`, `--dry-run`

  **UI**

  - 7-phase TUI wizard: destination selection → table picker (multi-select with "all" toggle) → options → plan preview with dependency visualization → confirm → live progress bars → completion summary
  - Headless mode with `--to <config>` and full JSON output support
  - Observer events for real-time progress: `transfer:planning`, `transfer:plan:ready`, `transfer:table:progress`, `transfer:complete`

  ***

  ### Portable .dt Data Format

  Add a portable data format (`.dt`) for file-based export/import and cross-dialect database transfers.

  **Format**

  - JSON5-based line format: schema header line followed by data rows
  - Three extensions: `.dt` (plain), `.dtz` (gzip compressed), `.dtzx` (encrypted + compressed)
  - Schema header captures source dialect, version, table name, and column types
  - Universal type system maps dialect-specific types to portable intermediates

  **Type System**

  - Simple types: `string`, `int`, `bigint`, `float`, `decimal`, `bool`, `timestamp`, `date`, `uuid`
  - Encoded types: `json`, `binary`, `vector`, `array`, `custom`
  - Version-aware mappings: MySQL VECTOR (9.0+), MSSQL JSON/VECTOR (2025+), PostgreSQL array notation
  - Smart encoding: raw for small values, base64 for binary, gzip+base64 when compression saves ≥15%

  **Cross-Dialect Transfers**

  - In-memory `DtStreamer` converts source rows → universal intermediates → target rows
  - No file I/O or serialization overhead — pure type conversion
  - Soft-limit batching: flush at row count OR 1GB memory threshold to prevent OOM on large BLOBs
  - Version detection via `queryDatabaseVersion()` enables version-aware type mapping

  **File Export/Import**

  - `DtWriter`: streaming writer with extension-based format selection
  - `DtReader`: streaming reader with async row iteration
  - Passphrase-based encryption: PBKDF2 key derivation + AES-256-GCM
  - Schema validation: target table structure checked before import begins

  **CLI Integration**

  - `--export <path>` with `--tables`: single table → file path, multiple tables → directory with `<table>.dt` per table
  - `--import <path>`: load `.dt`/`.dtz`/`.dtzx` into active config
  - `--compress`: produce `.dtz` output
  - `--passphrase`: produce/consume encrypted `.dtzx`
  - Mutually exclusive with `--to` (file export vs db-to-db transfer)

  **TUI Integration**

  - Export/import options in destination selection phase
  - Export flow: destination → tables → export options (path, compress, encrypt) → confirm → progress → complete
  - Import flow: file path → passphrase (if `.dtzx`) → schema preview with validation → options → confirm → progress → complete

  **Template Loader**

  - `.dt` and `.dtz` files usable as seed data in templates
  - Registered in template loader system alongside SQL and JSON loaders
  - No `.dtzx` support in templates (no way to provide passphrase)

  **Observer Events**: `dt:export:start`, `dt:export:progress`, `dt:export:complete`, `dt:import:start`, `dt:import:schema`, `dt:import:progress`, `dt:import:complete`, `dt:stream:start`, `dt:stream:progress`, `dt:stream:complete`, `dt:validate:result`

  ***

  ### Encrypted Secrets Vault

  Add a team-shared encrypted secrets vault backed by the database with dual-layer encryption.

  **Encryption Architecture**

  - Dual-layer model: vault key encrypted per-user via ephemeral X25519 ECDH + HKDF-SHA256 + AES-256-GCM, secret values encrypted with the shared vault key via AES-256-GCM
  - Each user receives their own encrypted copy of the vault key using their identity public key
  - Access determined by presence of `encrypted_vault_key` on identity row — no separate permissions table

  **Secret Resolution Hierarchy**

  Three-tier priority system for secret lookups:

  1. Config-specific local secrets (highest, from `.noorm/state/state.enc`)
  2. Global local secrets (shared across configs)
  3. Vault secrets (lowest, database-backed)

  Secrets available in template context as `<%= secrets.KEY_NAME %>` via `buildSecretsContext()`.

  **Operations**

  - `vault init` — generate vault key, encrypt for initializer's identity
  - `vault set <key> <value>` — encrypt and upsert secret with `setBy` audit trail
  - `vault rm <key>` — remove secret by key
  - `vault list` — list all secrets with metadata (who set them, timestamps)
  - `vault cp` — copy secrets between configs with `--all`, `--force`, `--dry-run`; auto-initializes destination vault if needed
  - `vault propagate` — grant vault access to all pending team members by encrypting the vault key for their public keys

  **UI**

  - TUI screen with secret list, defined-but-unset indicators (from settings), pending user count, and keyboard shortcuts for all operations (`[a]`dd, `[d]`elete, `[p]`ropagate, `[i]`nit)
  - Headless commands with JSON output for all operations
  - Observer events: `vault:initialized`, `vault:secret:created`, `vault:secret:updated`, `vault:secret:deleted`, `vault:propagated`, `vault:copy:completed`

  **Database Schema**: New `__noorm_vault__` table (`secret_key`, `encrypted_value`, `set_by`, timestamps) and `encrypted_vault_key` column on `__noorm_identities__`

  ***

  ### SDK: Move noorm operations to `ctx.noorm` namespace

  **Breaking:** Refactor the SDK Context to separate SQL-focused operations from noorm management operations. All schema, change, lock, runner, explore, transfer, and DT methods move from the top-level `ctx` to a new `ctx.noorm` namespace via a lazy-initialized `NoormOps` class.

  Top-level Context retains only SQL-focused API: `kysely`, `dialect`, `connected`, `connect()`, `disconnect()`, `transaction()`, `proc()`, `func()`.

  **Before:**

  ```ts
  await ctx.build();
  await ctx.fastForward();
  const tables = await ctx.listTables();
  await ctx.acquireLock();
  ```

  **After:**

  ```ts
  await ctx.noorm.build();
  await ctx.noorm.fastForward();
  const tables = await ctx.noorm.listTables();
  await ctx.noorm.acquireLock();
  ```

  Properties `config`, `settings`, `identity`, `observer` also move to `ctx.noorm`.

  **Migration:** Add `.noorm` between `ctx` and any management method call. SQL operations (`kysely`, `transaction`, `proc`, `func`) and lifecycle (`connect`, `disconnect`) are unchanged.

  ***

  ### Run

  - Fix form retry on failure: reset internal `submitting` state after `onSubmit()` completes so the form is no longer permanently locked after a failed submission; parent `busy` prop still guards against double-submit during async operations
  - Apply settings exclude rules to build: pass pre-filtered file list from `RunBuildScreen` to `runBuild()` instead of letting the runner re-discover all files from disk, which ignored `include`/`exclude` rules

## 1.0.0-alpha.8

### Minor Changes

- c8da002: ## Auto-Update Notifications

  ### CLI

  - **Background Update Checking**: Checks npm registry on TUI launch

    - Toast notification for available minor/patch updates
    - Warning toast for major version updates
    - Respects user preferences in `~/.noorm/settings.yml`

  - **Global Settings**: User-level preferences at `~/.noorm/settings.yml`

    - `checkUpdates`: Enable/disable update checking (default: true)
    - `autoUpdate`: Auto-install non-major updates (default: false)
    - `dismissable`: Per-alert "don't ask again" preferences

  - **DismissableAlert Component**: Reusable confirmation dialogs
    - Auto-resolves based on stored preference ('always'/'never'/'ask')
    - Keyboard navigation with arrow keys and number shortcuts
    - Optional "Don't ask again" checkbox with persistence

  ### SDK

  - New `src/core/update/` module with:

    - `checkForUpdate()`: Version comparison with prerelease channel support
    - `installUpdate()`: Background npm install via child process
    - `loadGlobalSettings()` / `saveGlobalSettings()`: User preferences
    - `getDismissablePreference()` / `updateDismissablePreference()`: Alert state

  - New observer events: `update:checking`, `update:available`, `update:complete`, etc.

## 1.0.0-alpha.7

### Patch Changes

- cb9f9c2: Display template errors during dry-run in UI feedback

  Template rendering errors during dry-run were silently captured in results but never emitted via the observer event system, making them invisible in the UI. Now `file:dry-run` events include status and error fields, and the progress hook properly tracks failed dry-runs.

## 1.0.0-alpha.6

### Patch Changes

- Fix bundle: inject version at build time instead of requiring package.json

## 1.0.0-alpha.5

### Patch Changes

- Add state loading error output to version command for debugging

## 1.0.0-alpha.4

### Patch Changes

- Add `noorm version` command for diagnostic output showing CLI version, identity paths, and project status

## 1.0.0-alpha.3

### Patch Changes

- ac0b3c1: Rebuild with complete bundling fixes

## 1.0.0-alpha.2

### Patch Changes

- b22c1ec: ## CLI

  ### Fixed

  - `fix(build):` Add CJS compatibility shim for dynamic require in ESM bundle

## 1.0.0-alpha.1

### Patch Changes

- 9673054: ## CLI

  ### Fixed

  - `fix(build):` Bundle all pure JS dependencies (meow, ink, react, pg, mysql2, tedious) - only better-sqlite3 remains external due to native bindings

## 1.0.0-alpha.0

### Major Changes

- 6b3cce1: Initial release of noorm - Database Schema & Change Manager

  ## @noormdev/cli

  ### Features

  - **Terminal UI** - Full-featured TUI for managing database schemas
  - **Headless Mode** - CLI commands with JSON output for CI/CD pipelines
  - **Multi-Dialect Support** - PostgreSQL, MySQL, SQLite, MSSQL
  - **Change Detection** - Checksum-based tracking, only changed files re-execute
  - **SQL Templates** - Dynamic SQL with Eta templating engine
  - **Change Management** - Versioned migrations with forward/revert support
  - **Schema Explorer** - Browse tables, views, indexes, functions from terminal
  - **SQL Terminal** - Built-in REPL with query history
  - **Config Management** - Multiple database configs with encrypted storage
  - **Secrets** - Encrypted secret storage with template injection
  - **Stages** - Environment templates for teams
  - **Protected Configs** - Safety guards for production databases
  - **Locking** - Concurrent operation control
  - **Identity** - Audit trail with git-based identity

  ## @noormdev/sdk

  ### Features

  - **Programmatic API** - Full access to noorm functionality
  - **Context-based** - Single entry point via `createContext()`
  - **Type-safe** - Full TypeScript support
  - **Observable** - Event-based architecture with `@logosdx/observer`
  - **Test Integration** - `requireTest` guard for safe test database usage
