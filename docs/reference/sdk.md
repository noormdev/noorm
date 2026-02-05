# SDK Reference


## Overview

The noorm SDK provides programmatic access to noorm-managed databases. Use it for:

- **Application code** - Query and mutate data from your apps
- **Test suites** - Reset and seed databases between tests
- **Scripts** - Data transforms, exports, and automation
- **CI/CD** - Headless database operations


## Installation

```bash
pnpm add @noormdev/sdk
```


## Quick Start

```typescript
import { createContext } from '@noormdev/sdk';

const ctx = await createContext<{ users: { id: number; name: string } }>({
    config: 'dev',
});
await ctx.connect();

// Top-level — SQL focused
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])
    .execute();

// Noorm operations — under namespace
await ctx.noorm.fastForward();

await ctx.disconnect();
```


## createContext(options)

Creates an SDK context for programmatic database access.

```typescript
interface CreateContextOptions {
    config?: string;          // Config name (or use NOORM_CONFIG env var)
    projectRoot?: string;     // Defaults to process.cwd()
    requireTest?: boolean;    // Refuse if config.isTest !== true
    allowProtected?: boolean; // Allow destructive ops on protected configs
    stage?: string;           // Stage name for stage defaults
}

const ctx = await createContext<MyDatabase>({
    config: 'test',
    requireTest: true,
});
```

**Options:**

| Option           | Type      | Description                                                      |
| ---------------- | --------- | ---------------------------------------------------------------- |
| `config`         | `string`  | Config name to use. Falls back to `NOORM_CONFIG` env var.        |
| `projectRoot`    | `string`  | Path to noorm project. Defaults to `process.cwd()`.              |
| `requireTest`    | `boolean` | Throws `RequireTestError` if config doesn't have `isTest: true`. |
| `allowProtected` | `boolean` | Allows destructive operations on protected configs.              |
| `stage`          | `string`  | Stage name for inheriting stage defaults.                        |


## Top-Level Context Properties

| Property    | Type         | Description                                       |
| ----------- | ------------ | ------------------------------------------------- |
| `kysely`    | `Kysely<DB>` | Direct Kysely access (requires `connect()`)       |
| `dialect`   | `Dialect`    | Database dialect (postgres, mysql, sqlite, mssql)  |
| `connected` | `boolean`    | Whether currently connected                        |
| `noorm`     | `NoormOps`   | Noorm management operations (lazy singleton)       |


## Lifecycle Methods


### connect()

Establishes the database connection.

```typescript
await ctx.connect();
```


### disconnect()

Closes the database connection.

```typescript
await ctx.disconnect();
```


## Transactions


### transaction(fn)

Execute operations within a database transaction. The callback receives a full Kysely `Transaction<DB>` with query builder, `sql` template literal, and all Kysely features.

```typescript
import { sql } from 'kysely';

const result = await ctx.transaction(async (trx) => {
    await trx
        .updateTable('accounts')
        .set({ balance: sql`balance - ${amount}` })
        .where('id', '=', fromId)
        .execute();
    await trx
        .updateTable('accounts')
        .set({ balance: sql`balance + ${amount}` })
        .where('id', '=', toId)
        .execute();
    return { transferred: amount };
});
```


## Stored Procedures & Functions

Type-safe helpers for calling stored procedures and database functions. Define your procedure and function signatures as interfaces, then pass them as generics to `createContext`:

```typescript
interface MyProcs {
    'get_users': { department_id: number; active: boolean };
    'simple_proc': [number, string];
    'refresh_cache': void;
}

interface MyFuncs {
    'calc_total': { order_id: number };
    'add_numbers': [number, number];
    'get_version': void;
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs>({ config: 'dev' });
```

When `Procs` or `Funcs` are not provided, `proc()` and `func()` cannot be called — the type system enforces that you define signatures first.


### proc(name, params?)

Call a stored procedure and return the result set rows. Generates dialect-specific SQL:

| Dialect    | Named Params                          | Positional      | No Params     |
| ---------- | ------------------------------------- | --------------- | ------------- |
| MSSQL      | `EXEC name @k = $1`                   | `EXEC name $1`  | `EXEC name`   |
| PostgreSQL | `CALL name(k => $1)`                  | `CALL name($1)` | `CALL name()` |
| MySQL      | `CALL name($1)` (positional fallback) | `CALL name($1)` | `CALL name()` |

```typescript
// Named params
const users = await ctx.proc<User>('get_users', { department_id: 1, active: true });

// Positional params
await ctx.proc('simple_proc', [42, 'hello']);

// No params
await ctx.proc('refresh_cache');
```

**Returns:** `Promise<T[]>` — the result set rows.

**Throws** on SQLite (no stored procedure support).


### func(name, params?, column)

Call a database function and return the scalar result. Generates `SELECT name(...) AS column`. Named params are only supported on PostgreSQL; other dialects fall back to positional.

| Dialect    | Named Params                                   | Positional               | No Params              |
| ---------- | ---------------------------------------------- | ------------------------ | ---------------------- |
| MSSQL      | `EXEC @var = name @k = $1; SELECT @var AS col` | `SELECT name($1) AS col` | `SELECT name() AS col` |
| PostgreSQL | `SELECT name(k => $1) AS col`                  | `SELECT name($1) AS col` | `SELECT name() AS col` |
| MySQL      | `SELECT name($1) AS col` (positional fallback) | `SELECT name($1) AS col` | `SELECT name() AS col` |

```typescript
// Named params + column alias
const result = await ctx.func<{ total: number }>('calc_total', { order_id: 42 }, 'total');

// Positional params + column alias
const sum = await ctx.func<{ result: number }>('add_numbers', [1, 2], 'result');

// No params — just column alias
const ver = await ctx.func<{ v: string }>('get_version', 'v');
```

**Returns:** `Promise<T>` — the first row (scalar value as `{ column: value }`).

**Throws** on SQLite (no database function call support).


## ctx.noorm — Noorm Operations


### Properties

| Property   | Type             | Description                             |
| ---------- | ---------------- | --------------------------------------- |
| `config`   | `Config`         | The resolved config object              |
| `settings` | `Settings`       | Project settings (paths, rules, stages) |
| `identity` | `Identity`       | Current operator identity               |
| `observer` | `ObserverEngine` | Event observer for subscriptions        |


### Schema Operations


#### build(options?)

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.noorm.build({ force: true });
console.log(`Ran ${result.filesRun} files`);
```


#### truncate()

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.noorm.truncate();
console.log(`Truncated ${result.truncated.length} tables`);
```


#### teardown()

Drop all database objects except noorm tracking tables.

```typescript
const result = await ctx.noorm.teardown();
```


#### reset()

Full rebuild: teardown + build.

```typescript
await ctx.noorm.reset();
```


### File Runner


#### runFile(filepath, options?)

Execute a single SQL file.

```typescript
await ctx.noorm.runFile('seeds/test-data.sql');
```


#### runFiles(filepaths, options?)

Execute multiple SQL files sequentially.

```typescript
await ctx.noorm.runFiles([
    'functions/utils.sql',
    'triggers/audit.sql',
]);
```


#### runDir(dirpath, options?)

Execute all SQL files in a directory.

```typescript
await ctx.noorm.runDir('seeds/');
```


### Changes


#### applyChange(name, options?)

Apply a specific change.

```typescript
const result = await ctx.noorm.applyChange('2024-01-15-add-users');
```


#### revertChange(name, options?)

Revert a specific change.

```typescript
const result = await ctx.noorm.revertChange('2024-01-15-add-users');
```


#### fastForward()

Apply all pending changes.

```typescript
const result = await ctx.noorm.fastForward();
console.log(`Applied ${result.executed} changes`);
```


#### getChangeStatus()

Get status of all changes.

```typescript
const changes = await ctx.noorm.getChangeStatus();
for (const cs of changes) {
    console.log(`${cs.name}: ${cs.status}`);
}
```


#### getPendingChanges()

Get only pending changes.

```typescript
const pending = await ctx.noorm.getPendingChanges();
```


### Explore


#### listTables()

List all tables in the database.

```typescript
const tables = await ctx.noorm.listTables();
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`);
}
```


#### describeTable(name, schema?)

Get detailed information about a table.

```typescript
const detail = await ctx.noorm.describeTable('users');
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`);
    }
}
```


#### overview()

Get database overview with counts of all object types.

```typescript
const overview = await ctx.noorm.overview();
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`);
```


### Locks


#### acquireLock(options?)

Acquire a database lock.

```typescript
const lock = await ctx.noorm.acquireLock({ timeout: 60000 });
```


#### releaseLock()

Release the current lock.

```typescript
await ctx.noorm.releaseLock();
```


#### getLockStatus()

Get current lock status.

```typescript
const status = await ctx.noorm.getLockStatus();
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`);
}
```


#### withLock(fn, options?)

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.noorm.withLock(async () => {
    await ctx.noorm.build();
    await ctx.noorm.fastForward();
});
```


### Templates


#### renderTemplate(filepath)

Render a template file without executing.

```typescript
const result = await ctx.noorm.renderTemplate('sql/001_users.sql.tmpl');
console.log(result.sql);
```


### Transfer


#### transferTo(destConfig, options?)

Transfer data from this context's database to a destination config. Both contexts must be connected.

```typescript
const source = await createContext({ config: 'staging' });
const dest = await createContext({ config: 'dev' });
await source.connect();
await dest.connect();

const [result, err] = await source.noorm.transferTo(dest.noorm.config, {
    tables: ['users', 'posts'],
    onConflict: 'skip',
    batchSize: 5000,
});

if (result) {
    console.log(`Transferred ${result.totalRows} rows (${result.status})`);
}

await source.disconnect();
await dest.disconnect();
```

**Options (`TransferOptions`):**

| Option               | Type               | Default  | Description                                  |
| -------------------- | ------------------ | -------- | -------------------------------------------- |
| `tables`             | `string[]`         | all      | Tables to transfer. Empty = all user tables. |
| `onConflict`         | `ConflictStrategy` | `'fail'` | How to handle primary key conflicts.         |
| `batchSize`          | `number`           | `1000`   | Rows per batch for cross-server transfers.   |
| `disableForeignKeys` | `boolean`          | `true`   | Disable FK checks during transfer.           |
| `preserveIdentity`   | `boolean`          | `true`   | Preserve identity/auto-increment values.     |
| `truncateFirst`      | `boolean`          | `false`  | Truncate destination tables before transfer. |
| `dryRun`             | `boolean`          | `false`  | Validate only, don't execute.                |
| `exportPath`         | `string`           | —        | Export to .dt file instead of DB insert.     |
| `passphrase`         | `string`           | —        | Passphrase for .dtzx export encryption.      |


#### transferPlan(destConfig, options?)

Generate a transfer plan without executing. Inspects both databases and returns table ordering, row estimates, and warnings.

```typescript
const [plan, err] = await source.noorm.transferPlan(dest.noorm.config);
if (plan) {
    console.log(`${plan.estimatedRows} rows across ${plan.tables.length} tables`);
    for (const warning of plan.warnings) {
        console.warn(warning);
    }
}
```


### DT File Operations


#### exportTable(tableName, filepath, options?)

Export a table to a .dt file. The file extension determines the format: `.dt` (plain), `.dtz` (gzipped), `.dtzx` (encrypted).

```typescript
const [result, err] = await ctx.noorm.exportTable('users', './exports/users.dtz');
if (result) {
    console.log(`Exported ${result.rowsWritten} rows (${result.bytesWritten} bytes)`);
}

// Encrypted export
const [encrypted, encErr] = await ctx.noorm.exportTable('users', './exports/users.dtzx', {
    passphrase: 'my-secret',
});
```

**Options (`ExportOptions`):**

| Option       | Type     | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `passphrase` | `string` | Passphrase for .dtzx encryption.                  |
| `schema`     | `string` | Schema/namespace (e.g., 'public' for PostgreSQL). |
| `batchSize`  | `number` | Rows per batch. Default: 1000.                    |


#### importFile(filepath, options?)

Import a .dt file into the connected database.

```typescript
const [result, err] = await ctx.noorm.importFile('./exports/users.dtz', {
    onConflict: 'skip',
});
if (result) {
    console.log(`Imported ${result.rowsImported} rows, skipped ${result.rowsSkipped}`);
}
```

**Options (`ImportOptions`):**

| Option       | Type               | Default  | Description                          |
| ------------ | ------------------ | -------- | ------------------------------------ |
| `passphrase` | `string`           | —        | Passphrase for .dtzx decryption.     |
| `batchSize`  | `number`           | `1000`   | Rows per batch.                      |
| `onConflict` | `ConflictStrategy` | `'fail'` | Conflict strategy.                   |
| `truncate`   | `boolean`          | `false`  | Truncate target table before import. |


### History


#### getHistory(limit?)

Get execution history.

```typescript
const history = await ctx.noorm.getHistory(10);
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`);
}
```


### Secrets


#### getSecret(key)

Get a config-scoped secret.

```typescript
const apiKey = ctx.noorm.getSecret('API_KEY');
```


### Utilities


#### testConnection()

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.noorm.testConnection();
if (!result.ok) {
    console.error('Connection failed:', result.error);
}
```


#### computeChecksum(filepath)

Compute SHA-256 checksum for a file.

```typescript
const checksum = await ctx.noorm.computeChecksum('sql/001_users.sql');
```


### Event Subscriptions

Subscribe to core events via the observer:

```typescript
ctx.noorm.observer.on('file:after', (event) => {
    console.log(`Executed ${event.filepath} in ${event.durationMs}ms`);
});

ctx.noorm.observer.on('change:complete', (event) => {
    console.log(`Change ${event.name}: ${event.status}`);
});
```


## Environment Variables

The SDK supports environment variable overrides for CI/CD.


### Override Stored Configs

```bash
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONFIG=staging
```

Priority (highest to lowest):
1. `NOORM_*` env vars
2. Stored config
3. Stage defaults
4. Defaults


### Env-Only Mode

Run without stored configs by setting minimum required env vars:

```bash
export NOORM_CONNECTION_DIALECT=postgres
export NOORM_CONNECTION_DATABASE=mydb
export NOORM_CONNECTION_HOST=localhost
export NOORM_CONNECTION_USER=postgres
export NOORM_CONNECTION_PASSWORD=secret
```

```typescript
// No config name needed—uses env vars directly
const ctx = await createContext();
```


## Error Handling

```typescript
import {
    createContext,
    RequireTestError,
    ProtectedConfigError,
    LockAcquireError,
} from '@noormdev/sdk';

try {
    const ctx = await createContext({ config: 'prod', requireTest: true });
} catch (err) {
    if (err instanceof RequireTestError) {
        console.error('Cannot use production config in tests');
    }
}

try {
    await ctx.noorm.truncate();
} catch (err) {
    if (err instanceof ProtectedConfigError) {
        console.error('Cannot truncate protected database');
    }
}

try {
    await ctx.noorm.acquireLock();
} catch (err) {
    if (err instanceof LockAcquireError) {
        console.error(`Lock held by ${err.holder}`);
    }
}
```


## TypeScript Support

Use generics for type-safe Kysely access:

```typescript
interface Database {
    users: {
        id: number;
        name: string;
        email: string;
    };
    posts: {
        id: number;
        user_id: number;
        title: string;
    };
}

const ctx = await createContext<Database>({ config: 'dev' });
await ctx.connect();

// ctx.kysely is now Kysely<Database>—full type safety
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])
    .where('email', '=', email)
    .execute();
```


## Exported Types

```typescript
import type {
    // Core
    Context,
    NoormOps,
    CreateContextOptions,
    Config,
    Settings,
    Identity,
    Dialect,

    // Results
    BatchResult,
    FileResult,
    RunOptions,
    BuildOptions,

    // Changes
    ChangeResult,
    BatchChangeResult,
    ChangeListItem,
    ChangeOptions,
    ChangeHistoryRecord,

    // Explore
    TableSummary,
    TableDetail,
    ExploreOverview,

    // Operations
    TruncateResult,
    TeardownResult,

    // Locks
    Lock,
    LockStatus,
    LockOptions,

    // Templates
    TemplateResult,

    // Transfer
    TransferOptions,
    TransferPlan,
    TransferTablePlan,
    TransferResult,
    TransferTableResult,
    ConflictStrategy,

    // DT
    ExportOptions,
    ImportOptions,

    // Events
    NoormEvents,
    NoormEventNames,
} from '@noormdev/sdk';
```
