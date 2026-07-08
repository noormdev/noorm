---
type: Domain
---

# core-db

## What it does

Database lifecycle operations: create/drop databases, schema exploration (tables, views, functions, indexes, FKs, stored procedures, types), data transfer between databases, and schema teardown (truncate data, drop all objects). All operations are dialect-aware (PostgreSQL, MySQL, MSSQL, SQLite).

## CLI code

- [`src/core/db/index.ts`](../../src/core/db/index.ts) — `checkDbStatus`, `createDb`, `destroyDb`, `getDialectOperations`
- [`src/core/db/dual.ts`](../../src/core/db/dual.ts) — `withDualConnection`; opens source + destination connections for transfer
- [`src/core/db/dialects/`](../../src/core/db/dialects) — dialect-specific create/drop implementations
- [`src/core/explore/operations.ts`](../../src/core/explore/operations.ts) — `queryTables`, `queryViews`, `queryFunctions`, `queryIndexes`, `queryForeignKeys`, `queryProcedures`, `queryTypes`
- [`src/core/explore/dialects/`](../../src/core/explore/dialects) — per-dialect SQL for introspection queries
- [`src/core/explore/types.ts`](../../src/core/explore/types.ts) — `TableInfo`, `ColumnInfo`, `ViewInfo`, `IndexInfo`, `ForeignKeyInfo`, etc.
- [`src/core/teardown/operations.ts`](../../src/core/teardown/operations.ts) — `truncateData`, `teardownSchema`, `previewTeardown`
- [`src/core/teardown/dialects/`](../../src/core/teardown/dialects) — dialect-specific truncate/drop implementations
- [`src/core/teardown/types.ts`](../../src/core/teardown/types.ts) — `TruncateOptions`, `TeardownOptions`, `TeardownResult`
- [`src/core/transfer/index.ts`](../../src/core/transfer/index.ts) — `transferData`; gates via `assertPolicy` (`core/policy`, `db:reset` permission) against the destination config before opening any connection, then orchestrates plan + execute
- [`src/core/transfer/executor.ts`](../../src/core/transfer/executor.ts) — `executeTransfer`; batch row copy with FK ordering
- [`src/core/transfer/planner.ts`](../../src/core/transfer/planner.ts) — `planTransfer`; dependency-sorted transfer plan
- [`src/core/transfer/same-server.ts`](../../src/core/transfer/same-server.ts) — `sameServerTransfer`; direct SQL shortcut when source + dest are on same server
- [`src/core/transfer/dialects/`](../../src/core/transfer/dialects) — per-dialect identity-column and conflict-resolution strategies
- [`src/core/transfer/types.ts`](../../src/core/transfer/types.ts) — `TransferOptions`, `TransferResult`, `TransferPlan`
- [`src/core/connection/factory.ts`](../../src/core/connection/factory.ts) — `createConnection`, `testConnection`; Kysely instance factory
- [`src/core/connection/manager.ts`](../../src/core/connection/manager.ts) — `ConnectionManager`; singleton connection lifecycle
- [`src/core/connection/dialects/`](../../src/core/connection/dialects) — dialect drivers (pg, mysql2, tedious, better-sqlite3)

## Docs

- [`docs/dev/explore.md`](../dev/explore.md) — explore internals
- [`docs/dev/teardown.md`](../dev/teardown.md) — teardown internals
- [`docs/dev/transfer.md`](../dev/transfer.md) — transfer internals
- [`docs/guide/database/create.md`](../guide/database/create.md) — create database guide
- [`docs/guide/database/teardown.md`](../guide/database/teardown.md) — teardown guide
- [`docs/guide/database/transfer.md`](../guide/database/transfer.md) — transfer guide
- [`docs/guide/database/explore.md`](../guide/database/explore.md) — explore guide
- [`docs/guide/database/terminal.md`](../guide/database/terminal.md) — SQL terminal guide

## Coupling

- Transfer calls `withDualConnection` from [`src/core/db/dual.ts`](../../src/core/db/dual.ts) — dual-connection semantics shared with other DB ops.
- Teardown must skip `__noorm_*` tables (defined in [`src/core/shared/tables.ts`](../../src/core/shared/tables.ts)) — `isNoormTable` guard in `teardown/operations.ts`.
- Connection manager ([`src/core/connection/manager.ts`](../../src/core/connection/manager.ts)) is used by runner, change executor, SQL terminal, vault ops — reset-manager pattern coordinates with lifecycle domain.
- CLI commands in [`src/cli/db/`](../../src/cli/db) surface all these ops — explore query shapes flow through to CLI output formatters.
- [`src/cli/db/drop.ts`](../../src/cli/db/drop.ts) calls `checkConfigPolicy` from [`src/core/policy/`](../../src/core/policy) (`db:destroy` permission) — `--yes` now satisfies the matrix's confirmation requirement rather than gating on a `protected` boolean.
- `transferData` ([`src/core/transfer/index.ts`](../../src/core/transfer/index.ts)) calls `assertPolicy` from [`src/core/policy/`](../../src/core/policy) — transfer and drop both route through the same policy domain as runner/change/sql-terminal.
- DT module ([`src/core/dt/`](../../src/core/dt)) reads rows from transfer context — transfer and DT share the row-fetch pattern.

## Conventions worth knowing

- `testConnection(config, { testServerOnly: true })` connects to the dialect's system database without requiring the target DB — used in setup wizards.
- All dialects tested in integration: [`tests/integration/explore/`](../../tests/integration/explore), [`tests/integration/teardown/`](../../tests/integration/teardown), [`tests/integration/transfer/`](../../tests/integration/transfer).
- Transfer supports PostgreSQL, MySQL, MSSQL only (not SQLite) — `TRANSFER_SUPPORTED_DIALECTS` in [`src/core/transfer/dialects/index.ts`](../../src/core/transfer/dialects/index.ts).
- Same-server transfer skips batch loop and uses direct `INSERT … SELECT` SQL.
- Teardown skips noorm internal tables by name; `previewTeardown` returns a dry-run list without executing.
