# @noormdev/sdk

## 1.0.0-alpha.31

## 1.0.0-alpha.30

### Major Changes

- 0951b7e: ## Breaking Changes

  ### `allowProtected` option removed

  The `allowProtected` option has been removed from `CreateContextOptions`. Passing it no longer has any effect — protected configs unconditionally block all destructive operations with no override.

  **Before:**

  ```typescript
  // This no longer works — allowProtected is not a valid option
  const ctx = await createContext({ config: "staging", allowProtected: true });
  await ctx.noorm.db.truncate(); // would proceed
  ```

  **After:**

  ```typescript
  // Protected configs always block destructive ops — no override possible
  const ctx = await createContext({ config: "staging" });
  await ctx.noorm.db.truncate(); // throws ProtectedConfigError
  ```

  To run a destructive operation against a protected config, set `config.protected = false` manually before running the operation, then restore it.

  ### `checkProtectedConfig` signature changed

  The exported `checkProtectedConfig` guard function signature changed from `(config, operation, options)` to `(config, operation)`. If you call this function directly, remove the third argument.

  ## New Behavior

  The following operations are now blocked on protected configs (in addition to `truncate`, `teardown`, and `reset`):

  - `ctx.noorm.dt.importFile()` — bulk data import is destructive
  - `ctx.noorm.changes.revert()` — schema rollbacks are destructive in production
  - `ctx.noorm.changes.rewind()` — batch schema rollbacks are destructive in production

## 1.0.0-alpha.29

### Minor Changes

- 850b2d3: ## Added

  - `feat(change):` Expose `change next` on the SDK for programmatic access to the next pending change

## 1.0.0-alpha.28

## 1.0.0-alpha.27

### Minor Changes

- a4d7308: ## Added
  - `feat(tvp):` Make `TvpValue` and `tvp()` generic — `TvpValue<T>` preserves row types through proc, func, and tvf signatures so the compiler catches column mismatches at call sites

## 1.0.0-alpha.26

### Minor Changes

- 66e6fb8: ### Added

  - `feat(sdk):` Add TVP (table-valued parameter) support for MSSQL via `tvp()` helper — pass structured tabular data to `ctx.proc()`, `ctx.func()`, and `ctx.tvf()` calls
  - `feat(sdk):` Validate TVP row key consistency and enforce MSSQL's 2,100 parameter limit with clear error messages

### Patch Changes

- 66e6fb8: ### Fixed

  - `fix(teardown):` Sort composite types (TVPs) before domain types during teardown to prevent dependency failures on MSSQL, which lacks `DROP TYPE ... CASCADE`

## 1.0.0-alpha.25

### Minor Changes

- df24197: ## Added
  - `feat(sdk):` Support `[Args, ReturnType]` tuple definitions for procs, functions, and TVFs — return types are inferred automatically, with explicit override still available

## 1.0.0-alpha.24

### Minor Changes

- 8749127: ### Added

  - `feat(sdk):` Add `ctx.tvf()` method for calling table-valued functions on MSSQL and PostgreSQL
  - `feat(sdk):` Add `Tvfs` generic parameter to `createContext()`, `Context`, and `ImpersonatedScope` for type-safe TVF signatures

  ### Changed

  - `refactor(sdk):` Replace `as any` casts in impersonation scope with proper generic flow through `buildProcCall<T>`, `buildFuncCall<T>`, and `buildTvfCall<T>`

## 1.0.0-alpha.23

### Patch Changes

- 715cddc: ### Fixed

  - `fix(teardown):` Schema-qualify all DROP statements in `db.teardown()` to prevent failures when the connection user's default schema differs from `dbo` (MSSQL) or `public` (PostgreSQL)

## 1.0.0-alpha.22

### Patch Changes

- fff443a: ### Fixed
  - `fix(sdk):` Add integration and unit tests verifying `db.truncate()` and `db.teardown()` respect `settings.teardown.preserveTables`

## 1.0.0-alpha.21

### Minor Changes

- 4f4967c: ## API/Services

  ### Fixed

  - `fix(sdk):` `db.truncate()` and `db.teardown()` now respect `settings.teardown.preserveTables` and `postScript` from settings.yml
  - `fix(sdk):` `db.truncate()` accepts optional `TruncateOptions` — user-provided `preserve`/`only` take priority over settings fallback

## 1.0.0-alpha.20

### Minor Changes

- 1dc22b3: ## Added

  - `feat(sdk):` Per-request user impersonation via `ctx.impersonate()` — borrow a dedicated pool connection, switch database identity, and run queries as a specific principal with guaranteed revert
  - `feat(sdk):` Callback mode (auto-reverts on completion or throw) and explicit mode (caller-managed lifecycle for cross-boundary use cases like Hapi request hooks)
  - `feat(sdk):` MSSQL (`EXECUTE AS USER` / `REVERT`) and PostgreSQL (`SET ROLE` / `RESET ROLE`) dialect support with SQL injection prevention via username validation and dialect-specific quoting

### Patch Changes

- 8b20702: ### Fixed

  - `fix(sdk):` Bundle all runtime dependencies — resolves `Cannot find package 'json5'` and similar errors when importing the SDK
  - `fix(sdk):` Add `createRequire` banner for CJS packages that use `require('process')` in ESM bundles
  - `fix(template):` Resolve `$helpers` loading in compiled binaries via `Bun.build()` bundling

  ### Changed

  - `perf(sdk):` Lazy-load template data parsers (JSON5, YAML, CSV) — heavy parser libraries are now deferred until first use, reducing SDK startup time
  - `perf(sdk):` Replace `voca` dependency with inline `camelCase` implementation (~1500 lines removed from bundle)
  - `perf(sdk):` Stub `ansis` terminal color library — SDK consumers don't need ANSI output

## 1.0.0-alpha.19

### Patch Changes

- 18e36b6: ## Fixed
  - `fix(mssql):` Resolve SQL Server failures in runner and change tracking operations
  - `fix(mssql):` Add `OUTPUT inserted.id` support for MSSQL insert operations
  - `fix(mssql):` Translate `.limit()` to `TOP` via MssqlLimitPlugin
  - `fix(schema):` Make v2 migration fully idempotent with partial-state recovery
  - `fix(runner):` Handle `AggregateError` and non-standard error objects from tedious driver

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

## 1.0.0-alpha.16

## 1.0.0-alpha.15

## 1.0.0-alpha.14

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

### Patch Changes

- 8797eb4: ### Fixed

  - `fix(settings):` NOORM\_\* environment variables now override any settings.yml field (e.g. `NOORM_PATHS_SQL` overrides `paths.sql`)

## 1.0.0-alpha.12

## 1.0.0-alpha.11

## 1.0.0-alpha.10

### Minor Changes

- 06d799b: ## DT Format

  ### Added

  - `feat(dt):` Add `text` encoded type for large TEXT columns with smart gz64 compression
  - `feat(dt):` Map MSSQL `nvarchar(max)` and `varchar(max)` to `text` encoded type
  - `feat(dt):` Detect `(max)` suffix in MSSQL schema introspection via `max_length = -1`

  ### Changed

  - `refactor(dt):` MySQL `text`, `mediumtext`, `longtext` now map to `text` (was `string`); `tinytext` stays `string`
  - `refactor(dt):` MSSQL `text`, `ntext` now map to `text` (was `string`)

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

## 1.0.0-alpha.7

## 1.0.0-alpha.6

## 1.0.0-alpha.5

## 1.0.0-alpha.4

## 1.0.0-alpha.3

## 1.0.0-alpha.2

## 1.0.0-alpha.1

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
