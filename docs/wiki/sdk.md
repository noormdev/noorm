---
type: Domain
reflects_rev: 43ecd2b9bfc709b22ab81b607d625326135ef738
description: Typed database access, noorm management operations, and portable DT data serialization.
tags: [database, core, transfer]
---

# sdk

## What it does

`@noormdev/sdk` lets applications and test suites query databases and run noorm management operations without driving the CLI. `createContext` accepts a stored configuration, environment configuration, or non-persisted inline connection settings. It returns an unconnected `Context` with typed Kysely access, routine calls, transactions, impersonation, and lazy management namespaces.

```typescript
import { createContext } from '@noormdev/sdk';

const ctx = await createContext({
    connection: { dialect: 'sqlite', database: ':memory:' },
});
await ctx.connect();
try {
    await ctx.kysely.selectFrom('users').selectAll().execute();
} finally {
    await ctx.disconnect();
}
```

The same domain owns DT serialization in [`src/core/dt`](../../src/core/dt): portable table files and in-memory row conversion for PostgreSQL, MySQL, and MSSQL. Live database-to-database transfer belongs to core-db; its cross-dialect conversion uses `DtStreamer`.

## How it works

`createContext` initializes state and settings, resolves configuration, checks `requireTest`, and resolves identity before returning. Inline `connection` fields enter the shared resolver as flags, above environment settings. The resolver owns defaults, stage constraints, stored selection, and synthetic names; see core-state. Without an explicit name, inline-only configurations use `__inline__`, while environment-only configurations use `__env__`. Synthetic names are not unique context identifiers.

Runtime password callbacks and PostgreSQL `ssl.checkServerIdentity` stay outside serializable configuration. The factory removes a shadowed stored or environment password from the resolved configuration when a callback wins. It does not write that removal back to state.

```mermaid
sequenceDiagram
    %% source: src/sdk/index.ts, src/sdk/context.ts, src/core/config/resolver.ts
    participant Caller
    participant SDK as createContext
    participant Resolver as resolveConfig
    participant Ctx as Context
    Caller->>SDK: options.connection
    SDK->>Resolver: serializable connection flags
    Resolver-->>SDK: resolved Config
    SDK->>SDK: remove shadowed password
    SDK-->>Caller: unconnected Context
    Caller->>Ctx: connect()
    Ctx->>Ctx: createConnection with runtime options
    Caller->>Ctx: disconnect()
    Ctx->>Ctx: release scopes and destroy connection
```

The factory separates serializable overrides from runtime hooks, and `connect()` supplies those hooks only when opening the connection.

### Connection lifecycle

`connect()` returns immediately when already connected. On success it stores the connection; on failure the context remains unconnected. `disconnect()` releases held explicit impersonation scopes before destroying the connection, then clears the connection and cached change manager. Reconnecting uses the same resolved configuration and runtime hooks. Cleanup is explicit through `disconnect()`.

### Schema views

`withSchema` derives a typed view sharing the root context's mutable state and held impersonation connections. Each `kysely` access derives a fresh schema wrapper from the bare connection, so reconnects cannot leave a cached wrapper pointing at an old connection.

```mermaid
flowchart TD
    %% source: docs/design/sdk-with-schema.md, src/sdk/context.ts, src/sdk/state.ts
    Root["Context"] -->|withSchema| Scoped["Context.withSchema"]
    Root --> State["ContextState"]
    Scoped --> State
    Root --> Held["#heldConnections"]
    Scoped --> Held
    Root --> Bare["connection.db"]
    Scoped --> Wrapped["db.withSchema(name)"]
```

Schema views share lifecycle and held connections rather than allocating independent pools.

Routine names receive the schema prefix through `qualifyName` unless already qualified with a dot. Chained `withSchema` calls replace the schema instead of stacking it. Transactions and impersonation compose with the schema-derived Kysely handle. Management namespaces continue using shared project state rather than the view's schema.

### Transactions and routine dispatch

`transaction(fn)` attaches `proc`, `func`, and `tvf` directly to the real Kysely transaction with `withRoutines`. `ImpersonatedScope.transaction` uses the same helper. Tuple maps (`[Args, Return]`) supply routine argument and result types through `ExtractArgs` and `ExtractReturn`.

PostgreSQL transaction routine dispatch consults `pg_proc` before choosing `CALL` or `SELECT`, avoiding a failed `CALL` that would abort the transaction.

```mermaid
flowchart TD
    %% source: src/sdk/routines.ts, src/sdk/context.ts, src/sdk/impersonate/scope.ts
    Proc["callProc"] --> Tx{"db.isTransaction?"}
    Tx -->|yes| Catalog{"isProcedure?"}
    Catalog -->|yes| Call["CALL"]
    Catalog -->|no| Tvf["callTvf"]
    Tx -->|no| Attempt["CALL via attempt"]
    Attempt -->|success| Rows["result.rows"]
    Attempt -->|function error| Tvf
    Attempt -->|other error| Throw["throw callErr"]
    Call --> Rows
    Tvf --> Rows
```

Outside transactions, PostgreSQL `proc` falls back from function-related SQLSTATE `42809` or `42883` to `callTvf`. `func` returns the first row or `null`; `proc` and `tvf` return rows. SQL builders handle dialect quoting and MSSQL table-valued parameters created by `tvp()`.

### Management namespaces

`ctx.noorm` lazily creates `NoormOps`; each namespace is also lazy and cached. It exposes changes (scaffolding, discovery, validation, execution, history), run (discovery, preview, file, directory, build), db (exploration, teardown preview, truncate, teardown, reset), dt (table export and file import), lock, vault, secrets, templates, transfer, and utils. `db.reset` delegates rebuilding to `run.build`.

`run.build` applies settings include/exclude and rule filtering, returning unmatched include/exclude entries. Template rendering does not execute SQL. Utilities provide file checksums and a non-throwing connection test result. Vault methods include initialization, status, secret CRUD, propagation, and copying; local secrets remain configuration-scoped.

### DT export and import

DT exports query rows through a primary-key pager, serialize through a compute worker pool, and restore order before writing. Import reads schema and rows, deserializes through workers, and inserts batches. The SDK wrappers translate core result/error tuples into results or thrown errors.

```mermaid
flowchart TD
    %% source: src/core/dt/index.ts, src/core/dt/paging.ts, src/core/dt/serialize.ts, src/core/dt/deserialize.ts, src/workers/compute.ts, src/core/dt/writer.ts, src/core/dt/reader.ts
    Export["exportTable"] --> Pager["createKeysetPager"]
    Pager --> Serialize["serializeRow"]
    Serialize --> Order["OrderBuffer"]
    Order --> Writer["DtWriter"]
    Reader["DtReader"] --> Deserialize["deserializeRow"]
    Deserialize --> Import["importDtFile"]
```

Compute workers transform rows while `OrderBuffer` preserves export ordering.

`DtWriter` and `DtReader` use JSON5 lines with a schema header: `.dt` is raw, `.dtz` is gzip, and `.dtzx` is gzip plus passphrase-based AES-256-GCM. Encrypted output buffers before encryption. Universal type mapping preserves dialect-independent values; encoded types (`json`, `binary`, `vector`, `array`, `text`, `custom`) use value/encoding tuples. `DtStreamer` converts rows without files. `modifyDtFile` applies recipes for column drop/add/rename/nullability and row filtering.

## Where it lives

| Path | Role |
| --- | --- |
| [`src/sdk/index.ts`](../../src/sdk/index.ts), [`src/sdk/types.ts`](../../src/sdk/types.ts) | Factory, runtime overrides, public exports, options and routine types. |
| [`src/sdk/context.ts`](../../src/sdk/context.ts), [`src/sdk/state.ts`](../../src/sdk/state.ts) | Shared state, connection lifecycle, schema views, transaction and impersonation entry points. |
| [`src/sdk/routines.ts`](../../src/sdk/routines.ts), [`src/sdk/sql.ts`](../../src/sdk/sql.ts), [`src/sdk/tvp.ts`](../../src/sdk/tvp.ts) | Routine dispatch, dialect SQL builders, MSSQL table-valued parameters. |
| [`src/sdk/impersonate/`](../../src/sdk/impersonate) | Dedicated-connection scopes and dialect impersonation/revert strategies. |
| [`src/sdk/noorm-ops.ts`](../../src/sdk/noorm-ops.ts), [`src/sdk/namespaces/`](../../src/sdk/namespaces), [`src/sdk/guards.ts`](../../src/sdk/guards.ts) | Lazy management wrappers and policy enforcement. |
| [`src/core/dt/index.ts`](../../src/core/dt/index.ts), [`src/core/dt/paging.ts`](../../src/core/dt/paging.ts), [`src/core/dt/schema.ts`](../../src/core/dt/schema.ts) | Export/import orchestration, keyset paging, schema construction and validation. |
| [`src/core/dt/writer.ts`](../../src/core/dt/writer.ts), [`src/core/dt/reader.ts`](../../src/core/dt/reader.ts), [`src/core/dt/crypto.ts`](../../src/core/dt/crypto.ts) | File streams, compression, encryption. |
| [`src/core/dt/serialize.ts`](../../src/core/dt/serialize.ts), [`src/core/dt/deserialize.ts`](../../src/core/dt/deserialize.ts), [`src/core/dt/type-map.ts`](../../src/core/dt/type-map.ts), [`src/core/dt/dialects/`](../../src/core/dt/dialects) | Universal values and dialect type conversion. |
| [`src/core/dt/streamer.ts`](../../src/core/dt/streamer.ts), [`src/core/dt/modify.ts`](../../src/core/dt/modify.ts), [`src/core/dt/paths.ts`](../../src/core/dt/paths.ts), [`src/core/dt/version.ts`](../../src/core/dt/version.ts), [`src/core/dt/constants.ts`](../../src/core/dt/constants.ts) | In-memory conversion, recipes, export paths, database versions, format limits. |
| [`packages/sdk/package.json`](../../packages/sdk/package.json), [`tsup.sdk.config.ts`](../../tsup.sdk.config.ts) | Package exports, consumer peers, bundled runtime boundary. |
| [`tests/sdk/`](../../tests/sdk), [`tests/integration/sdk/`](../../tests/integration/sdk) | SDK contracts, bundle/declaration surface, live dialect integration. |
| [`docs/design/sdk-with-schema.md`](../design/sdk-with-schema.md), [`docs/design/sdk-transaction-routines.md`](../design/sdk-transaction-routines.md) | Schema-view and transaction-routine design rationale. |

## Constraints

- Call `connect()` before accessing Kysely or connected namespace operations; `requireConnection` throws `NotConnectedError` otherwise. Disconnect in cleanup so held connections do not keep the pool open.
- Password callbacks may return a string or promise for PostgreSQL, MySQL, and MSSQL. SQLite rejects callbacks. A callback takes precedence over resolved static credentials; do not expect the old password on `ctx.noorm.config.connection`.
- Runtime-credential connection failures preserve the original thrown error and disable automatic connection retries, even when retry options request them. Observer error payloads instead use `Runtime credential connection failed` and omit server error fields; handle the thrown error separately from telemetry.
- PostgreSQL `ssl.checkServerIdentity` must be a function and is rejected for other dialects. TLS identity options require explicitly enabled TLS and certificate verification; incompatible options fail connection creation. Physical pool, session timeout, keep-alive, and TLS behavior belong to core-db.
- `requireTest: true` rejects a configuration without `isTest: true`, including ordinary inline-only configurations. Inline connection settings do not mark a database as a test database.
- The SDK cannot prompt. Guarded operations throw `ProtectedConfigError` on denial or unconfirmed user-channel operations. `yes: true` supplies user confirmation but cannot override agent-channel denial; core-policy owns the matrix.
- Truncate, teardown, and reset use their own permissions. Dry-run truncate/teardown still require permission but do not require confirmation. Reset does not preserve configured tables because rebuilding would collide with existing objects.
- `withSchema` accepts only alphanumerics, underscores, and hyphens. Invalid names throw synchronously. Raw `sql` fragments are not rewritten, and exploration methods still require their explicit schema argument when needed.
- PostgreSQL transaction procedure detection matches names and namespaces, not argument overloads or search-path precedence. A same-named function/procedure ambiguity can still select a failing `CALL`; use `tvf` when calling the function.
- SQLite has no procedure support. TVFs and impersonation support PostgreSQL and MSSQL, not MySQL or SQLite. TVPs are MSSQL-only, enforce consistent row keys, and obey the `2100` parameter limit.
- Vault decryption needs a private key. `vault.set` throws `VaultAccessError` without a usable vault key; reads can return `null` or an empty object instead. DT import and transfer writes use destination reset permission; export is ungated by the DT wrapper.
- DT supports PostgreSQL, MySQL, and MSSQL, not SQLite. Tables without a primary key use an unpaginated export query. Keyset paging is not a snapshot-isolation guarantee.
- DT format version is `1`. Encoded values consider gzip at `128` bytes and retain it only below a `0.85` compression ratio. Readers cap decompressed values at `64 MiB`, encrypted archives at `1 GiB`, and row lines at `256 MiB`; oversized inputs fail instead of expanding without bounds.
- Consumers install Kysely and the appropriate optional peer driver (`pg`, `mysql2`, `tedious`, or `better-sqlite3`). Tarn is bundled, not a consumer peer. The package's `types`/`import`/`default` exports reference declarations and a shared ESM entry; supported Node `22.13+` can load that entry with `require(esm)`. There is no separate CommonJS artifact. Packaging mechanics belong to infra.

## Coupling

- Core-state owns configuration precedence, synthetic naming, state persistence, settings, and the resolver used by the factory. Core-identity supplies environment identity overrides, config identity, and vault primitives.
- Core-db owns physical connections, pool behavior, database exploration, teardown, and live transfer. The SDK forwards runtime credentials and PostgreSQL TLS callbacks through the connection runtime-options boundary.
- Core-policy owns channel/role decisions. Namespace wrappers enforce those decisions; direct Kysely access remains the raw SQL surface.
- Core-runner and core-change own SQL execution and migration semantics behind the SDK namespaces. Wrapper signatures and returned core result types must stay aligned.
- Worker-bridge owns the compute protocol and ordered worker infrastructure consumed by DT. Live transfer consumes DT's in-memory conversion.
- `noormObserver` exports the process-global observer, not a per-context bus. Consumers sharing a process filter context-scoped events by `configName`; synthetic inline names alone cannot distinguish unrelated inline contexts.
- Infra owns SDK bundling and declaration generation. [`tests/sdk/bundle-smoke.test.ts`](../../tests/sdk/bundle-smoke.test.ts) and [`tests/sdk/dts-surface.test.ts`](../../tests/sdk/dts-surface.test.ts) consume built output, while [`tests/integration/sdk/`](../../tests/integration/sdk) exercises live schema, routine, impersonation, and management behavior.
