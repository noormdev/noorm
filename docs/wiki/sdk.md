---
type: Domain
description: Programmatic API (createContext) for noorm-managed databases, plus the DT binary/text serialization format for cross-database data transfer
---

# sdk

## What it does

`createContext` (in [`src/sdk/index.ts`](../../src/sdk/index.ts)) returns a `Context` with a raw Kysely instance (`ctx.kysely`), `proc`/`func`/`tvf`/`transaction`/`impersonate` helpers, and a `ctx.noorm` namespace object bundling changes/run/db/dt/lock/vault/secrets/templates/transfer/utils operations. Published as `@noormdev/sdk` version `1.0.1` from [`packages/sdk/`](../../packages/sdk).

The DT (Data Transfer) module under [`src/core/dt/`](../../src/core/dt) is a separate universal-type serialization format (`.dt`/`.dtz`/`.dtzx` files) for exporting/importing single tables across PostgreSQL, MySQL, and MSSQL — distinct from the `core-db` domain's live DB-to-DB `transfer` module, though both share row-fetch and worker-pipeline patterns.

## Artifacts

- [`packages/sdk/package.json`](../../packages/sdk/package.json) — published package `@noormdev/sdk`, version `1.0.1`; peer deps `kysely`, and optional `better-sqlite3`/`pg`/`mysql2`/`tedious`/`tarn`
- [`packages/sdk/CHANGELOG.md`](../../packages/sdk/CHANGELOG.md) — Changesets-generated release history
- [`packages/sdk/dist/`](../../packages/sdk/dist) — build output: `index.js` (tsup bundle, all deps inlined except peers) + `index.d.ts` (dts-bundle-generator)

## CLI code

- [`src/sdk/index.ts`](../../src/sdk/index.ts) — `createContext` factory; resolves identity/state/settings/config, runs `checkRequireTest`, defaults `options.channel` to `'user'`, re-exports the full public type/error surface
- [`src/sdk/context.ts`](../../src/sdk/context.ts) — `Context` class: `kysely`, `noorm` (lazy `NoormOps`), `connect`/`disconnect`, `transaction`, `proc`/`func`/`tvf`, `impersonate` (callback and explicit modes)
- [`src/sdk/state.ts`](../../src/sdk/state.ts) — `ContextState` interface (shared mutable state between `Context` and `NoormOps`) and `requireConnection` guard
- [`src/sdk/noorm-ops.ts`](../../src/sdk/noorm-ops.ts) — `NoormOps`; lazy per-namespace getters, wires `db.reset` to `run.build`
- [`src/sdk/guards.ts`](../../src/sdk/guards.ts) — `checkRequireTest` (throws `RequireTestError` when `requireTest: true` and `config.isTest` is false); `checkProtectedConfig` (calls `checkConfigPolicy` from `core/policy`, throws `ProtectedConfigError` on denial or on an unconfirmed `confirm` cell — the SDK has no interactive prompt)
- [`src/sdk/namespaces/run.ts`](../../src/sdk/namespaces/run.ts) — `RunNamespace`: `discover` (offline), `preview`, `file`/`files`/`dir`/`build`; `build` applies `settings.build.include/exclude` + `settings.rules` filtering identical to the TUI Run Build screen and reports `unmatchedInclude`/`unmatchedExclude`
- [`src/sdk/namespaces/changes.ts`](../../src/sdk/namespaces/changes.ts) — `ChangesNamespace`: scaffold ops (`create`, `addFile`, `removeFile`, `renameFile`, `reorderFiles`, `delete`), discovery/validation (offline), execution (`apply`, `revert`, `ff`, `next`, `rewind`), status/history
- [`src/sdk/namespaces/db.ts`](../../src/sdk/namespaces/db.ts) — `DbNamespace`: explore (`listTables`/`describeTable`/etc.), `previewTeardown`, destructive ops `truncate`/`teardown`/`reset` — gated per-action (`db:truncate`, `db:teardown`, `db:reset`) rather than sharing one permission
- [`src/sdk/namespaces/dt.ts`](../../src/sdk/namespaces/dt.ts) — `DtNamespace`: `exportTable` (ungated), `importFile` (gated on `db:reset`)
- [`src/sdk/namespaces/lock.ts`](../../src/sdk/namespaces/lock.ts) — `LockNamespace`: `acquire`, `release`, `status`, `withLock`, `forceRelease` (gated on `lock:force`)
- [`src/sdk/namespaces/vault.ts`](../../src/sdk/namespaces/vault.ts) — `VaultNamespace`: `init`, `status`, CRUD (`set`/`get`/`getAll`/`list`/`delete`/`exists`), team ops (`propagate`, `copy`); read/write/decrypt ops require `privateKey`; `set()` throws `VaultAccessError` when the key yields no usable vault key, but `get()`/`getAll()` degrade silently (`null`/`{}`) instead of throwing
- [`src/sdk/namespaces/secrets.ts`](../../src/sdk/namespaces/secrets.ts) — `SecretsNamespace`: config-scoped local secrets (`get`/`list`/`set`/`delete`), gated same as vault (`secret:read`/`secret:write`)
- [`src/sdk/namespaces/templates.ts`](../../src/sdk/namespaces/templates.ts) — `TemplatesNamespace`: `render` (Eta template render without executing SQL; gated on `run:file` via `checkConfigPolicy`, not `checkProtectedConfig`, so a `confirm` cell doesn't block a read-only render)
- [`src/sdk/namespaces/transfer.ts`](../../src/sdk/namespaces/transfer.ts) — `TransferNamespace`: `to` (gated against the destination config's `db:reset` permission), `plan`
- [`src/sdk/namespaces/utils.ts`](../../src/sdk/namespaces/utils.ts) — `UtilsNamespace`: `checksum` (offline SHA-256), `testConnection` (returns `{ ok, error? }`, never throws)
- [`src/sdk/impersonate/scope.ts`](../../src/sdk/impersonate/scope.ts) — `buildScope`; binds `proc`/`func`/`tvf`/`transaction`/`revert` to a dedicated pooled connection
- [`src/sdk/impersonate/dialect-strategy.ts`](../../src/sdk/impersonate/dialect-strategy.ts) — per-dialect impersonate/revert SQL: MSSQL `EXECUTE AS USER`/`REVERT`, PostgreSQL `SET ROLE`/`RESET ROLE`; MySQL and SQLite are `null` (unsupported); `validateUsername` restricts to `[a-zA-Z0-9_@.\-\\]+`
- [`src/sdk/impersonate/types.ts`](../../src/sdk/impersonate/types.ts) — `ImpersonatedScope` interface, `ImpersonationError`
- [`src/sdk/sql.ts`](../../src/sdk/sql.ts) — `buildProcCall`/`buildFuncCall`/`buildTvfCall`; dialect-specific EXEC/CALL/SELECT builders; `quoteIdent` per dialect; TVP-aware branches delegate to DECLARE/INSERT/EXEC batch builders
- [`src/sdk/tvp.ts`](../../src/sdk/tvp.ts) — `tvp()` factory and `TvpValue`/`isTvp`; `MSSQL_PARAM_LIMIT = 2100`; MSSQL-only, validates consistent row keys
- [`src/sdk/stubs/ansis.ts`](../../src/sdk/stubs/ansis.ts) — no-op `ansis` replacement aliased in the tsup build (SDK doesn't write to terminals)
- [`src/sdk/types.ts`](../../src/sdk/types.ts) — `CreateContextOptions` (`config`, `projectRoot`, `requireTest`, `stage`, `channel` default `'user'`, `yes`), `BuildOptions`, `ExportOptions`/`ImportOptions`, `ExtractArgs`/`ExtractReturn` tuple-type helpers for proc/func/tvf typing
- [`src/core/dt/index.ts`](../../src/core/dt/index.ts) — `exportTable`/`importDtFile`; three-stage worker pipeline (keyset-paged fetch → compute-pool serialize/deserialize → `OrderBuffer` reassembly) via `WorkerBridge`/`WorkerPool`
- [`src/core/dt/writer.ts`](../../src/core/dt/writer.ts) / [`reader.ts`](../../src/core/dt/reader.ts) — streaming JSON5-lines writer/reader; extension picks the pipeline (`.dt` raw, `.dtz` gzip, `.dtzx` gzip+AES-256-GCM)
- [`src/core/dt/serialize.ts`](../../src/core/dt/serialize.ts) / [`deserialize.ts`](../../src/core/dt/deserialize.ts) — row ↔ `.dt` value conversion; encoded types become `[value, encoding]` tuples
- [`src/core/dt/streamer.ts`](../../src/core/dt/streamer.ts) — `DtStreamer`; in-memory cross-dialect row conversion with no file I/O, used by DB-to-DB transfer
- [`src/core/dt/schema.ts`](../../src/core/dt/schema.ts) — `buildDtSchema`, `validateSchema`, `queryPrimaryKeyColumns` (export pages require a PK; a key-less table falls back to one unpaginated `SELECT`)
- [`src/core/dt/type-map.ts`](../../src/core/dt/type-map.ts) — `toUniversalType`/`toDialectType`/`isEncodedType`; delegates pattern matching to [`src/core/dt/dialects/`](../../src/core/dt/dialects)
- [`src/core/dt/dialects/`](../../src/core/dt/dialects) — `postgres.ts`, `mysql.ts`, `mssql.ts`; MSSQL is version-aware (native `json`/`vector` types on SQL Server 2025+, `nvarchar(max)` fallback below)
- [`src/core/dt/version.ts`](../../src/core/dt/version.ts) — `queryDatabaseVersion`; parses `SELECT version()` (PG/MySQL) or `SERVERPROPERTY` (MSSQL, internal build number mapped to marketing year)
- [`src/core/dt/crypto.ts`](../../src/core/dt/crypto.ts) — `encryptWithPassphrase`/`decryptWithPassphrase`; AES-256-GCM with PBKDF2 (100k iterations), independent of the identity keypair system; `MIN_PASSPHRASE_LENGTH = 12` enforced on encrypt only
- [`src/core/dt/paging.ts`](../../src/core/dt/paging.ts) — `createKeysetPager`; primary-key cursor pagination (not `LIMIT`/`OFFSET`) so concurrent writes can't skip/duplicate rows during export
- [`src/core/dt/paths.ts`](../../src/core/dt/paths.ts) — `resolveExportExtension`/`resolveExportPath`/`resolveExportTables`/`ensureExportDirectory`; single-table vs multi-table export path resolution
- [`src/core/dt/modify.ts`](../../src/core/dt/modify.ts) — `modifyDtFile`; recipe-based column drop/add/rename and row filter, streamed over an existing `.dt` file
- [`src/core/dt/constants.ts`](../../src/core/dt/constants.ts) — `FORMAT_VERSION = 1`, `GZIP_THRESHOLD = 128`, `GZIP_RATIO_THRESHOLD = 0.85`, `MAX_DECOMPRESSED_VALUE_BYTES = 64MB`, `MAX_DECOMPRESSED_ARCHIVE_BYTES = 1GB`, `MAX_ROW_BYTES = 256MB`, `SIMPLE_TYPES`/`ENCODED_TYPES` classification
- [`src/core/dt/events.ts`](../../src/core/dt/events.ts) — `DtEvents`: export/import/stream/validate/modify progress events emitted on the shared `observer`

## Docs

- [`docs/dev/sdk.md`](../dev/sdk.md) — SDK internals reference
- [`docs/reference/sdk.md`](../reference/sdk.md) — public SDK API reference
- [`docs/dev/transfer.md`](../dev/transfer.md) — DT/transfer internals
- [`docs/getting-started/building-your-sdk.md`](../getting-started/building-your-sdk.md) — getting-started guide for SDK users
- [`skills/noorm/references/sdk.md`](../../skills/noorm/references/sdk.md) — skill reference for SDK usage patterns

## Coupling

- `createContext`'s startup sequence (`initState`, `getSettingsManager`, `resolveConfig`, `getIdentityForConfig`) is not the CLI's `initProjectContext` (project-root discovery + `chdir`, called once at CLI entry in [`src/cli/index.ts`](../../src/cli/index.ts)) — individual CLI commands (e.g. [`src/cli/db/create.ts`](../../src/cli/db/create.ts)) replicate a similar `initState`/`getSettingsManager`/`resolveConfig` sequence inline, minus `getIdentityForConfig`, whose only consumer is the SDK.
- Every namespace method that gates a write calls `checkProtectedConfig`/`checkConfigPolicy` from [`src/core/policy/`](../../src/core/policy), reading `state.options.channel` (`'user'` | `'agent'`, default `'user'`) — CLI, TUI, and MCP callers share this one enforcement path.
- All namespaces delegate to `core/*` modules (`core/runner`, `core/change`, `core/explore`, `core/teardown`, `core/lock`, `core/vault`, `core/template`, `core/transfer`, `core/dt`) — a core API change propagates to the SDK namespace wrapper.
- [`src/core/dt/`](../../src/core/dt) is co-owned: the SDK exposes it via `ctx.noorm.dt`, and it is also used directly by the transfer executor for cross-dialect streaming (`DtStreamer`).
- [`src/core/dt/index.ts`](../../src/core/dt/index.ts) dispatches serialize/deserialize work to [`src/workers/compute.ts`](../../src/workers/compute.ts) via `WorkerBridge`/`WorkerPool` (`worker-bridge` domain) — a worker-bridge protocol change affects DT export/import.
- Impersonation ([`src/sdk/impersonate/`](../../src/sdk/impersonate)) requires a live connection borrowed from the pool; `Context.disconnect()` drains any un-reverted explicit-mode scopes via `#heldConnections` before destroying the pool.
- `Context.proc()` on PostgreSQL retries a `CALL`-against-FUNCTION failure (SQLSTATE 42809/42883) as `SELECT * FROM <name>(...)` — see `isFunctionNotProcedureError` in [`src/sdk/context.ts`](../../src/sdk/context.ts).
- Published package build: [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts) bundles everything except peer deps (`kysely`, `better-sqlite3`, `pg`, `mysql2`, `tedious`, `tarn`) and aliases `ansis` to the stub; [`scripts/build.mjs`](../../scripts/build.mjs) runs `dts-bundle-generator` against [`src/sdk/index.ts`](../../src/sdk/index.ts) for [`packages/sdk/dist/index.d.ts`](../../packages/sdk/dist/index.d.ts).
- [`tests/sdk/bundle-smoke.test.ts`](../../tests/sdk/bundle-smoke.test.ts) and [`tests/sdk/dts-surface.test.ts`](../../tests/sdk/dts-surface.test.ts) import the built [`packages/sdk/dist/`](../../packages/sdk/dist) output directly (skipped when `dist` doesn't exist) — they catch bundling regressions the source-level tests can't see.

## Conventions worth knowing

- `createContext` is the only public entry point — `Context` is never instantiated directly by consumers.
- `ctx.kysely` is the raw, type-safe Kysely instance; `ctx.noorm` holds every noorm-specific operation, namespaced and lazily instantiated (one singleton per `Context`).
- `checkRequireTest` throws `RequireTestError` when `options.requireTest === true` but `config.isTest` is not `true` — prevents test helpers running against a non-test config.
- `ProtectedConfigError` on a `confirm`-cell permission points to `options.yes: true`, `NOORM_YES=1` (scripted opt-in), or the CLI/TUI (interactive confirm) — the SDK itself never prompts. `options.yes` is only consulted after policy resolution, so it can never unblock an `agent`-channel context (a `confirm` cell collapses to deny before `yes` is read on that channel).
- Destructive `db` operations are gated per-action (`db:truncate`, `db:teardown`, `db:reset`), not a shared `db:reset` permission — `db:reset` is `allow` for the admin role and would otherwise leave `truncate`/`teardown` unguarded on a default config.
- `db.truncate()`/`db.teardown()` check permission (not confirmation) on `dryRun: true` — the preview is deliberately reachable even to a role that must confirm the real operation, but not to a role the policy denies outright.
- `db.reset()` does not honor `settings.teardown.preserveTables` — it rebuilds the schema from `sql/` and a preserved table would collide with a `CREATE TABLE`; `truncate()`/`teardown()` still honor it.
- DT's encoded types (`json`, `binary`, `vector`, `array`, `text`, `custom`) use `gz64` (gzip+base64) only when the value is at least `GZIP_THRESHOLD` (128 bytes) and compresses below `GZIP_RATIO_THRESHOLD` (0.85 of raw size); otherwise they stay `raw`/`b64`. `string` (short VARCHAR/CHAR) is a simple, untupled type — `text` is the encoded counterpart for large TEXT columns.
- TVP ([`src/sdk/tvp.ts`](../../src/sdk/tvp.ts)) is MSSQL-only; `buildProcCall`/`buildFuncCall`/`buildTvfCall` throw if a TVP marker is passed on any other dialect.
- `ctx.tvf()` (table-valued functions) is only supported on MSSQL and PostgreSQL; MySQL and SQLite throw.
- `ctx.impersonate()` supports MSSQL and PostgreSQL only; MySQL and SQLite throw `ImpersonationError` before a connection is borrowed.
- Test coverage: [`tests/sdk/`](../../tests/sdk) covers namespace behavior per access role (admin/operator/viewer configs), guard errors, SQL builders, and impersonation; [`tests/integration/sdk/`](../../tests/integration/sdk) covers TVF/TVP against live MSSQL/PostgreSQL and vault/db-reset round-trips.
