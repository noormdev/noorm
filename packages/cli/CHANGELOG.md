# @noormdev/cli

## 1.1.0

## 1.0.2

### Patch Changes

- 8f275f4: Read change-history timestamps as UTC on postgres and mysql

  `executed_at` has no time zone and noorm writes UTC into it, but `pg` and
  `mysql2` both read that back through the host's local zone. On a UTC-4 host a
  change applied a second ago was reported as four hours in the future, which
  surfaced in the TUI as "Applied ... in 4 hours" on the home screen and in
  change history. MSSQL is unchanged — its driver was not measured.

## 1.0.1

### Patch Changes

- f674343: Read change-history timestamps as UTC on postgres and mysql

  `executed_at` has no time zone and noorm writes UTC into it, but `pg` and
  `mysql2` both read that back through the host's local zone. On a UTC-4 host a
  change applied a second ago was reported as four hours in the future, which
  surfaced in the TUI as "Applied ... in 4 hours" on the home screen and in
  change history. MSSQL is unchanged — its driver was not measured.

## 1.0.0

### Major Changes

- ba22246: Resolve the access channel from who is driving, not which binary was invoked

  `Channel` used to name the transport: `user` meant the CLI/TUI/SDK and `mcp`
  meant the MCP server. Those only coincide when a human is at the keyboard. An
  agent refused a write over MCP could see `noorm` on the PATH and shell out,
  and because the CLI hardcoded `user` at every policy call site, that second
  attempt ran with the human's role. On a stock config that turned deny into
  allow for `sql:write`, `sql:ddl`, `db:create`, `run:build` and `vault:read`,
  and turned `db:destroy` into a confirm that `--yes` satisfied.

  Two breaking changes:

  **The config fields are renamed.** `Channel` is now `'user' | 'agent'`, and
  `ConfigAccess` is `{ user, agent }` instead of `{ user, mcp }`. `agent: false`
  hides a config from agents on _both_ transports, not just over MCP. Stored
  state migrates automatically (state schema v3) and carries every value over
  verbatim — `mcp: 'operator'` becomes `agent: 'operator'`, `mcp: false` becomes
  `agent: false`. SDK callers passing `channel: 'mcp'` to `createContext` must
  pass `'agent'`, and anything reading or writing `config.access.mcp` must use
  `config.access.agent`. In the TUI, the "MCP Role" field is now "Agent Role".

  **Agents shelling out to the CLI now get the agent role.** The CLI resolves
  its channel from provenance via `resolveChannel()`: an allowlist of variables
  the agent harnesses (Claude Code, Codex, Cursor, Gemini CLI) set for their own
  child processes. A stock config gives agents `viewer`, so commands that used
  to succeed inside an agent session are now refused — that is the fix, not a
  regression. `TERM_PROGRAM`, `CI` and TTY state are deliberately not consulted;
  they describe the terminal or the pipeline, not the caller.

  Set `NOORM_CHANNEL=user` to opt out when a human is scripting from inside an
  agent session, or `NOORM_CHANNEL=agent` to opt in with no harness present. An
  agent can set that variable too; this defends against one routing around a
  refusal, not one deliberately evading the check.

- 72fb64f: ## Template Inspector & Execution Control

  ### CLI

  - **Template Inspector Screen** (`run/inspect`, `[i]` shortcut): New dedicated screen for debugging SQL templates

    - Categorized context view (data files, helpers, built-ins, config, secrets, environment)
    - Array shape detection to debug property access failures
    - Template preview with render error display
    - Refresh support for iterative debugging

  - **Rerun Confirmation**: Pre-execution file status check with dialog

    - Shows count of new, previously-run, changed, and failed files
    - Confirmation prompt before re-running previously-executed files
    - `[r]` retry shortcut in all run screens (respects `--force` flag)

  - **Execution Cancellation**: `[c]` to abort long-running operations

    - Destroys connection to cleanly stop execution
    - Shows "Execution cancelled" error state

  - **Unified KeyHandler Pattern**: Replaced per-screen focus handlers with flexible KeyHandler component

  ### SDK

  - `checkFilesStatus()` function for pre-execution file status categorization
  - New types: `FileStatusCategory`, `FileStatusResult`, `FilesStatusResult`

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

- ba22246: ## Headless contract: one `--json` envelope, four exit codes

  ### Changed

  - `fix(cli)!:` every `--json` payload is now a JSON **object** carrying a top-level boolean `success`, and is never a bare array. `success` is `true` if and only if the process exits `0`, so `jq -e '.success'` is a failure check that works against every command.
    - **Commands that returned a top-level array now return a named object.** `change list` → `.changes` (plus `.pending`), `change history` → `.history`, and every `db explore` list — `tables`, `views`, `indexes`, `fks` (→ `.foreignKeys`), `functions`, `procedures`, `types`, `triggers` — under the matching key. A script doing `jq '.[]'` on any of those must now name the key.
    - **Every other payload gained `success` and lost nothing.** Existing key reads keep working.
    - `config export --json` now emits the envelope (`{success, name, config}`). The bare artifact — the shape `config import` reads — is still what `noorm config export dev > dev.json` produces, unchanged.
    - `noorm update --json` no longer prints two JSON documents for one error, and no longer reports `success: true` on a failed install while exiting non-zero.
  - `fix(cli)!:` exit codes now distinguish four outcomes: `0` success, `1` total failure, `2` usage error (bad or missing flag, a TTY-only command run non-interactively, or a named target that does not exist), `3` partial failure.
    - **`2` no longer means "partial".** It previously meant partial failure on `run build` / `run dir` / `run files` / `run exec` and the five `change` execution commands — but the same `2` was also returned for a _total_ failure on those commands, so the two were indistinguishable. Partial now has its own code. **A pipeline testing `[ $? -eq 2 ]` for "partially applied" must now test `-eq 3`.** Checks of the form `if ! noorm …` are unaffected.
    - `ci secrets` partial loads move from `2` to `3`. `db transfer`'s total-failure exit moves from `2` to `1` (its partial exit stays `3`). `vault propagate` and `vault rm`, `dev test-workers` and `dev test-helpers` now report partial and not-found instead of collapsing everything to `1`.
    - A "you named something that isn't there" failure — missing file, directory, config, change, secret key, table, or a glob matching nothing — moves from `1` to `2` across the CLI. Confirmation and `--force` refusals deliberately stay at `1`.

  ### Fixed

  - `noorm run inspect <missing-file>` reported a fully-populated context and exit `0` for a file that was never on disk — it only ever read the template's _directory_. It now fails with exit `2`. `run preview` gained the same up-front check so both surfaces agree.
  - `noorm run dir` reported success over a directory that contained no SQL files, and reported a missing directory as a SQL failure. Both now exit `2` with a message naming the path.
  - `noorm run exec` died with `Bun is not defined` under Node — the documented dev entry point — before doing any work. Glob expansion falls back to `node:fs/promises` when the `Bun` global is absent; the compiled binary keeps Bun's own matcher.
  - `noorm run preview --json` put a full stack trace, including absolute filesystem paths, into the machine-readable `error` field. `--json` now carries the message only; the stack still reaches an operator on stderr.
  - `noorm lock acquire` gained `--timeout` and `--reason`, which the TUI has always collected — CI-acquired locks were permanently default-timeout and reasonless, so whoever they blocked had no way to see what they were waiting on.
  - `withVaultContext` never passed `yes` to the SDK context, so `--yes` / `NOORM_YES` was inert for every vault command.
  - `db transfer` declared a `--force` flag that nothing read.
  - `run exec`, `db reset`, `vault cp`, and `dev test-helpers` wrote some errors straight to stderr, leaving `--json` callers with an empty stdout and no envelope to parse.

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

- ba22246: ## Access default: agents no longer get admin

  ### Changed

  - `fix(policy)!:` a config with no explicit `access` now resolves to `{ user: 'admin', mcp: 'viewer' }` instead of `{ user: 'admin', mcp: 'admin' }`. A stock project writes no `access`, so every config was handing full admin to any connected MCP client — writes, DDL, `change_run`, `run_build`, database drops, and vault/secret reads all went through unchecked.
    - **The `user` channel is unchanged.** Nothing about the CLI, TUI, or SDK behaves differently.
    - **MCP agents keep read access.** `explore` and read-only SQL (`SELECT`, `EXPLAIN`, `SHOW`, `DESCRIBE`) still work with no setup.
    - **MCP agents lose write access by default.** If an agent needs to write, run changes, or run builds, set that config's `access.mcp` to `operator` or `admin` explicitly — via `noorm ui` → Config → Edit, or in the JSON before `config import`.
    - **Configs that already store an explicit `access` are untouched**, including ones holding `mcp: 'admin'`. If you created configs on an earlier build, that migration already wrote `admin/admin` to disk and it is preserved — run `noorm config list` and lower any `mcp:admin` you did not intend.
  - `noorm config list` now prints the access tag for any config that differs from the default, so an `mcp: admin` escalation is visible. Previously the tag was hidden whenever the user channel was `admin`, which concealed exactly that case.

- ba22246: ## Authorization is now enforced at the core seam

  Policy was re-implemented per surface, and several cells were simply empty — the CLI would perform operations the TUI correctly refused, and two whole domains had no permission to check against.

  ### Fixed

  - `fix(policy)!:` the SQL classifier no longer routes writes as reads. `EXPLAIN (ANALYZE) DELETE FROM t` classified as `read` and deleted rows under a `viewer` role — through the CLI and over a live MCP session. Two independent causes are fixed: the keyword fallback treated `EXPLAIN` as terminally read-only, and on the parser path `EXPLAIN` inherited nothing from the statement it wraps while the write-signal scan had no DDL node types. An `EXPLAIN` now inherits its wrapped statement's classification.
  - `fix(policy)!:` statement splitting is dialect-aware. It tracked only `'`, so an MSSQL bracket-quoted identifier (`SELECT 1 AS [a'b]; DROP TABLE x`) split wrong and the tail ran unclassified. `"`, backticks, `[…]`, `$tag$…$tag$` and all three comment forms are now modelled.
  - `fix(policy)!:` a statement with no leading word character used to classify as `read`, so a leading NUL byte carried `DROP TABLE` past the gate. It now fails closed.
  - `feat(policy)!:` added the permissions that did not exist — `vault:*`, `secret:*`, `config:write`, `db:truncate`, `db:teardown`, `transfer:plan`, `lock:force`, `debug:*`. Operations in those domains had nothing to gate against and shipped ungated.
  - `fix(vault)!:` vault and secret operations are gated at the core seam, so SDK, CLI and TUI inherit one check. A `viewer` config that was denied `run build` could still run `vault set`, `vault rm`, `vault propagate` and `secret set`.
  - `fix(db)!:` `db create` is gated. The matrix denied `db:create` to `viewer` and the TUI enforced it; the CLI created the database anyway.
  - `fix(db)!:` `db truncate` and `db teardown` require confirmation. `--yes`/`--force` were declared arguments that neither command read, so `noorm db teardown < /dev/null` dropped 63 objects and exited 0 — against documentation promising the CLI refuses.
  - `fix(debug)!:` the debug screens' delete paths are gated. They removed rows from `noorm.vault` and `noorm.identities` with no authorization check at all.
  - `fix(lock)!:` `lock force` is gated and requires `--yes`, names the holder it evicts, and returns a distinct exit code when there was nothing to release.
  - `fix(config)!:` `config import --force` is gated on `config:write`. It rewrote a config's `access` with no check, escalating a `viewer` config to full delete rights in one command.
  - `fix(transfer):` `getTransferPlan` is gated, matching the invariant its own comment claimed. `--dry-run` leaked destination table names, row estimates and the FK graph to a denied caller.

- ba22246: ## Identity and state key handling fail closed

  ### Fixed

  - `fix(identity)!:` malformed key material is rejected instead of deriving a publicly computable key. `Buffer.from(key, 'hex')` never throws, so any non-hex private key collapsed to a zero-length HKDF input and produced a **constant** AES key — an attacker holding no key material could decrypt a real `state.enc`. `isValidKeyHex` existed but was only called on the CI path; it now guards every entry point.
  - `fix(ci)!:` `ci identity enroll` verifies the stored public key matches the one presented. It checked only that a row existed, so anyone able to INSERT into `noorm.identities` — no vault access required — could pre-plant their own key and receive the vault key, while the operator's enrollment reported success and echoed back the expected key.
  - `fix(identity)!:` `identity init --force` requires `--yes`, backs up the keypair, and names what it destroys. It silently regenerated the keypair and permanently destroyed every project's `state.enc`.
  - `fix(ci):` `ci init --force` backs up `state.enc` and refuses on a TTY without confirmation; it destroyed all configs and secrets unprompted. It also now routes through `parseConfig`, so a numeric-looking database name persists as a string.
  - `fix(vault)!:` `vault propagate` names every recipient and withholds until confirmed, and reports partial failures instead of returning success with the failed identity silently omitted.
  - `fix(sdk):` an explicit identity scope whose revert fails is no longer marked reverted, and `disconnect()` no longer hangs when scopes are still held.

- ba22246: ## Operations no longer report success over lost, duplicated or unwritten data

  ### Fixed

  - `fix(transfer)!:` export and db-to-db transfer paginate by primary key instead of bare `LIMIT/OFFSET`. With no `ORDER BY`, a source being written to during a 50,000-row export produced 14,149 missing and 13,387 duplicated rows while reporting `rowsExported: 50000` and exiting 0. Tables with no primary key now take a single-statement snapshot rather than corrupting silently.
  - `fix(dt)!:` a malformed row or a dead worker no longer hangs the pipeline forever. The error branch never decremented the in-flight count, `request()` never settled on worker death, and `worker:exit` had no subscribers — a four-byte bad payload wedged `db transfer --import` indefinitely. Three busy-wait loops are replaced with real settlement.
  - `fix(transfer)!:` the postgres same-server path no longer copies the destination into itself. It ignored the source database entirely and could only ever emit `INSERT INTO t SELECT ... FROM t`.
  - `fix(dt):` decompression is bounded on import. An unbounded `gunzip` inflated 398 KB to 400 MB (1029:1), and because it runs in a compute worker the resulting OOM triggered the hang above.
  - `fix(transfer):` reported counts reflect reality — `onConflict: 'skip'` no longer counts no-ops as inserted, and the same-server path reports affected rows instead of a postgres `reltuples` estimate.
  - `fix(transfer):` `db transfer --export` with no `--tables` exports every table, as its own flag description promised. It exported nothing, printed `success: true` and exited 0.
  - `fix(transfer):` cross-dialect transfer works. The planner probed the destination with the _source_ dialect, so every cross-dialect transfer aborted and roughly 400 lines of streaming conversion were unreachable — while the docs claimed the feature worked.
  - `fix(teardown)!:` `truncate` qualifies statements with the table's schema. It discarded the schema, emptied 12 tables and then aborted — partial irreversible loss, reported as a failure.
  - `fix(state)!:` `state.enc` writes are atomic and reconciled. Ten concurrent `noorm secret set` runs left five secrets, all exiting 0. Writes now stage-and-rename with an exclusive lock, three-way reconcile against a changed file, and keep a `.bak` generation.
  - `fix(state):` reads stopped rewriting state. `needsMigration` tested a field the migration never writes, so it was always true and every command — including `config list` — re-encrypted and rewrote `state.enc`, turning reads into writes and amplifying the loss above.
  - `fix(runner):` `.sql.tmpl` dedup works. The stored checksum was the raw file hash while the comparison used the rendered hash, so templates re-executed on every build and failed on non-idempotent DDL.
  - `fix(runner):` SQLite executes every statement in a multi-statement file instead of silently running the first and reporting success.

### Minor Changes

- ba22246: ## Added

  - `feat(identity):` Record the detected agent harness in operation provenance. When a session runs under a recognised agent harness, `executed_by` is suffixed with `(via <harness>)` — so a change applied by an agent is distinguishable from one a human applied. Stamped at the shared insert seam, so change operations, resets and run operations all carry it on every dialect.
  - `feat(cli):` `noorm info` reports the detected harness and the environment variables that identified it, so an agent-driven session is visible rather than silent.

  Provenance is folded into the existing identity string rather than a new column: the audit question is binary, and a suffix answers it without a four-dialect schema migration. It is not an attestation — `executed_by` is unauthenticated free text and harness detection reads caller-controlled environment variables, so the suffix records what noorm observed, not a proven claim.

- 88b33ce: ## Added

  - `feat(dt):` DT file modifier — drop, add, or rename columns and filter rows from exported `.dt`/`.dtz`/`.dtzx` files without re-exporting from the source database
  - `feat(cli):` "Modify .dt file" option in the Data Transfer screen with interactive recipe builder, schema preview, and streaming output

- 6753ebd: Add graceful shutdown screen with phase progress display on exit. Migrate test runner from vitest to bun test. Extract shared CLI hooks and utilities to reduce duplication across screens.
- e87c435: Rework `noorm change` for interactive-first ergonomics and drop the surprising bare-invocation side effect.

  - Bare `noorm change` now renders citty's help output and **does not connect to the database**. The status listing that used to live there moved to a new explicit leaf: `noorm change list`. This matches every other root command (`config`, `settings`, `identity`, `db`, `vault`, `secret`, `run`) and prevents accidental connection attempts when users are just exploring the CLI.
  - `change list` — new. Lists every known change with its status; accepts `--config`, `--json`.
  - `change edit [name]` — new. Resolves the change folder from settings and spawns `$EDITOR` (then `$VISUAL`, then `code`) with stdio inherited so terminal editors work in-place; exits with the editor's own exit code. Surfaces spawn failures (e.g. editor binary not found) instead of silently no-oping.
  - `change add [description]` — prompts for a description via `p.text` when omitted on a TTY.
  - `change rm [name]` — prompts for a change to delete, then confirms with `p.confirm`. `--yes` is no longer required on a TTY (it now just skips the confirm). On a non-TTY, both the name and `--yes` are still required so CI never deletes silently.
  - `change run [name]` — prompts from pending/reverted changes (filters `ctx.noorm.changes.status()` by `!orphaned && status in { pending, reverted }`).
  - `change revert [name]` — prompts from successfully applied changes.
  - `change rewind [name]` — prompts from successfully applied changes.
  - `change history-detail [name]` — prompts from changes with execution history (`status !== 'pending'`).

  In every case, non-TTY invocations without a name exit 1 with a uniform `Change name required…` error. User cancellation from any picker exits 1 with `Cancelled.`.

  **Migration:** replace `noorm change` with `noorm change list` in any scripts or CI jobs that relied on the status listing. The `--json` shape is unchanged.

- 850b2d3: ## Added

  - `feat(cli):` Migrate CLI from meow to citty with structured subcommands, built-in `--help` examples, and `noorm ui` launcher
  - `feat(cli):` Add shell completion via `@bomb.sh/tab`

  ## Fixed

  - `fix(change):` Populate `cli_version` in change history rows
  - `fix(cli):` Suppress `logger.info` inside `fn()` callbacks when `--json` is active
  - `fix(cli):` Restore vault cp dry-run preview and 3-positional CLI surface
  - `fix(cli):` Wire JSON output for change run/revert and unify history JSON path
  - `fix(cli):` Restore human-readable db transfer output

- f946820: Add CI identity bootstrap and two interactive settings editors:

  - `noorm identity ci` — diagnostic command for CI environments. Bootstraps the process from `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, and `NOORM_IDENTITY_EMAIL` env vars, deriving the public key from the private key and computing a deterministic identity hash across runners. In-memory overrides for both private key and metadata replace `~/.noorm/` filesystem reads, so CI runners can decrypt vault/state without writing key files.
  - `noorm settings edit` — interactive editor covering all 7 settings sections: paths, build, strict, logging, stages, rules, teardown. Stages and rules use add/edit/remove sub-loops. Esc inside a sub-editor returns to the section picker; only Esc at the top level exits. Adds `setTeardown()` to `SettingsManager` and a `settings:teardown-updated` event.
  - `noorm settings secret` — interactive editor for universal and stage-scoped secret **requirements** (declarations, not values). Supports add, edit, remove, and list actions.

- f522adc: ### Added

  - `feat(cli):` Add `noorm init --here` to initialize a project in the original cwd, ignoring any parent `.noorm/` discovered while walking up
  - `feat(cli):` Add global `-c <path>` / `--cwd <path>` flag (like `git -C`) that runs the subcommand inside `<path>` and skips the walk-up. Must precede the subcommand; after the subcommand `-c` keeps its per-command `--config` meaning.

  ### Changed

  - `refactor(cli):` `noorm init` now reports an existing `.noorm/` _before_ the TTY gate, so scripted invocations get the more actionable error.

- 2174274: ## Added
  - `feat(cli):` Add `info` command for project and database status display (`noorm info`, `noorm --json info`)
  - `feat(cli):` Show CLI version, schema/state/settings versions, install/upgrade dates, and DB object stats on Home screen
- 4373083: ## Added
  - `feat(mcp):` Add MCP server for coding agent integration — `noorm mcp serve` starts a stdio JSON-RPC server, `noorm mcp init` generates `.mcp.json` config files
  - `feat(rpc):` Add transport-agnostic RPC command registry with Zod-validated commands: `connect`, `disconnect`, `list_configs`, `overview`, `list`, `detail`, `sql`, `change_history`, `change_run`, `change_ff`, `change_revert`, `run_build`, `run_file`
  - `feat(rpc):` Add SQL protection for read-only enforcement on protected configs using `sql-parser-cst` with keyword fallback
- 7b907b3: Introduce the `noorm ci` command namespace and retire the standalone `noorm identity ci` diagnostic.

  Four new commands cover the full CI lifecycle — mint a keypair, enroll it in a real database, bootstrap ephemeral state inside a job, and batch-load secrets:

  - `noorm ci identity new --name <str> --email <str>` — generate a test-CI keypair locally. No database contact, no state written. Prints the private key once plus a copy-pasteable `NOORM_IDENTITY_*` env block. Designed for stateless/ephemeral CI (`isTest` configs, throwaway databases). Accepts `--json`.
  - `noorm ci identity enroll --config <name> --name <str> --email <str> [--public-key <hex>]` — register a CI identity in the target database and propagate vault access to it. Run once by a developer with existing vault access. Decrypts the caller's vault key, inserts a new identity row (`machine='ci'`, `os='env'`), and re-encrypts the vault key for the new identity. Idempotent on identityHash — safe to re-run. When `--public-key` is omitted, mints a new keypair and returns the private key; when provided, only the public half is enrolled (air-gapped flow).
  - `noorm ci init [--name <str>] [--force]` — bootstrap ephemeral `state.enc` from `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` env vars. Runs inside the CI job. Creates a config (default: `ci`, override via `--name` or `NOORM_CI_CONFIG_NAME`), marks it active, sets `isTest: true`. Absorbs the former `noorm identity ci` precheck — fails fast with exit 1 if any required env var is missing or malformed, or if `state.enc` already exists without `--force`.
  - `noorm ci secrets --file <path> [--config <name>] [--overwrite]` — batch-load secrets from a dotenv-style file into the active (or `--config`-named) vault. Parser ignores blank lines and `#` comments, splits on the first `=`, and strips a single matched pair of surrounding quotes. Existing keys are skipped unless `--overwrite` is set (so reruns are safe). Exit codes: `0` clean, `1` precondition failure, `2` partial (some set, some errored).

  **Removed:** `noorm identity ci`. Its precheck behavior is now built into `noorm ci init`. Callers that used `identity ci` only for validation should replace it with `noorm ci init`, which does the validation plus the state bootstrap.

  **Migration:** replace any pipeline that set `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` and ran `noorm identity ci` followed by `noorm change ff` with:

  ```bash
  noorm ci init --name prod
  noorm change ff
  ```

  For vault-aware pipelines, provision the CI identity once from a developer machine:

  ```bash
  noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com
  # copy the printed NOORM_IDENTITY_* block into your CI secrets store
  ```

- e10b7a4: Add two new CLI commands:

  - `noorm init` — interactive project bootstrap. Creates identity (if missing), project structure, and settings. Requires an interactive TTY.
  - `noorm sql repl` — launches the TUI directly on the SQL Terminal screen. Supports `--config <name>` to switch active config before launching. Requires an interactive TTY.

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

- 6753ebd: Add curl|sh installer and npm binary wrapper for streamlined installation. The published npm package now acts as a thin shim that downloads and executes the platform-specific compiled binary.
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

- 01208ec: ## Added
  - `feat(cli):` Universal `--yes` / `-y` flag and `NOORM_YES=1` environment variable for TTY-gated commands. Unblocks CI, scripted bootstrap, and subagent flows.
  - `feat(cli):` `noorm init --yes` now succeeds in non-TTY environments when an identity already exists at `~/.noorm/identity.{key,pub,json}`. Without an identity, it errors with a hint pointing at `noorm identity init --name "X" --email "Y"`.
  - `feat(cli):` `noorm sql repl --yes`, `noorm settings edit --yes`, and `noorm settings secret --yes` print a documented redirect-hint error instead of refusing silently, telling the user which non-interactive alternative to use (`sql query` / direct YAML edit / `secret set`).
- ba22246: ## Schema exploration answers about the object you asked for

  ### Fixed

  - `fix(explore):` procedure detail returns parameters. It filtered `information_schema.parameters` on a bare name where the column holds `name_oid`, so the list view reported a parameter count and the detail view always showed none — on every surface.
  - `fix(explore):` SQLite quotes identifiers at all raw-SQL sites. A single table named with an embedded quote broke listing, overview and detail for _unrelated_ tables.
  - `fix(explore):` MySQL table detail reads indexes and foreign keys from the requested schema rather than the connected database, which produced self-contradictory output with the real index missing.
  - `fix(explore):` `--schema` is honoured on the list commands, which declared it and ignored it.
  - `fix(explore):` the overview counts from the same listings the detail views use, inside one guarded call that surfaces errors, instead of a second implementation that disagreed and hardcoded several counters to zero.

- ba22246: ## TUI matches the CLI on gating and global modes

  ### Fixed

  - `fix(tui):` `db transfer` routes through the gated path with a typed confirmation. It called core directly, skipping the confirmation tier the SDK enforces.
  - `fix(tui):` the global dry-run toggle is honoured by transfer, truncate and teardown. The indicator showed dry-run as active while all three ran for real.
  - `fix(tui):` `truncateFirst` is a working control instead of state the UI could display but never change.
  - `fix(tui):` `vault propagate` is no longer a bare `p` keypress — it checks policy and names each recipient before granting access to every enrolled identity.
  - `fix(tui):` fixed 15 stale-closure dependency omissions across hooks and screens. `react-hooks/exhaustive-deps` is not enabled in this repo, so callbacks silently captured first-render values.
  - `fix(tui):` `InitScreen` no longer overwrites an existing `.noorm/.gitignore` on re-init.

- ba22246: ## Self-update input validation, log rotation and redaction

  ### Fixed

  - `fix(update)!:` the version string from the npm registry is validated as semver before it reaches a URL or a shell. It was interpolated verbatim, and because `fetch` normalises `..`, a poisoned dist-tag could relocate **both the binary and its `checksums.txt`** to an attacker-controlled repository — so checksum verification passed against the attacker's own file.
  - `fix(logger):` rotation reopens its write stream. It renamed the file out from under the open descriptor, so every subsequent write landed in the rotated file, `noorm.log` never reappeared, and rotation fired exactly once before growing unbounded.
  - `fix(logger):` `settings.logging.enabled`, `.file`, `.maxSize` and `.maxFiles` are honoured. The CLI hardcoded all four, so every logging setting was inert across every command — and the log viewer read a different path than the CLI wrote.
  - `fix(logger):` redaction covers this project's own variables. `NOORM_CONNECTION_PASSWORD` and `NOORM_IDENTITY_PRIVATE_KEY` were not masked, credential-bearing URIs passed through verbatim because values were never inspected, and `Error` objects were skipped wholesale. Log files are created `0600` rather than world-readable.

- 4751921: ## Access Roles

  Replace the per-config `protected: boolean` flag with per-channel access roles.

  **Breaking:** `Config.protected` is removed from the exported types and `access: ConfigAccess` is now required on `Config`/`ConfigSummary`. TypeScript consumers that read `.protected` or construct `Config` literals must move to `access`. Stored state auto-migrates on load (see below), so runtime configs are unaffected. (Released as `minor` under the `1.0.0-alpha` pre-release line, where `^` ranges pin within the alpha series; it is a breaking type change and will be treated as such at the 1.0 boundary.)

  - `feat(policy):` Configs now carry `access: { user, mcp }`, each `'viewer' | 'operator' | 'admin'` (or `mcp: false` to hide the config entirely). Roles are enforced by one policy matrix instead of scattered `protected` checks — `viewer` reads only, `operator` writes and confirms destructive operations, `admin` is frictionless. Enforcement runs at the core seam, so the SDK, TUI, and CLI all inherit it: `run`, `changes`, `transfer`, and the SQL terminal are gated, not just MCP.
  - `feat(mcp):` Every MCP command is now gated on `access.mcp` before it runs, closing the gap where `change_run`/`change_ff`/`change_revert`/`run_file`/`run_build` reached the database unchecked. `access.mcp: false` makes a config invisible to agents — absent from `list_configs`, and `connect` fails with the same error an unknown config produces. `confirm`-tier permissions collapse to a hard deny on the MCP channel (no human to type a confirmation phrase); give a config `mcp: 'admin'` if an agent legitimately needs to run changes there.
  - `feat(sql):` Raw SQL (`noorm sql`, MCP `sql`, the TUI SQL terminal) is now gated by what the statement actually does — classified `read`/`write`/`ddl` — instead of a blanket read-only check. Data-modifying CTEs (`WITH … AS (DELETE …) SELECT …`) and a denylist of side-effecting functions (`pg_terminate_backend`, `dblink_exec`, `query_to_xml`, … — bare or schema-qualified) classify as writes so a `viewer` cannot mutate through the read path. Multi-statement input takes the highest class present; unparseable input or `EXEC`/`CALL` classify as `ddl` (fail closed). The classifier guards against mutation, not disclosure — back hard confidentiality with database `GRANT`s.
  - `feat(sdk):` `createContext({ channel })` — defaults to `'user'`; set `'mcp'` when embedding the SDK behind an MCP-like surface. New exported types `Channel`, `ConfigAccess`, `Role`. `ProtectedConfigError` is now raised from `checkPolicy` denials/unconfirmable actions rather than a bare `protected` check; match on `err.name`/`instanceof`, not the message string (the message text changed).
  - **Behavior change:** on the `user` channel, `NOORM_YES=1` resolves an operator `confirm` to allow — including in the SDK guards. A migrated `protected: true` config becomes `operator`, so an SDK/CI caller with `NOORM_YES=1` set now _executes_ `truncate`/`teardown`/`reset`/`dt.import`/`changes.*`/`run.*` where the previous `protected` hard-block threw unconditionally. Unset `NOORM_YES` (or use `viewer`/`mcp:false`) where the block must hold.
  - `fix(config):` A legacy `protected: true` migrates automatically to `{ user: 'operator', mcp: 'viewer' }`, and `protected: false`/absent to `{ user: 'admin', mcp: 'admin' }`. The `protected` field is still accepted on `config import`/settings input for this release, then removed. Note: downgrading to a prior binary after this migration silently unprotects configs (older binaries have no access concept) — avoid rolling back once state is migrated.

- a18bfbe: ### Added

  - `feat(worker-bridge):` Worker thread infrastructure for parallel DT export/import. WorkerBridge class (ObserverRelay subclass), WorkerPool with round-robin dispatch, OrderBuffer for index-ordered reassembly.
  - `feat(workers):` Persistent Connection Worker (Kysely-backed DB operations) and stateless Compute Worker (serialize/deserialize) as standalone entry points.
  - `feat(dt):` Export and import pipelines now run through worker threads — Connection Worker handles DB queries, Compute Pool parallelizes CPU-bound serialization across N cores.
  - `feat(dt):` Three-tier progress events (`loaded`/`processed`/`saved`) for both export and import, enabling granular TUI progress display.
  - `feat(connection):` ConnectionManager tracks WorkerBridge instances alongside direct Kysely connections for coordinated shutdown.
  - `feat(cli):` `noorm dev/test-workers` diagnostic command for verifying worker thread infrastructure across execution contexts.
  - `build:` Worker entry points included in `bun build --compile` for single binary support.

### Patch Changes

- eb95caf: ## Added
  - `feat(ci):` Automated binary builds on release with install script
- dd7e387: ## Fixed
  - `fix(runner):` a third consecutive `run build` no longer re-executes a file the previous build correctly skipped — `skipped` was treated as "never ran" regardless of why, so an `unchanged` skip forced a re-run and failed on any DDL that is not idempotent
- 9673054: ## CLI

  ### Fixed

  - `fix(build):` Bundle all pure JS dependencies (meow, ink, react, pg, mysql2, tedious) - only better-sqlite3 remains external due to native bindings

- 01208ec: ## Fixed
  - `fix(cli):` Wire `noorm change ff --dry-run` (and `next` / `run` / `revert`) through to the SDK — the flag previously parsed but did nothing
  - `fix(cli):` Drop the unreachable positional `query` arg from `noorm sql` and add an argv rewriter so `noorm sql "SELECT 1"` is rewritten to `noorm sql query "SELECT 1"` before citty dispatch
  - `fix(cli):` Show `(dry-run)` markers in human output and `dryRun: true` in `--json` envelopes for all four change commands
- ba22246: Fix change apply/revert recovery, rewind flag handling, and MySQL support

  - Changes now run on MySQL at all. `ChangeHistory` retrieved insert ids with a `RETURNING` clause MySQL does not support, so no operation record was ever created and `change run`, `change ff`, `change revert` and `db teardown` were all inoperable.
  - A reverted or torn-down change can be applied again. Every file was previously skipped against a prior success, so `apply -> revert -> apply` and `db teardown -> change ff` reported success over an untouched database.
  - `ff` and `next` now treat `stale` changes as pending work, so teardown has a supported recovery path.
  - `change rewind` honours `--dry-run` and `--force`, and accepts the documented count form (`change rewind 3`). `changes.rewind()` takes an options argument.
  - A revert whose history cannot be read fails instead of reporting success over zero files.
  - `.sql.tmpl` files inside a change now receive `$.config` and `$.secrets`.
  - `.txt` manifests execute in the order they list files, instead of being sorted.
  - `ff`/`next` warn when the changes directory is missing rather than reporting a clean run.
  - `change list` marks orphaned changes and no longer lists the internal `__reset__` teardown marker.

- b22c1ec: ## CLI

  ### Fixed

  - `fix(build):` Add CJS compatibility shim for dynamic require in ESM bundle

- cb9f9c2: Display template errors during dry-run in UI feedback

  Template rendering errors during dry-run were silently captured in results but never emitted via the observer event system, making them invisible in the UI. Now `file:dry-run` events include status and error fields, and the progress hook properly tracks failed dry-runs.

- 0951b7e: ## Fixed
  - `fix(ci):` Pin bun to 1.3.11 in release binary workflow — bun 1.3.12 produces binaries that crash on startup (OOM kill, exit 137)
- ba9b358: Fix bundle: inject version at build time instead of requiring package.json
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

- 365f437: ## Connection

  ### Fixed

  - `fix(mssql):` Connection hangs when target database does not exist — now verifies via `sys.databases` on `master` first
  - `fix(mssql):` `ECONNRESET` on MSSQL Server 2022+ due to `encrypt: false` — now defaults to `encrypt: true`
  - `fix(mssql):` Tarn pool silently retries failed connections — enabled `propagateCreateError` for fast failure
  - `fix(connection):` Retry logic retried non-transient errors like `login failed` and `access denied`

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
- ef88aeb: ## Schema

  ### Fixed

  - `fix(schema):` MSSQL schema migration fails with `auto_increment` syntax error — use `identity(1,1)` instead
  - `fix(schema):` MSSQL schema migration fails when multiple `timestamp` columns exist — use `datetime2` for MSSQL
  - `fix(schema):` MySQL schema migration fails on `TEXT` columns with default values — use `varchar(2000)` for error messages
  - `fix(schema):` MySQL and MSSQL `DROP INDEX` requires `ON table_name` — made `down()` dialect-aware

- 3ef0007: fix(mssql): noorm db create / run no longer crash with "Pool is not a constructor"

  In the bundled CLI, `await import('tarn')` / `await import('tedious')` expose
  their exports under `.default`, so kysely's MSSQL dialect received an undefined
  `Pool` and every MSSQL command (`noorm db create`, `run`, `change`, etc.) failed
  with `Cannot connect to server: Pool is not a constructor`. Normalize the CJS
  interop, mirroring the postgres dialect.

- 431f9b9: ## Fixed
  - `fix(shutdown):` Force `process.exit()` after graceful shutdown to prevent process hanging from lingering connection pool handles
  - `fix(shutdown):` Remove duplicate `app:exit` emission that caused `unmount()` to fire twice
  - `fix(shutdown):` Clear timeout timer in connection close race to prevent 5-second event loop leak
- 715cddc: ### Fixed

  - `fix(teardown):` Schema-qualify all DROP statements in teardown to prevent failures when the connection user's default schema differs from `dbo` (MSSQL) or `public` (PostgreSQL)

- 66e6fb8: ### Fixed

  - `fix(teardown):` Sort composite types (TVPs) before domain types during teardown to prevent dependency failures on MSSQL, which lacks `DROP TYPE ... CASCADE`

- ba22246: ## MSSQL connects by IP address

  ### Fixed

  - `fix(connection):` connecting to MSSQL by IP address works again. Tedious derived the TLS SNI ServerName from the host, and Node rejects an IP literal there (RFC 6066), so every IP connection failed with `Setting the TLS ServerName to an IP address is not permitted`. Hostname connections are unchanged. Encryption stays on — the connection is never silently downgraded to plaintext to work around it.
  - `feat(connection):` new optional `connection.tlsServerName` — the hostname the server's TLS certificate is issued for. Required when connecting to an IP address with certificate validation enabled (`ssl` set), since a certificate cannot be validated against an IP. Without it, that combination now fails with an error naming the field instead of an opaque TLS error.

- a22973c: ## Fixed

  - `fix(change):` Use `settings.paths` from `settings.yml` for change directory resolution instead of per-config `activeConfig.paths`, matching the pattern used by runner screens

- ac0b3c1: Rebuild with complete bundling fixes
- 3ef0007: fix(cli): noorm db reset rebuilds cleanly regardless of preserveTables

  `noorm db reset` (teardown + build) honored `settings.teardown.preserveTables`
  during the teardown phase, so preserved tables (e.g. reference vocabulary kept
  for the `noorm db truncate` workflow) survived and then collided with the
  build's `CREATE TABLE`, aborting the rebuild and leaving a partial schema.
  `noorm db reset` now performs a full teardown that ignores `preserveTables` —
  a full rebuild starts from nothing. `noorm db teardown` and `noorm db truncate`
  still honor the setting.

- 01208ec: ## Fixed
  - `fix(cli):` Surface SQL errors and skip reasons in `run` and `change` output
  - `fix(cli):` `noorm run build` / `dir` / `files` / `exec` now print each failed file's driver error inline and route the summary through `logger.error` on non-success
  - `fix(cli):` `noorm run file` and the skip path now report `(skipped: <reason>)` so callers know whether the file was unchanged or already-run
  - `fix(cli):` `noorm change ff` / `run` / `revert` / `rewind` print per-change error detail on failure instead of just `(failed)`
- 8797eb4: ### Fixed

  - `fix(settings):` NOORM\_\* environment variables now override any settings.yml field (e.g. `NOORM_PATHS_SQL` overrides `paths.sql`)

- 3ef0007: fix(cli): noorm db teardown drops MSSQL CHECK constraints before functions

  `noorm db teardown` (and `noorm db reset`) aborted with MSSQL error 3729 on
  any schema where a scalar UDF is referenced by a CHECK constraint (the
  canonical base/subtype "IsType" pattern). Functions are dropped before tables
  to satisfy schema-bound dependents, which left the CHECK-constraint dependency
  intact. Teardown now severs it first by dropping all user-schema CHECK
  constraints (excluding the `noorm` schema) ahead of the function drops, so
  both schema-bound functions and CHECK-backed functions tear down cleanly.

- 6753ebd: Fix display of created-at timestamps and file sizes in the change list and change run screens.
- fbe7f24: ## Fixed
  - `fix(db):` `db transfer --no-fk` and `--no-identity` are honoured instead of being silently ignored — citty strips the `--no-` prefix and negates a flag of the remaining name, so the `noFk`/`noIdentity` args they were declared as could never receive a value
- 6782afd: ## Fixed
  - `fix(tui):` change operations now receive the active config's dialect — on sqlite and mysql the TUI queried postgres-shaped tracking tables, and the failed read surfaced as a successful no-op
  - `fix(tui):` the global dry-run and force toggles are now honoured by `ff`, `next`, `run`, `revert`, and `rewind` — dry-run was displayed as active while changes applied for real
  - `fix(tui):` core errors are surfaced as a toast instead of being written only to the log file
- f4fec5b: ## Fixed
  - `fix(run):` `run build` now names `build.include` entries that matched no files instead of reporting a plain success over zero files — include paths are relative to `paths.sql`, and the common `sql/01_tables` form silently matched nothing. `BatchResult` gains an optional `unmatchedInclude`.
- fdcbd6f: `fix(update):` the binary self-update no longer hangs indefinitely and now shows download progress. `noorm update` streamed the ~70MB release binary with a bare `fetch()` — no timeout, so a stalled connection hung forever with no error and no feedback, indistinguishable from a freeze. It now streams to disk with a live `Downloading X / Y MB (Z%)` readout, aborts with a clear error if the transfer stalls (no bytes for 30s), and stages the replacement in the target's own directory so the atomic swap can't fail with a cross-filesystem `EXDEV` (e.g. `os.tmpdir()` on a different volume than `~/.local/bin`).
- 8e3526f: `feat(update):` the binary self-update now resumes instead of restarting. When a download stalls or the connection drops, `noorm update` retries (up to 5 attempts with backoff) and resumes from the bytes already on disk via an HTTP range request — validated with `If-Range`/`ETag` so a changed asset restarts cleanly rather than stitching a stale prefix. A flaky connection now retries the tail, not the whole ~70MB. Permanent failures (e.g. `404`) still fail fast without retrying, and the CLI prints a `resuming (attempt N/M)` notice between attempts.
- ba22246: ## MySQL works

  ### Fixed

  - `fix(runner):` `run build` executes on MySQL. `createOperation` emitted a `RETURNING` clause MySQL has no support for, so the operation record was never created and **zero SQL files ran** — the command failed before touching a single file.
  - `fix(change):` `recordReset` no longer fails silently on MySQL. It swallowed the same error and returned `0`, so `db teardown` recorded nothing and reported no error at all.
  - `refactor(shared):` operation-record insertion is one dialect-aware helper. It existed as three independent copies, which is why fixing the runner left the change module broken and the same defect had to be found twice.

- 7a99a11: Add `noorm version` command for diagnostic output showing CLI version, identity paths, and project status
- b676799: Add state loading error output to version command for debugging
- d279232: ## Fixed

  - `fix(change):` Resolve change paths using `projectRoot` instead of bare relative paths, matching the SDK pattern
  - `fix(form):` Add Shift+Tab support for backward field navigation
  - `fix(config):` Guard ConfigImportScreen `useInput` handler with `isActive` to prevent focus interference
  - `fix(config):` Constrain ConfigEditScreen form height to terminal bounds with `overflowY="hidden"`
  - `fix(transfer):` Update aggregate `rowsTransferred` in real-time during dt:import and db-to-db transfers
  - `fix(transfer):` Prevent `dt:import:complete` from setting phase to `complete` prematurely during multi-file imports
  - `fix(transfer):` Show spinner instead of misleading 0% progress bar for same-server transfers

## 1.0.0-alpha.39

### Patch Changes

- 8e3526f: `feat(update):` the binary self-update now resumes instead of restarting. When a download stalls or the connection drops, `noorm update` retries (up to 5 attempts with backoff) and resumes from the bytes already on disk via an HTTP range request — validated with `If-Range`/`ETag` so a changed asset restarts cleanly rather than stitching a stale prefix. A flaky connection now retries the tail, not the whole ~70MB. Permanent failures (e.g. `404`) still fail fast without retrying, and the CLI prints a `resuming (attempt N/M)` notice between attempts.

## 1.0.0-alpha.38

### Patch Changes

- fdcbd6f: `fix(update):` the binary self-update no longer hangs indefinitely and now shows download progress. `noorm update` streamed the ~70MB release binary with a bare `fetch()` — no timeout, so a stalled connection hung forever with no error and no feedback, indistinguishable from a freeze. It now streams to disk with a live `Downloading X / Y MB (Z%)` readout, aborts with a clear error if the transfer stalls (no bytes for 30s), and stages the replacement in the target's own directory so the atomic swap can't fail with a cross-filesystem `EXDEV` (e.g. `os.tmpdir()` on a different volume than `~/.local/bin`).

## 1.0.0-alpha.37

### Minor Changes

- 4751921: ## Access Roles

  Replace the per-config `protected: boolean` flag with per-channel access roles.

  **Breaking:** `Config.protected` is removed from the exported types and `access: ConfigAccess` is now required on `Config`/`ConfigSummary`. TypeScript consumers that read `.protected` or construct `Config` literals must move to `access`. Stored state auto-migrates on load (see below), so runtime configs are unaffected. (Released as `minor` under the `1.0.0-alpha` pre-release line, where `^` ranges pin within the alpha series; it is a breaking type change and will be treated as such at the 1.0 boundary.)

  - `feat(policy):` Configs now carry `access: { user, mcp }`, each `'viewer' | 'operator' | 'admin'` (or `mcp: false` to hide the config entirely). Roles are enforced by one policy matrix instead of scattered `protected` checks — `viewer` reads only, `operator` writes and confirms destructive operations, `admin` is frictionless. Enforcement runs at the core seam, so the SDK, TUI, and CLI all inherit it: `run`, `changes`, `transfer`, and the SQL terminal are gated, not just MCP.
  - `feat(mcp):` Every MCP command is now gated on `access.mcp` before it runs, closing the gap where `change_run`/`change_ff`/`change_revert`/`run_file`/`run_build` reached the database unchecked. `access.mcp: false` makes a config invisible to agents — absent from `list_configs`, and `connect` fails with the same error an unknown config produces. `confirm`-tier permissions collapse to a hard deny on the MCP channel (no human to type a confirmation phrase); give a config `mcp: 'admin'` if an agent legitimately needs to run changes there.
  - `feat(sql):` Raw SQL (`noorm sql`, MCP `sql`, the TUI SQL terminal) is now gated by what the statement actually does — classified `read`/`write`/`ddl` — instead of a blanket read-only check. Data-modifying CTEs (`WITH … AS (DELETE …) SELECT …`) and a denylist of side-effecting functions (`pg_terminate_backend`, `dblink_exec`, `query_to_xml`, … — bare or schema-qualified) classify as writes so a `viewer` cannot mutate through the read path. Multi-statement input takes the highest class present; unparseable input or `EXEC`/`CALL` classify as `ddl` (fail closed). The classifier guards against mutation, not disclosure — back hard confidentiality with database `GRANT`s.
  - `feat(sdk):` `createContext({ channel })` — defaults to `'user'`; set `'mcp'` when embedding the SDK behind an MCP-like surface. New exported types `Channel`, `ConfigAccess`, `Role`. `ProtectedConfigError` is now raised from `checkPolicy` denials/unconfirmable actions rather than a bare `protected` check; match on `err.name`/`instanceof`, not the message string (the message text changed).
  - **Behavior change:** on the `user` channel, `NOORM_YES=1` resolves an operator `confirm` to allow — including in the SDK guards. A migrated `protected: true` config becomes `operator`, so an SDK/CI caller with `NOORM_YES=1` set now _executes_ `truncate`/`teardown`/`reset`/`dt.import`/`changes.*`/`run.*` where the previous `protected` hard-block threw unconditionally. Unset `NOORM_YES` (or use `viewer`/`mcp:false`) where the block must hold.
  - `fix(config):` A legacy `protected: true` migrates automatically to `{ user: 'operator', mcp: 'viewer' }`, and `protected: false`/absent to `{ user: 'admin', mcp: 'admin' }`. The `protected` field is still accepted on `config import`/settings input for this release, then removed. Note: downgrading to a prior binary after this migration silently unprotects configs (older binaries have no access concept) — avoid rolling back once state is migrated.

## 1.0.0-alpha.36

### Patch Changes

- 3ef0007: fix(mssql): noorm db create / run no longer crash with "Pool is not a constructor"

  In the bundled CLI, `await import('tarn')` / `await import('tedious')` expose
  their exports under `.default`, so kysely's MSSQL dialect received an undefined
  `Pool` and every MSSQL command (`noorm db create`, `run`, `change`, etc.) failed
  with `Cannot connect to server: Pool is not a constructor`. Normalize the CJS
  interop, mirroring the postgres dialect.

- 3ef0007: fix(cli): noorm db reset rebuilds cleanly regardless of preserveTables

  `noorm db reset` (teardown + build) honored `settings.teardown.preserveTables`
  during the teardown phase, so preserved tables (e.g. reference vocabulary kept
  for the `noorm db truncate` workflow) survived and then collided with the
  build's `CREATE TABLE`, aborting the rebuild and leaving a partial schema.
  `noorm db reset` now performs a full teardown that ignores `preserveTables` —
  a full rebuild starts from nothing. `noorm db teardown` and `noorm db truncate`
  still honor the setting.

- 3ef0007: fix(cli): noorm db teardown drops MSSQL CHECK constraints before functions

  `noorm db teardown` (and `noorm db reset`) aborted with MSSQL error 3729 on
  any schema where a scalar UDF is referenced by a CHECK constraint (the
  canonical base/subtype "IsType" pattern). Functions are dropped before tables
  to satisfy schema-bound dependents, which left the CHECK-constraint dependency
  intact. Teardown now severs it first by dropping all user-schema CHECK
  constraints (excluding the `noorm` schema) ahead of the function drops, so
  both schema-bound functions and CHECK-backed functions tear down cleanly.

## 1.0.0-alpha.35

### Minor Changes

- f522adc: ### Added

  - `feat(cli):` Add `noorm init --here` to initialize a project in the original cwd, ignoring any parent `.noorm/` discovered while walking up
  - `feat(cli):` Add global `-c <path>` / `--cwd <path>` flag (like `git -C`) that runs the subcommand inside `<path>` and skips the walk-up. Must precede the subcommand; after the subcommand `-c` keeps its per-command `--config` meaning.

  ### Changed

  - `refactor(cli):` `noorm init` now reports an existing `.noorm/` _before_ the TTY gate, so scripted invocations get the more actionable error.

- 01208ec: ## Added
  - `feat(cli):` Universal `--yes` / `-y` flag and `NOORM_YES=1` environment variable for TTY-gated commands. Unblocks CI, scripted bootstrap, and subagent flows.
  - `feat(cli):` `noorm init --yes` now succeeds in non-TTY environments when an identity already exists at `~/.noorm/identity.{key,pub,json}`. Without an identity, it errors with a hint pointing at `noorm identity init --name "X" --email "Y"`.
  - `feat(cli):` `noorm sql repl --yes`, `noorm settings edit --yes`, and `noorm settings secret --yes` print a documented redirect-hint error instead of refusing silently, telling the user which non-interactive alternative to use (`sql query` / direct YAML edit / `secret set`).

### Patch Changes

- 01208ec: ## Fixed
  - `fix(cli):` Wire `noorm change ff --dry-run` (and `next` / `run` / `revert`) through to the SDK — the flag previously parsed but did nothing
  - `fix(cli):` Drop the unreachable positional `query` arg from `noorm sql` and add an argv rewriter so `noorm sql "SELECT 1"` is rewritten to `noorm sql query "SELECT 1"` before citty dispatch
  - `fix(cli):` Show `(dry-run)` markers in human output and `dryRun: true` in `--json` envelopes for all four change commands
- 01208ec: ## Fixed
  - `fix(cli):` Surface SQL errors and skip reasons in `run` and `change` output
  - `fix(cli):` `noorm run build` / `dir` / `files` / `exec` now print each failed file's driver error inline and route the summary through `logger.error` on non-success
  - `fix(cli):` `noorm run file` and the skip path now report `(skipped: <reason>)` so callers know whether the file was unchanged or already-run
  - `fix(cli):` `noorm change ff` / `run` / `revert` / `rewind` print per-change error detail on failure instead of just `(failed)`

## 1.0.0-alpha.34

### Minor Changes

- 7b907b3: Introduce the `noorm ci` command namespace and retire the standalone `noorm identity ci` diagnostic.

  Four new commands cover the full CI lifecycle — mint a keypair, enroll it in a real database, bootstrap ephemeral state inside a job, and batch-load secrets:

  - `noorm ci identity new --name <str> --email <str>` — generate a test-CI keypair locally. No database contact, no state written. Prints the private key once plus a copy-pasteable `NOORM_IDENTITY_*` env block. Designed for stateless/ephemeral CI (`isTest` configs, throwaway databases). Accepts `--json`.
  - `noorm ci identity enroll --config <name> --name <str> --email <str> [--public-key <hex>]` — register a CI identity in the target database and propagate vault access to it. Run once by a developer with existing vault access. Decrypts the caller's vault key, inserts a new identity row (`machine='ci'`, `os='env'`), and re-encrypts the vault key for the new identity. Idempotent on identityHash — safe to re-run. When `--public-key` is omitted, mints a new keypair and returns the private key; when provided, only the public half is enrolled (air-gapped flow).
  - `noorm ci init [--name <str>] [--force]` — bootstrap ephemeral `state.enc` from `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` env vars. Runs inside the CI job. Creates a config (default: `ci`, override via `--name` or `NOORM_CI_CONFIG_NAME`), marks it active, sets `isTest: true`. Absorbs the former `noorm identity ci` precheck — fails fast with exit 1 if any required env var is missing or malformed, or if `state.enc` already exists without `--force`.
  - `noorm ci secrets --file <path> [--config <name>] [--overwrite]` — batch-load secrets from a dotenv-style file into the active (or `--config`-named) vault. Parser ignores blank lines and `#` comments, splits on the first `=`, and strips a single matched pair of surrounding quotes. Existing keys are skipped unless `--overwrite` is set (so reruns are safe). Exit codes: `0` clean, `1` precondition failure, `2` partial (some set, some errored).

  **Removed:** `noorm identity ci`. Its precheck behavior is now built into `noorm ci init`. Callers that used `identity ci` only for validation should replace it with `noorm ci init`, which does the validation plus the state bootstrap.

  **Migration:** replace any pipeline that set `NOORM_IDENTITY_*` + `NOORM_CONNECTION_*` and ran `noorm identity ci` followed by `noorm change ff` with:

  ```bash
  noorm ci init --name prod
  noorm change ff
  ```

  For vault-aware pipelines, provision the CI identity once from a developer machine:

  ```bash
  noorm ci identity enroll --config prod --name "CI Bot" --email ci@example.com
  # copy the printed NOORM_IDENTITY_* block into your CI secrets store
  ```

## 1.0.0-alpha.33

### Minor Changes

- e87c435: Rework `noorm change` for interactive-first ergonomics and drop the surprising bare-invocation side effect.

  - Bare `noorm change` now renders citty's help output and **does not connect to the database**. The status listing that used to live there moved to a new explicit leaf: `noorm change list`. This matches every other root command (`config`, `settings`, `identity`, `db`, `vault`, `secret`, `run`) and prevents accidental connection attempts when users are just exploring the CLI.
  - `change list` — new. Lists every known change with its status; accepts `--config`, `--json`.
  - `change edit [name]` — new. Resolves the change folder from settings and spawns `$EDITOR` (then `$VISUAL`, then `code`) with stdio inherited so terminal editors work in-place; exits with the editor's own exit code. Surfaces spawn failures (e.g. editor binary not found) instead of silently no-oping.
  - `change add [description]` — prompts for a description via `p.text` when omitted on a TTY.
  - `change rm [name]` — prompts for a change to delete, then confirms with `p.confirm`. `--yes` is no longer required on a TTY (it now just skips the confirm). On a non-TTY, both the name and `--yes` are still required so CI never deletes silently.
  - `change run [name]` — prompts from pending/reverted changes (filters `ctx.noorm.changes.status()` by `!orphaned && status in { pending, reverted }`).
  - `change revert [name]` — prompts from successfully applied changes.
  - `change rewind [name]` — prompts from successfully applied changes.
  - `change history-detail [name]` — prompts from changes with execution history (`status !== 'pending'`).

  In every case, non-TTY invocations without a name exit 1 with a uniform `Change name required…` error. User cancellation from any picker exits 1 with `Cancelled.`.

  **Migration:** replace `noorm change` with `noorm change list` in any scripts or CI jobs that relied on the status listing. The `--json` shape is unchanged.

## 1.0.0-alpha.32

### Minor Changes

- f946820: Add CI identity bootstrap and two interactive settings editors:

  - `noorm identity ci` — diagnostic command for CI environments. Bootstraps the process from `NOORM_IDENTITY_PRIVATE_KEY`, `NOORM_IDENTITY_NAME`, and `NOORM_IDENTITY_EMAIL` env vars, deriving the public key from the private key and computing a deterministic identity hash across runners. In-memory overrides for both private key and metadata replace `~/.noorm/` filesystem reads, so CI runners can decrypt vault/state without writing key files.
  - `noorm settings edit` — interactive editor covering all 7 settings sections: paths, build, strict, logging, stages, rules, teardown. Stages and rules use add/edit/remove sub-loops. Esc inside a sub-editor returns to the section picker; only Esc at the top level exits. Adds `setTeardown()` to `SettingsManager` and a `settings:teardown-updated` event.
  - `noorm settings secret` — interactive editor for universal and stage-scoped secret **requirements** (declarations, not values). Supports add, edit, remove, and list actions.

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
