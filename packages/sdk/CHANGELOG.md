# @noormdev/sdk

## 1.11.0

## 1.10.1

### Patch Changes

- ad42642: The TUI import preview shows the user and agent roles the import saves, and a `Test database` line when the file sets `isTest`, which gives every role at least admin's permissions on that config. The preview fits an 80x24 terminal with every TLS field set. The TUI export and delete screens judge a config by its effective roles, stage defaults included, as activation does.

## 1.10.0

### Minor Changes

- 80a8404: A config can name its CA, client certificate and client key by file path with `ssl.caFile`, `ssl.certFile` and `ssl.keyFile`, beside the inline `ca`, `cert` and `key`. noorm reads the files each time a pool opens, on every connect attempt, so a rotated certificate needs no config change, and stores the path, never the content. Stage defaults accept the file form. An unreadable, empty, oversized or non-PEM file fails with `SslFileError`, exported from `@noormdev/sdk`.

  Private CAs and client certificates work on PostgreSQL, MySQL and MSSQL. `tlsServerName` also works on MySQL, for hostnames only. Layers combine `ssl` field by field, so a stage `caFile` survives a stored `ssl: true`. The TUI add and edit forms set Use SSL, Verify Certificate (unchecked stores `ssl.rejectUnauthorized: false`), the three file paths and the TLS server name. The edit form shows the state in effect, with `(stage: <path>)` for a file the stage supplies, keeps connection fields it does not show, and leaves the stored `ssl` as it was when no SSL field changed. The config list tags a config `tls` or `tls unverified`. A certificate file error is not reported as a missing database.

  The TUI export carries every connection field that is not a credential, `tlsServerName`, `pool` and the timeouts included, and withholds `user`, `password` and the inline `ssl.key` and `ssl.cert`. The import saves those fields and previews the incoming TLS settings; certificate file paths must exist on the importing machine.

  Behavior changes:

  - TUI: connects with the stored config over its stage's defaults, as the CLI and SDK do. It applies no config variable (`NOORM_CONNECTION_*`, `NOORM_ACCESS_*`) and no flag to a config; settings variables still apply, so `NOORM_STAGES_<stage>_DEFAULTS_*` changes the stage defaults it merges, as `NOORM_PATHS_*` changes its paths. A TUI config whose stage sets a connection default the stored config lacks (`ssl`, `user`, `password`, `port`) connected without it and now uses it. A stage `isTest` or `type` likewise reaches build rules for a stored config that lacks the key; a stage `isTest` grants no permission. A stored value wins, and a stored `ssl: false` turns a stage's `ssl` off.
  - TUI: a stored config that does not combine with its stage into a valid config is not activated. Home shows the message and the config stays editable.
  - TUI export: an inline `ssl.key` and `ssl.cert` were written to the export file and are withheld.
  - A scalar `NOORM_CONNECTION_SSL` beside a nested `NOORM_CONNECTION_SSL_*` variable fails with a message that names both and says to set one form, not both.
  - MSSQL: `ssl: { rejectUnauthorized: false }` encrypts without validating the server certificate, as on PostgreSQL, and lifts the `tlsServerName` requirement for an IP host.
  - MySQL: `ssl: { rejectUnauthorized: false }` skips validation, where it validated before. A `tlsServerName` was ignored and now fails the connection when `ssl` is off, when `rejectUnauthorized` is `false`, when the name is an IP address, or when the certificate lacks the name.
  - MySQL and MSSQL: an inline `ca`, `cert` or `key` already in a config was ignored and is used. A `ca` replaces the default trust store.
  - A layer that sets `ssl` does not inherit a lower layer's `rejectUnauthorized`: an `ssl` object over a lower `{ rejectUnauthorized: false }` skipped validation on PostgreSQL and now validates. A higher `ssl: true` keeps the lower object's certificate fields, where it replaced the object. Set `rejectUnauthorized: false` in the higher layer to skip validation.
  - An SDK inline `ssl: undefined` keeps a lower layer's `ssl`.
  - An environment or inline `ssl` key spelled in another letter case, such as `CAFILE`, is refused with the right spelling.

  See [certificates](https://noorm.dev/dev/config#tls-certificates).

### Patch Changes

- 80a8404: `NOORM_ACCESS_USER` and `NOORM_ACCESS_AGENT` no longer change the access roles of a stored config. Before, `NOORM_ACCESS_USER=admin` replaced a stored restricted role, and `NOORM_ACCESS_AGENT` could turn a stored `agent: false` into a role, up to the stage's ceiling.

  - Behavior change: with a stored config selected, both variables are ignored, including a value that would narrow the role. Narrow a stored config in the config itself.
  - A config built from the environment alone (`NOORM_CONNECTION_*`, `config: false`) still takes its access roles from them.

- 80a8404: `ctx.impersonate()` closes its connection when the switch statement (`EXECUTE AS USER`, `SET ROLE`) or the revert statement (`REVERT`, `RESET ROLE`) fails, in callback and explicit mode. Before, callback mode returned the connection to the pool, where the next query could run as the impersonated principal, and a failed `scope.revert()` kept the connection checked out until `disconnect()`.

  - Behavior change: after a failed `scope.revert()` the scope is over. The call still rejects with the revert error; a later `revert()` does nothing, where it re-ran the statement before.
  - Behavior change: `disconnect()` during a callback-mode `impersonate()` rejects that call with `DisconnectedError` and closes its connection, as `withConnection` does. It waited for the callback before.

## 1.9.0

### Minor Changes

- f444065: On a trusted `isTest: true` config, every role, agents included, gets at least admin's permissions, so an agent can build and test against its own test database. Configs without `isTest` are unchanged.
- f444065: SDK connection controls, pool options for every pooled dialect, and a shorter first run in the TUI and CLI.

  - `createContext({ name })` names a context that uses no stored config. The name is `ctx.noorm.config.name` and the `configName` on events, and it keys change history, run checksums, locks and local secrets, so keep one name per database. It wins over `NOORM_NAME` and throws when a stored config is selected or has that name. A stage with the same name still applies its protected ceiling and `isTest: false`; stage defaults need `stage`.
  - `createContext({ config: false })` uses no stored config and ignores `NOORM_CONFIG` and the active config. `config` is now typed `string | false`, so a wrapper that reads `options.config` as a string needs to handle `false`.
  - `connection.driver` passes options through to `pg`, `mysql2`, or `tedious`. It is inline only: noorm does not store it or put it in its own events, though a driver's own validation error can quote a value. `createContext()` rejects keys that select the target, credentials, or TLS, and SQLite accepts none.
  - Pool options: `idleTimeoutMs` on PostgreSQL, MySQL and MSSQL; `maxLifetimeMs`, `maxUses` and `allowExitOnIdle` on PostgreSQL; `acquireTimeoutMs`, `createTimeoutMs` and `reapIntervalMs` on MySQL and MSSQL. They work in stored configs, as `NOORM_CONNECTION_POOL_*` variables, and inline, where `connection.pool` is typed per dialect. `pool.idleTimeoutMillis` stays as an alias of `pool.idleTimeoutMs`.
  - An inline or environment `pool.idleTimeoutMs` replaces a stored `pool.idleTimeoutMillis`, and the reverse. One source that sets both to different values fails validation.
  - Behavior change: a pool option the dialect cannot honor, and a pool key noorm does not know, now fail validation in stored configs, environment variables and inline. Both were dropped without an error before. An all-caps environment segment is lowercased, so `NOORM_CONNECTION_POOL_MAXUSES` fails with a message that names `NOORM_CONNECTION_POOL_maxUses`. SQLite still accepts `pool.min`, `pool.max` and `pool.idleTimeoutMillis`, unused.
  - Behavior change: `pool.min` above `pool.max` fails validation on PostgreSQL, MySQL and MSSQL. It passed validation before.
  - Behavior change: MySQL and MSSQL reject `pool.idleTimeoutMs: 0` (and the `idleTimeoutMillis` alias). A stored config with that value was accepted and ignored before.
  - Behavior change: MySQL pools through Tarn for a string password and a password callback alike, so `pool.min` and the Tarn options apply to both. A checkout that waits for a free connection now fails after `acquireTimeoutMs`, where mysql2's pool queued without a limit, and an idle connection is closed after Tarn's 30 second default when `idleTimeoutMs` is unset. `acquireTimeoutMs` and `createTimeoutMs` default to 30000, or to `connectTimeoutMs` plus 5000 when that is larger, on MySQL and MSSQL.
  - `keepAliveInitialDelayMs` sets how long a PostgreSQL or MySQL socket stays idle before the first TCP keepalive probe. MSSQL and SQLite reject it.
  - Behavior change: `keepAlive: false` turns TCP keepalive off on MySQL. It was ignored there before, and mysql2 enables keepalive by default.
  - Inline `connection.pool` is typed per dialect, so an unsupported pool option on an inline connection with a literal `dialect` is now a compile error. SQLite keeps `min` and `max`.
  - Behavior change: with a password callback, a driver or server failure during `connect()` is thrown as `DatabaseConnectionError` with the original error as `cause` and the server code kept. Before, the driver's error came back untranslated. What the callback itself throws still comes back unchanged, including a value that is not an `Error`.
  - `connection:error` has a new `phase: 'login'`, emitted on PostgreSQL, MySQL and MSSQL when a physical connect the pool makes after its first successful one fails. The query still rejects to its caller.
  - The SDK entry exports `DatabaseConnectionError`, `DisconnectedError`, `ResetBuildError`, `VersionMismatchError`, `MigrationError`, and the types `ConnectionRetryOptions`, `DialectConnectionConfig`, `InlineConnection`, `PinnedConnection`, `PoolOpts`, `PgPoolOpts`, `TarnPoolOpts`, `MysqlPoolOpts` and `MssqlPoolOpts`.
  - TUI: `Ctrl+S` on the config add and edit forms saves without testing the connection. The normal save still tests, and a failed test names `Ctrl+S`.
  - TUI: opening config add or config import without an identity shows identity setup first, filled in from git, then continues to the form.
  - CLI: `noorm identity init` takes `--name` and `--email` as optional and defaults them from `git config`. It exits 1 and asks for `--email` when no email can be determined.
  - `ctx.withConnection(fn)` pins one connection for a callback, and `connection.discard()` closes it on release instead of returning it to the pool, so a session that stopped answering does not keep its advisory locks.
  - Behavior change: identity setup in the TUI and in `noorm init` keeps an existing `~/.noorm/identity.key`. With only the private key present it derives `identity.pub` and writes `identity.json`; before, it generated a new keypair over the key, which made existing encrypted state unreadable. `noorm identity init` without `--force` does the same and reports `completedExistingKey: true` in `--json`; it exits 1 only when all three files exist, and `--force --yes` is the one way it replaces a key.
  - Resolving a stored config with inline or environment overrides no longer changes the stored record in memory, so a later save cannot persist the overrides.
  - CLI: `--dry-run` no longer creates noorm's tracking tables on a database that has none, on every command that takes it, and `ctx.noorm.pipelines.run(slug, { dryRun: true })` does the same. A dry run against tracking tables that need a migration exits 1 with `tracking tables are at schema version N and this version needs M. A dry run does not migrate them: run a command without --dry-run first, such as "noorm change history".` Before, it migrated them.
  - CLI and TUI: a role the policy denies every tracked write (a `viewer`) no longer creates or migrates the tracking tables. On the agent channel a `confirm` cell counts as denied, because an agent cannot confirm. Read commands and screens for such a role treat a database without the tables as empty: no changes applied, no lock, no pipeline runs. On tables that need a migration the CLI exits 1, and the TUI shows the same message, saying a role that can write must run a command first. The TUI created the tables for every role when it opened.
  - `noorm config use` and TUI config activation follow the same rule: for a role that cannot write they create and migrate no tracking tables and register no identity in the database. Both did so for every role before. On the agent channel, `noorm config use` exits 1 on a config with `agent: false` and leaves the active config unchanged.
  - Behavior change: SDK run and change methods called with `dryRun` or `preview` throw the same dry-run error on tracking tables that need a migration. They skipped the version check before.
  - TUI: the vault add and delete screens refuse a role denied `vault:read` or `vault:write` when they open, and open no connection. They connected first and refused on save before.
  - `ctx.noorm.lock.status()`, `ctx.noorm.pipelines.history()` and `getRun()` return unlocked, `[]` and `null` on a database with no tracking tables. `status()` threw there before, and the pipeline readers created the tables.
  - Behavior change: `ctx.noorm.pipelines.history()` and `getRun()`, and the TUI pipeline history, no longer migrate older tracking tables. They throw an error that names both schema versions; a command that writes migrates them. `ctx.noorm.lock.status()`, `ctx.noorm.changes.history()` and `historyForChange()` throw the same error there; they queried the older layout before.
  - Behavior change: `ctx.noorm.lock.status()` and `noorm lock status` delete an expired lock only for a role with `lock:acquire`, and are refused on a config hidden from the caller's channel (`agent: false`). Both deleted the row and answered for every caller before.
  - Behavior change: `noorm change revert <name> --dry-run`, and `ctx.noorm.changes.revert(name)` with `dryRun` or `preview`, fail with `ChangeNotAppliedError` for a change that was never applied, as the real revert does. They reported success before.
  - `ctx.noorm.pipelines.run()` works on a context created with `freshState: true`. It read the project's shared state and settings instead of the context's own and threw `SettingsManager not loaded`.
  - `noorm vault cp --dry-run` reports `No vault access on source config` when the source database has no tracking tables. It failed with a SQL error before.
  - `noorm init` and TUI init list only the files they created. Both listed `.noorm/state/state.enc`, which is written when the first config is saved, and the TUI listed `sql/.gitkeep` for a project laid out under `db/`.
  - TUI: regenerating an identity copies `identity.key`, `identity.pub` and `identity.json` to `<file>.bak-<timestamp>` in `~/.noorm/` before replacing them, refuses when the backup cannot be written, and shows the backup paths. Before, it replaced the key with no backup.
  - Behavior change: `ctx.noorm.lock.acquire()`, `withLock()` and `release()`, `noorm lock acquire` and `noorm lock release`, and the TUI acquire and release screens check a new `lock:acquire` permission (viewer deny, operator and admin allow) before creating tracking tables or taking a lock. They were ungated before. The TUI force-release screen now refuses a role that `lock:force` denies, and a refused TUI lock screen opens no connection. Where the role's `lock:acquire` or `lock:force` cell is `confirm`, the TUI acquire, release and force screens ask for the confirmation phrase.
  - Behavior change: `noorm identity init` exits 1 when `NOORM_IDENTITY_PRIVATE_KEY` is set and no `identity.key` exists. It wrote `identity.pub` with no key file and reported `Identity created.` before.
  - Behavior change: a context with no stored config selected is refused when `NOORM_NAME` (or the `__inline__` / `__env__` fallback) is the name of a stored config, as `createContext({ name })` already was, because secrets and tracking records are keyed by name. Select the stored config with `NOORM_CONFIG=<name>` or the `config` option, or use another name. With a stored config selected, `NOORM_NAME` can no longer rename the context to another stored config's name.
  - A role with `vault:read` counts as able to record to the tracking tables, because a vault reader is enrolled in the identities table. On PostgreSQL a login that cannot see the `noorm` schema reads as having no tracking tables instead of failing.

### Patch Changes

- f444065: SDK runs and changes create noorm's tracking tables when the database has none, so `run.build()`, `changes.ff()` and `db.reset()` work on a fresh database without a prior `noorm run build`. `db.reset()` now resolves with the build result and throws `ResetBuildError` when the rebuild fails; before, a failed rebuild resolved as if it had succeeded.

  `db.reset()` checks the tracking schema version and reads the schema directory before it drops anything, so a newer tracking schema or an unreadable `db/sql` leaves the database untouched. `lock.acquire`, `lock.withLock` and `vault.init` also create the tracking tables on a fresh database.

## 1.8.0

### Minor Changes

- 622116b: Configs with `isTest: true` allow the database lifecycle operations (`db create`, `truncate`, `teardown`, `drop`) for every role on both channels, without confirmation, so test harnesses launched from an agent session can drop and recreate their own database. `db reset` still needs `--yes` and `run:build`. `noorm ci init --test` is now refused on the agent channel. Where the flag counts is in [access roles](https://noorm.dev/guide/environments/configs#access-roles).
- 622116b: Support project-defined access roles and partial overrides of built-in viewer, operator, and admin permissions. Resolve inherited permissions consistently across guarded noorm APIs and preserve immutable protected-stage ceilings. Built-in defaults, including operator DML access, remain unchanged without explicit overrides.

  The SDK `Role` type accepts custom role names. Resolved configs carry non-enumerable policy context; detached copies without it are denied by guarded operations. Malformed stored access is preserved for diagnosis and repair rather than silently replaced.

  Vault set, propagate, copy, and identity enrollment require `vault:read` when they unseal an existing vault key. Secret writes do not require secret read, and initializing a fresh vault can use write-only access.

  Manage role definitions in the TUI under Settings → Access Roles. Create custom roles, edit inheritance and permission overrides, preview effective permissions and protected-stage ceilings, reset built-in overrides, and remove unused custom roles with confirmation.

  Display the TUI Settings overview as a responsive table with separate section, purpose, and current-value columns. Preserve number-key navigation and keep long values from shifting adjacent columns.

  Upgrade the stdio MCP server to protocol 2026-07-28 with discovery, per-request metadata, scoped human approval through form elicitation, JSON database exploration resources, and eight user-selected prompt cookbooks, including headless automation and test/deployment CI. Database calls require an explicit config; legacy initialization and MCP connect/disconnect/status commands are no longer supported. Approvals are short-lived, single-use, and bound to the request, target, effective policy, and captured executable content. Agent CLI confirm permissions remain denied even with yes flags; human confirmation paths remain available.

  Approved template changes retain the checksum of the captured source while executing the captured rendered SQL, so subsequent ordinary change runs recognize unchanged templates. Ordinary file runs continue tracking rendered output.

  Check every SQL permission represented in a batch, including nested writes, before execution. Allowed DDL cannot mask denied writes or skip required write confirmation.

  MCP migration: replace `run_noorm_cmd` with the individual tool named by `command`, moving `payload` fields alongside `config`. Replace `noorm_help` with `tools/list` and its schemas. The old tools have been removed. Clients must support the modern revision and pass an explicit config instead of establishing a database session.

  The read permissions `explore` and `sql:read` apply to the agent channel only; the user channel always reads them as allowed. On the agent channel, `explore` now gates every schema read and change-history read in the CLI, SDK, and MCP, including the table listing behind `db transfer --export` when `--tables` is omitted. `db.previewTeardown()` checks `db:teardown` the way `teardown({ dryRun: true })` does; a role that may not tear down cannot preview. A protected stage keeps its ceiling when the caller passes an explicit `stage`, when a config is copied or renamed to an unprotected name (now refused), and on SDK transfer and vault destinations. MCP approvals redact only the password and SSL material; user and database names stay visible. When the active config has malformed access, the TUI stays usable and Home names `noorm config repair-access <name>`.

  Named SQL pipelines have their own `pipeline:run` permission (viewer deny, operator confirm, admin allow) instead of borrowing `run:dir`, so a role can run pipelines without directory runs and the reverse. On the agent channel, `pipelines.history`, `getRun`, and `noorm pipeline history`/`show` now require `explore`.

- 622116b: Allow runtime password callbacks for fresh physical connections in PostgreSQL, MySQL, and SQL Server. Preserve credential-provider errors, sanitize observer events, and bundle the pool dependency required by MySQL and SQL Server.

  Release PostgreSQL authentication sockets when a credential callback rejects, preserving the original error without leaving a failed connection alive.

- 622116b: Allow non-persisted per-context connection overrides without a stored config. Inline connections ignore the active stored config unless a stored base is selected through `config` or `NOORM_CONFIG`, preventing inherited access roles and test clearance.
- 622116b: Expose PostgreSQL idle, statement and query timeouts, application name, and TCP keepalive.
- 622116b: Verify explicit PostgreSQL TLS identities across tunnels and support runtime identity callbacks.
- 622116b: Add SQL pipelines for named workflows with typed inputs, dependency-aware execution, transaction boundaries, and independent config-scoped history through the CLI and SDK. Add native terminal screens for definition review, explicit typed input overrides, protected run and dry-run confirmation, settled execution and transaction evidence, and bounded history or run-ID lookup without a local definition. Pipeline stop and managed shutdown wait for active work and bookkeeping without promising server-side cancellation; cleanup warnings preserve recorded outcomes and nonzero shutdown status.

  Pipelines move the tracking schema to version 3, which adds the pipeline run and step tables. The move is one way. An older CLI or TUI that connects to a version 3 database fails with `VersionMismatchError`, so upgrade them before the first connect. An older SDK keeps working and ignores the pipeline tables, except that `vault.copy` to a version 3 destination throws `VersionMismatchError`. A pipeline run checks that a step did not end the managed transaction, which needs PostgreSQL 13 or later and SQL Server 2016 or later.

  The TUI shutdown screen now marks phases that timed out and says that a second `Ctrl+C` forces exit. A timed-out phase, a failed cleanup, or a forced exit leaves the process with a nonzero exit code. Shutdown no longer replaces an exit code already set with `0`.

### Patch Changes

- 622116b: Use native nested environment configuration with camelCase field segments, preserve password strings, and validate the effective CLI connection without persisting runtime overrides.
- 622116b: Provide a CommonJS SDK runtime with an ESM facade that shares its constructors and observer. Load optional database drivers through lazy CommonJS wrappers so CommonJS test runners can connect without experimental VM modules. Publish one canonical set of ESM declarations with a CommonJS re-export facade so mixed CommonJS and ESM consumers share Context, namespace, and error types. Declarations reference Kysely's ESM types, so `ctx.kysely` type-checks with your own `kysely` imports such as `sql`; in CommonJS files compiled with `module: node16` or later (`node18`, `node20`, `nodenext`), Kysely types imported there do not match `ctx.kysely`.
- 622116b: Report idle and checked-out PostgreSQL connection failures to the observer without exposing driver error details. Keep pinned sessions on their original connection so subsequent queries reject instead of silently retrying, and retain the pool's disposal of broken clients.

## 1.7.0

### Minor Changes

- a043454: The handle `ctx.transaction(fn)` passes to `fn` now carries typed `proc`, `func`, and `tvf` that run on the transaction's connection, so a routine call runs under a `SET LOCAL statement_timeout` set earlier in the same transaction and rolls back with the transaction. `scope.transaction(fn)` on an impersonated scope passes a handle of the same type. The handle's type, `TransactionScope`, and the `RoutineCalls` interface are exported. On Postgres, `ImpersonatedScope.proc` now retries a `CALL` against a function as `SELECT * FROM`, as `ctx.proc` already did; before, it threw.

## 1.6.1

### Patch Changes

- 94aa38d: `db/AGENTS.md` written by `noorm init` now states that `sql/` is the current state of the schema and `changes/` brings existing databases, production included, up to that state. An existing `db/AGENTS.md` is left as is.

## 1.6.0

### Minor Changes

- d497028: `noorm init` now creates `db/sql/` and `db/changes/` instead of `sql/` and `changes/`, and writes `db/AGENTS.md` and `db/CLAUDE.md`. `AGENTS.md` points coding agents at the `/noorm` skill and points data modeling at ignatius and its `/ignatius-modeling` skill. It also leaves a marker for your own steering. `CLAUDE.md` imports `AGENTS.md`. Neither file is overwritten on re-init. Overwriting a settings file (`noorm init --force`, `noorm settings init --force`) keeps the `paths` already in it. The `noorm` skill now states what `sql/` and `changes/` are for, which edits belong in each, how to reference `sql/` files from a change with a `.txt` manifest, and when to use a `.sql.tmpl`.

  The built-in default for `paths.sql` and `paths.changes` is now `./db/sql` and `./db/changes`, matching what `noorm init` creates. `noorm init` writes `paths` into `settings.yml`, so an initialized project keeps its layout. A project laid out at `./sql` and `./changes` whose `settings.yml` is missing, empty, or has no `paths` key now resolves to `./db/sql` and `./db/changes`. Add `paths: { sql: ./sql, changes: ./changes }` to `settings.yml`, or set `NOORM_PATHS_SQL` and `NOORM_PATHS_CHANGES`.

- 6dbc2e3: After a successful update, `noorm update` offers the noorm agent skill. It runs `npx skills add noormdev/noorm/skills` when `npx` is on `PATH`, else `gh skill install noormdev/noorm skills/noorm` (GitHub CLI 2.90 or newer). With neither, or when the command fails, it prints both commands and where to get Node.js and the GitHub CLI. On a terminal it asks first; piped output prints the command instead, and `--json` skips the offer. A declined or failed skill install does not change the exit code.

  On a terminal, `noorm update` now rewrites its status line in place: `Checking for updates...` is replaced by the result, and the download counter ends on `Downloaded X MB (100%)`. `noorm update --json` now writes only the JSON document to stdout; before, status lines preceded it.

### Patch Changes

- 6dbc2e3: A change file with more than one statement now runs every statement on SQLite, and `GO` batch separators in change files are honored on SQL Server, as they already were for `sql/` files. Before, SQLite ran only the first statement of a change file and reported success.
- 6dbc2e3: `noorm change ff` and `change next` now fail at the position of a change folder that cannot be parsed when they would run it (never run, `reverted`, or `stale`), for example a `.txt` manifest that names a file no longer in `sql/`. Before, the folder was skipped, later changes ran without it, and the command exited 0. `change list` shows such a change as `failed` with the parse error, the TUI change screens and home count include it, `changes.pending()` returns it, and `change run <name>` reports the parse error instead of "Change not found". An applied change keeps its status, and the batch adds a warning instead of failing. A folder with neither `change/` nor `revert/` is not a change and is ignored.

## 1.5.1

### Patch Changes

- 0fcc257: Decide which files to skip with one or two tracking queries per batch instead of one or two per file. Skipped files no longer write execution rows, and a build where nothing changed writes no operation record. The SDK's `run.file(path, { preview: true })` now renders without executing. The TUI's re-run confirmation now finds earlier runs.

## 1.5.0

### Minor Changes

- d9b9efd: Show what a long-running SQL file is doing. After 10 seconds the runner asks the server about the file's session every 10 seconds, from a second pooled connection, and emits `file:progress`: elapsed time, the command's own progress (PostgreSQL `pg_stat_progress_*`, SQL Server `percent_complete`, MySQL stage counters), and the sessions it is waiting on. The TUI run and change screens render it under the running file, and the log records it. Build and exec runs in the TUI cancel on a second `Escape` within 2 seconds; PostgreSQL and MySQL stop the running statement on the server.

### Patch Changes

- d8398bd: Say why a database connection failed: refused port, unknown host, timeout, rejected TLS certificate, disabled, locked, or expired account, missing grant, connection limit, missing password, and SQLite file or directory faults. Where the server withholds the reason (SQL Server 18456, PostgreSQL 28P01, MySQL 1045), the message says so and lists the usual causes. Exhausted retries report the server's last error. `connection:error` log entries carry `serverCode` and `serverMessage`.
- d8398bd: Let MSSQL logins without server-level access connect. Connecting no longer detours through `master` to look the target up in `sys.databases`, so contained database users (the usual account on Azure SQL Database) and logins without `VIEW ANY DATABASE` can connect, and the config add/edit connection test passes for them. A database that is missing, or that the login cannot open, now fails with that reason instead of "Login failed".
- d799b13: Stop TUI lists from leaving stale rows on screen when two rows share an identity: explore indexes and foreign keys whose names repeat across tables (SQL Server's `IX_UserId`, MySQL's `PRIMARY`), PostgreSQL function and procedure overloads, and settings rules with the same description. `listFunctions` and `listProcedures` now return a `signature` on PostgreSQL that tells overloads apart.

## 1.4.2

### Patch Changes

- bca3052: Say why a database connection failed: refused port, unknown host, timeout, rejected TLS certificate, disabled, locked, or expired account, missing grant, connection limit, missing password, and SQLite file or directory faults. Where the server withholds the reason (SQL Server 18456, PostgreSQL 28P01, MySQL 1045), the message says so and lists the usual causes. Exhausted retries report the server's last error. `connection:error` log entries carry `serverCode` and `serverMessage`.
- bca3052: Let MSSQL logins without server-level access connect. Connecting no longer detours through `master` to look the target up in `sys.databases`, so contained database users (the usual account on Azure SQL Database) and logins without `VIEW ANY DATABASE` can connect, and the config add/edit connection test passes for them. A database that is missing, or that the login cannot open, now fails with that reason instead of "Login failed".
- 8e8df92: Stop TUI lists from leaving stale rows on screen when two rows share an identity: explore indexes and foreign keys whose names repeat across tables (SQL Server's `IX_UserId`, MySQL's `PRIMARY`), PostgreSQL function and procedure overloads, and settings rules with the same description. `listFunctions` and `listProcedures` now return a `signature` on PostgreSQL that tells overloads apart.

## 1.4.1

## 1.4.0

## 1.3.0

## 1.2.0

### Minor Changes

- bab7dfc: ## Connection

  ### Added

  - `feat(db):` Connections now carry a connect timeout, so an unreachable host fails instead of hanging forever. Defaults to 15s; set `connection.connectTimeoutMs` per config to raise it for a database that resumes from an auto-paused state.

## 1.1.0

### Minor Changes

- 1fafd16: ## Added

  - `feat(sdk):` `ctx.withSchema<SDB>(name)` — derive a `Context` scoped to one schema, sharing the parent's connection, pool, and lifecycle
  - `feat(sdk):` `proc`/`func`/`tvf` calls through a derived context are automatically qualified with the schema name, unless the caller already passed a dotted name
  - `feat(sdk):` `transaction()` and `impersonate()` compose with a derived context — both stay scoped to the derived schema

## 1.0.2

### Patch Changes

- 38d7c73: Put `types` first in the package exports map

  Export conditions are matched in order, so `types` sitting after `import` is
  resolvable only by luck — it works today because there is no `require`
  condition to shadow it, and would silently stop working the moment one was
  added. `publint` reports it as an error. Also normalized both packages'
  `repository.url` to the full `git+https://…​.git` form npm expects.

## 1.0.1

### Patch Changes

- d1e958d: Put `types` first in the package exports map

  Export conditions are matched in order, so `types` sitting after `import` is
  resolvable only by luck — it works today because there is no `require`
  condition to shadow it, and would silently stop working the moment one was
  added. `publint` reports it as an error. Also normalized both packages'
  `repository.url` to the full `git+https://…​.git` form npm expects.

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

- 8749127: ### Added

  - `feat(sdk):` Add `ctx.tvf()` method for calling table-valued functions on MSSQL and PostgreSQL
  - `feat(sdk):` Add `Tvfs` generic parameter to `createContext()`, `Context`, and `ImpersonatedScope` for type-safe TVF signatures

  ### Changed

  - `refactor(sdk):` Replace `as any` casts in impersonation scope with proper generic flow through `buildProcCall<T>`, `buildFuncCall<T>`, and `buildTvfCall<T>`

- 06d799b: ## DT Format

  ### Added

  - `feat(dt):` Add `text` encoded type for large TEXT columns with smart gz64 compression
  - `feat(dt):` Map MSSQL `nvarchar(max)` and `varchar(max)` to `text` encoded type
  - `feat(dt):` Detect `(max)` suffix in MSSQL schema introspection via `max_length = -1`

  ### Changed

  - `refactor(dt):` MySQL `text`, `mediumtext`, `longtext` now map to `text` (was `string`); `tinytext` stays `string`
  - `refactor(dt):` MSSQL `text`, `ntext` now map to `text` (was `string`)

- 850b2d3: ## Added

  - `feat(change):` Expose `change next` on the SDK for programmatic access to the next pending change

- a4d7308: ## Added
  - `feat(tvp):` Make `TvpValue` and `tvp()` generic — `TvpValue<T>` preserves row types through proc, func, and tvf signatures so the compiler catches column mismatches at call sites
- 1dc22b3: ## Added

  - `feat(sdk):` Per-request user impersonation via `ctx.impersonate()` — borrow a dedicated pool connection, switch database identity, and run queries as a specific principal with guaranteed revert
  - `feat(sdk):` Callback mode (auto-reverts on completion or throw) and explicit mode (caller-managed lifecycle for cross-boundary use cases like Hapi request hooks)
  - `feat(sdk):` MSSQL (`EXECUTE AS USER` / `REVERT`) and PostgreSQL (`SET ROLE` / `RESET ROLE`) dialect support with SQL injection prevention via username validation and dialect-specific quoting

- 01208ec: ## Added

  - `feat(runner):` Split MSSQL SQL files on the `GO` batch separator. Multi-statement DDL files (multiple `CREATE PROCEDURE` / `CREATE FUNCTION` / `CREATE TRIGGER` / `CREATE VIEW` / `CREATE TYPE` in one file) now run correctly instead of failing with `Incorrect syntax near 'GO'`.
  - `feat(runner):` Batch failures report the failed batch index in `FileResult.error` (e.g. `[batch 3 of 5] <driver error>`) and short-circuit the remaining batches.

  ## Known limitations

  - `GO` inside string literals or block comments is still treated as a separator — matches `sqlcmd` behavior. Document accordingly when authoring T-SQL files.
  - `GO <N>` repetition is not implemented.

- 66e6fb8: ### Added

  - `feat(sdk):` Add TVP (table-valued parameter) support for MSSQL via `tvp()` helper — pass structured tabular data to `ctx.proc()`, `ctx.func()`, and `ctx.tvf()` calls
  - `feat(sdk):` Validate TVP row key consistency and enforce MSSQL's 2,100 parameter limit with clear error messages

- df24197: ## Added
  - `feat(sdk):` Support `[Args, ReturnType]` tuple definitions for procs, functions, and TVFs — return types are inferred automatically, with explicit override still available
- ba22246: ## Schema exploration answers about the object you asked for

  ### Fixed

  - `fix(explore):` procedure detail returns parameters. It filtered `information_schema.parameters` on a bare name where the column holds `name_oid`, so the list view reported a parameter count and the detail view always showed none — on every surface.
  - `fix(explore):` SQLite quotes identifiers at all raw-SQL sites. A single table named with an embedded quote broke listing, overview and detail for _unrelated_ tables.
  - `fix(explore):` MySQL table detail reads indexes and foreign keys from the requested schema rather than the connected database, which produced self-contradictory output with the real index missing.
  - `fix(explore):` `--schema` is honoured on the list commands, which declared it and ignored it.
  - `fix(explore):` the overview counts from the same listings the detail views use, inside one guarded call that surfaces errors, instead of a second implementation that disagreed and hardcoded several counters to zero.

- 4f4967c: ## API/Services

  ### Fixed

  - `fix(sdk):` `db.truncate()` and `db.teardown()` now respect `settings.teardown.preserveTables` and `postScript` from settings.yml
  - `fix(sdk):` `db.truncate()` accepts optional `TruncateOptions` — user-provided `preserve`/`only` take priority over settings fallback

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

- dd7e387: ## Fixed
  - `fix(runner):` a third consecutive `run build` no longer re-executes a file the previous build correctly skipped — `skipped` was treated as "never ran" regardless of why, so an `unchanged` skip forced a re-run and failed on any DDL that is not idempotent
- 8797eb4: ### Fixed

  - `fix(settings):` NOORM\_\* environment variables now override any settings.yml field (e.g. `NOORM_PATHS_SQL` overrides `paths.sql`)

- 01208ec: ## Changed
  - `feat(sdk):` `changes.ff(options?)` and `changes.next(count, options?)` now accept `BatchChangeOptions` so callers can pass `dryRun` / `force`. Previously the options were silently dropped before reaching the manager.
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

- 18e36b6: ## Fixed
  - `fix(mssql):` Resolve SQL Server failures in runner and change tracking operations
  - `fix(mssql):` Add `OUTPUT inserted.id` support for MSSQL insert operations
  - `fix(mssql):` Translate `.limit()` to `TOP` via MssqlLimitPlugin
  - `fix(schema):` Make v2 migration fully idempotent with partial-state recovery
  - `fix(runner):` Handle `AggregateError` and non-standard error objects from tedious driver
- 3ef0007: fix(mssql): construct tarn/tedious through CJS-interop guard in bundles

  When the SDK is bundled (tsup), `await import('tarn')` / `await import('tedious')`
  expose their exports under `.default`, so spreading the namespace left
  `tarn.Pool` undefined and kysely threw `Pool is not a constructor` on every
  MSSQL connection. Normalize both with `module.default ?? module`, mirroring the
  postgres dialect's existing guard.

- 8b20702: ### Fixed

  - `fix(sdk):` Bundle all runtime dependencies — resolves `Cannot find package 'json5'` and similar errors when importing the SDK
  - `fix(sdk):` Add `createRequire` banner for CJS packages that use `require('process')` in ESM bundles
  - `fix(template):` Resolve `$helpers` loading in compiled binaries via `Bun.build()` bundling

  ### Changed

  - `perf(sdk):` Lazy-load template data parsers (JSON5, YAML, CSV) — heavy parser libraries are now deferred until first use, reducing SDK startup time
  - `perf(sdk):` Replace `voca` dependency with inline `camelCase` implementation (~1500 lines removed from bundle)
  - `perf(sdk):` Stub `ansis` terminal color library — SDK consumers don't need ANSI output

- 715cddc: ### Fixed

  - `fix(teardown):` Schema-qualify all DROP statements in `db.teardown()` to prevent failures when the connection user's default schema differs from `dbo` (MSSQL) or `public` (PostgreSQL)

- 66e6fb8: ### Fixed

  - `fix(teardown):` Sort composite types (TVPs) before domain types during teardown to prevent dependency failures on MSSQL, which lacks `DROP TYPE ... CASCADE`

- fff443a: ### Fixed
  - `fix(sdk):` Add integration and unit tests verifying `db.truncate()` and `db.teardown()` respect `settings.teardown.preserveTables`
- ba22246: ## MSSQL connects by IP address

  ### Fixed

  - `fix(connection):` connecting to MSSQL by IP address works again. Tedious derived the TLS SNI ServerName from the host, and Node rejects an IP literal there (RFC 6066), so every IP connection failed with `Setting the TLS ServerName to an IP address is not permitted`. Hostname connections are unchanged. Encryption stays on — the connection is never silently downgraded to plaintext to work around it.
  - `feat(connection):` new optional `connection.tlsServerName` — the hostname the server's TLS certificate is issued for. Required when connecting to an IP address with certificate validation enabled (`ssl` set), since a certificate cannot be validated against an IP. Without it, that combination now fails with an error naming the field instead of an opaque TLS error.

- 01208ec: ## Fixed
  - `fix(teardown):` Reorder schema teardown to drop procedures and functions before tables. MSSQL schema-bound UDFs (`WITH SCHEMABINDING`) previously blocked the table drop with `Cannot DROP TABLE because it is being referenced by object 'fn_X'`. New order: FK constraints → Procedures → Functions → Views → Tables → Types.
  - `fix(teardown):` Replace `sp_MSforeachtable` with per-table sequential `ALTER TABLE [name] NOCHECK CONSTRAINT ALL` (and inverse) in MSSQL `db.truncate()`. The previous implementation spawned parallel workers that deadlocked on schema locks against non-trivial schemas.
  - `fix(teardown):` `TeardownDialectOperations.disableForeignKeyChecks` / `enableForeignKeyChecks` now accept an optional `tables?: string[]` and may return `string | string[]`. PostgreSQL / MySQL / SQLite implementations ignore the argument — no behavior change for those dialects.
- 3ef0007: fix(sdk): db.reset() no longer preserves tables before rebuilding

  `db.reset()` (teardown + build) honored `settings.teardown.preserveTables`,
  so any preserved table (e.g. reference vocabulary kept for the per-test
  `truncate()` workflow) survived the teardown and then collided with the
  build's `CREATE TABLE`, aborting the rebuild and leaving a partial schema.
  reset() now performs a full teardown that ignores `preserveTables` — a full
  rebuild starts from nothing. `preserveTables` still applies to standalone
  `teardown()` and `truncate()`.

- 3ef0007: fix(teardown): drop MSSQL CHECK constraints before functions

  `teardown()` aborted with MSSQL error 3729 on any schema where a scalar UDF
  is referenced by a CHECK constraint (the canonical base/subtype "IsType"
  pattern). Functions are dropped before tables to satisfy schema-bound
  dependents, but that left the CHECK-constraint dependency intact. Teardown
  now severs it first by dropping all user-schema CHECK constraints (excluding
  the `noorm` schema) ahead of the function drops, so both schema-bound
  functions and CHECK-backed functions tear down cleanly.

- f4fec5b: ## Fixed
  - `fix(run):` `run build` now names `build.include` entries that matched no files instead of reporting a plain success over zero files — include paths are relative to `paths.sql`, and the common `sql/01_tables` form silently matched nothing. `BatchResult` gains an optional `unmatchedInclude`.
- ba22246: ## MySQL works

  ### Fixed

  - `fix(runner):` `run build` executes on MySQL. `createOperation` emitted a `RETURNING` clause MySQL has no support for, so the operation record was never created and **zero SQL files ran** — the command failed before touching a single file.
  - `fix(change):` `recordReset` no longer fails silently on MySQL. It swallowed the same error and returned `0`, so `db teardown` recorded nothing and reported no error at all.
  - `refactor(shared):` operation-record insertion is one dialect-aware helper. It existed as three independent copies, which is why fixing the runner left the change module broken and the same defect had to be found twice.

- ba22246: ## Self-update input validation, log rotation and redaction

  ### Fixed

  - `fix(update)!:` the version string from the npm registry is validated as semver before it reaches a URL or a shell. It was interpolated verbatim, and because `fetch` normalises `..`, a poisoned dist-tag could relocate **both the binary and its `checksums.txt`** to an attacker-controlled repository — so checksum verification passed against the attacker's own file.
  - `fix(logger):` rotation reopens its write stream. It renamed the file out from under the open descriptor, so every subsequent write landed in the rotated file, `noorm.log` never reappeared, and rotation fired exactly once before growing unbounded.
  - `fix(logger):` `settings.logging.enabled`, `.file`, `.maxSize` and `.maxFiles` are honoured. The CLI hardcoded all four, so every logging setting was inert across every command — and the log viewer read a different path than the CLI wrote.
  - `fix(logger):` redaction covers this project's own variables. `NOORM_CONNECTION_PASSWORD` and `NOORM_IDENTITY_PRIVATE_KEY` were not masked, credential-bearing URIs passed through verbatim because values were never inspected, and `Error` objects were skipped wholesale. Log files are created `0600` rather than world-readable.

- 01208ec: ## Changed

  - `fix(vault):` `vault.init()` is now idempotent. A repeat call against an already-initialized vault returns `[null, null]` instead of `[null, Error('Vault already initialized')]`. The `vault:initialized` observer event still fires only on first init.

  This is a behavior change for callers that were special-casing the `'Vault already initialized'` error string — they now see no error on repeat and must check whether the returned key is `null` (already initialized) or a `Buffer` (newly generated).

## 1.0.0-alpha.39

## 1.0.0-alpha.38

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

- 3ef0007: fix(mssql): construct tarn/tedious through CJS-interop guard in bundles

  When the SDK is bundled (tsup), `await import('tarn')` / `await import('tedious')`
  expose their exports under `.default`, so spreading the namespace left
  `tarn.Pool` undefined and kysely threw `Pool is not a constructor` on every
  MSSQL connection. Normalize both with `module.default ?? module`, mirroring the
  postgres dialect's existing guard.

- 3ef0007: fix(sdk): db.reset() no longer preserves tables before rebuilding

  `db.reset()` (teardown + build) honored `settings.teardown.preserveTables`,
  so any preserved table (e.g. reference vocabulary kept for the per-test
  `truncate()` workflow) survived the teardown and then collided with the
  build's `CREATE TABLE`, aborting the rebuild and leaving a partial schema.
  reset() now performs a full teardown that ignores `preserveTables` — a full
  rebuild starts from nothing. `preserveTables` still applies to standalone
  `teardown()` and `truncate()`.

- 3ef0007: fix(teardown): drop MSSQL CHECK constraints before functions

  `teardown()` aborted with MSSQL error 3729 on any schema where a scalar UDF
  is referenced by a CHECK constraint (the canonical base/subtype "IsType"
  pattern). Functions are dropped before tables to satisfy schema-bound
  dependents, but that left the CHECK-constraint dependency intact. Teardown
  now severs it first by dropping all user-schema CHECK constraints (excluding
  the `noorm` schema) ahead of the function drops, so both schema-bound
  functions and CHECK-backed functions tear down cleanly.

## 1.0.0-alpha.35

### Minor Changes

- 01208ec: ## Added

  - `feat(runner):` Split MSSQL SQL files on the `GO` batch separator. Multi-statement DDL files (multiple `CREATE PROCEDURE` / `CREATE FUNCTION` / `CREATE TRIGGER` / `CREATE VIEW` / `CREATE TYPE` in one file) now run correctly instead of failing with `Incorrect syntax near 'GO'`.
  - `feat(runner):` Batch failures report the failed batch index in `FileResult.error` (e.g. `[batch 3 of 5] <driver error>`) and short-circuit the remaining batches.

  ## Known limitations

  - `GO` inside string literals or block comments is still treated as a separator — matches `sqlcmd` behavior. Document accordingly when authoring T-SQL files.
  - `GO <N>` repetition is not implemented.

### Patch Changes

- 01208ec: ## Changed
  - `feat(sdk):` `changes.ff(options?)` and `changes.next(count, options?)` now accept `BatchChangeOptions` so callers can pass `dryRun` / `force`. Previously the options were silently dropped before reaching the manager.
- 01208ec: ## Fixed
  - `fix(teardown):` Reorder schema teardown to drop procedures and functions before tables. MSSQL schema-bound UDFs (`WITH SCHEMABINDING`) previously blocked the table drop with `Cannot DROP TABLE because it is being referenced by object 'fn_X'`. New order: FK constraints → Procedures → Functions → Views → Tables → Types.
  - `fix(teardown):` Replace `sp_MSforeachtable` with per-table sequential `ALTER TABLE [name] NOCHECK CONSTRAINT ALL` (and inverse) in MSSQL `db.truncate()`. The previous implementation spawned parallel workers that deadlocked on schema locks against non-trivial schemas.
  - `fix(teardown):` `TeardownDialectOperations.disableForeignKeyChecks` / `enableForeignKeyChecks` now accept an optional `tables?: string[]` and may return `string | string[]`. PostgreSQL / MySQL / SQLite implementations ignore the argument — no behavior change for those dialects.
- 01208ec: ## Changed

  - `fix(vault):` `vault.init()` is now idempotent. A repeat call against an already-initialized vault returns `[null, null]` instead of `[null, Error('Vault already initialized')]`. The `vault:initialized` observer event still fires only on first init.

  This is a behavior change for callers that were special-casing the `'Vault already initialized'` error string — they now see no error on repeat and must check whether the returned key is `null` (already initialized) or a `Buffer` (newly generated).

## 1.0.0-alpha.34

## 1.0.0-alpha.33

## 1.0.0-alpha.32

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
