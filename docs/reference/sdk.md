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

const ctx = await createContext({ config: 'dev' });
await ctx.connect();

const users = await ctx.query<{ id: number; name: string }>(
    'SELECT id, name FROM users'
);

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

| Option | Type | Description |
|--------|------|-------------|
| `config` | `string` | Config name to use. Falls back to `NOORM_CONFIG` env var. |
| `projectRoot` | `string` | Path to noorm project. Defaults to `process.cwd()`. |
| `requireTest` | `boolean` | Throws `RequireTestError` if config doesn't have `isTest: true`. |
| `allowProtected` | `boolean` | Allows destructive operations on protected configs. |
| `stage` | `string` | Stage name for inheriting stage defaults. |


## Context Properties

| Property | Type | Description |
|----------|------|-------------|
| `config` | `Config` | The resolved config object |
| `settings` | `Settings` | Project settings (paths, rules, stages) |
| `identity` | `Identity` | Current operator identity |
| `kysely` | `Kysely<DB>` | Direct Kysely access (requires `connect()`) |
| `dialect` | `Dialect` | Database dialect (postgres, mysql, sqlite, mssql) |
| `connected` | `boolean` | Whether currently connected |
| `observer` | `ObserverEngine` | Event observer for subscriptions |


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


### testConnection()

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.testConnection();
if (!result.ok) {
    console.error('Connection failed:', result.error);
}
```


## SQL Execution


### query(sql, params?)

Execute a SELECT query and return rows.

```typescript
const users = await ctx.query<User>('SELECT * FROM users WHERE active = true');
```

For complex queries, use `ctx.kysely` directly for type-safe query building.


### execute(sql, params?)

Execute an INSERT/UPDATE/DELETE statement.

```typescript
const result = await ctx.execute('DELETE FROM sessions WHERE expires_at < NOW()');
console.log(`Deleted ${result.rowsAffected} sessions`);
```


### transaction(fn)

Execute operations within a transaction.

```typescript
const result = await ctx.transaction(async (tx) => {
    await tx.execute('UPDATE accounts SET balance = balance - 100 WHERE id = 1');
    await tx.execute('UPDATE accounts SET balance = balance + 100 WHERE id = 2');
    return { transferred: 100 };
});
```


## Schema Operations


### build(options?)

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.build({ force: true });
console.log(`Ran ${result.filesRun} files`);
```


### truncate()

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.truncate();
console.log(`Truncated ${result.truncated.length} tables`);
```


### teardown()

Drop all database objects except noorm tracking tables.

```typescript
const result = await ctx.teardown();
```


### reset()

Full rebuild: teardown + build.

```typescript
await ctx.reset();
```


## File Runner


### runFile(filepath, options?)

Execute a single SQL file.

```typescript
await ctx.runFile('seeds/test-data.sql');
```


### runFiles(filepaths, options?)

Execute multiple SQL files sequentially.

```typescript
await ctx.runFiles([
    'functions/utils.sql',
    'triggers/audit.sql',
]);
```


### runDir(dirpath, options?)

Execute all SQL files in a directory.

```typescript
await ctx.runDir('seeds/');
```


## Changes


### applyChange(name, options?)

Apply a specific change.

```typescript
const result = await ctx.applyChange('2024-01-15-add-users');
```


### revertChange(name, options?)

Revert a specific change.

```typescript
const result = await ctx.revertChange('2024-01-15-add-users');
```


### fastForward()

Apply all pending changes.

```typescript
const result = await ctx.fastForward();
console.log(`Applied ${result.executed} changes`);
```


### getChangeStatus()

Get status of all changes.

```typescript
const changes = await ctx.getChangeStatus();
for (const cs of changes) {
    console.log(`${cs.name}: ${cs.status}`);
}
```


### getPendingChanges()

Get only pending changes.

```typescript
const pending = await ctx.getPendingChanges();
```


## Explore


### listTables()

List all tables in the database.

```typescript
const tables = await ctx.listTables();
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`);
}
```


### describeTable(name, schema?)

Get detailed information about a table.

```typescript
const detail = await ctx.describeTable('users');
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`);
    }
}
```


### overview()

Get database overview with counts of all object types.

```typescript
const overview = await ctx.overview();
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`);
```


## Locks


### acquireLock(options?)

Acquire a database lock.

```typescript
const lock = await ctx.acquireLock({ timeout: 60000 });
```


### releaseLock()

Release the current lock.

```typescript
await ctx.releaseLock();
```


### getLockStatus()

Get current lock status.

```typescript
const status = await ctx.getLockStatus();
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`);
}
```


### withLock(fn, options?)

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.withLock(async () => {
    await ctx.build();
    await ctx.fastForward();
});
```


## Templates


### renderTemplate(filepath)

Render a template file without executing.

```typescript
const result = await ctx.renderTemplate('sql/001_users.sql.tmpl');
console.log(result.sql);
```


## History


### getHistory(limit?)

Get execution history.

```typescript
const history = await ctx.getHistory(10);
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`);
}
```


## Secrets


### getSecret(key)

Get a config-scoped secret.

```typescript
const apiKey = ctx.getSecret('API_KEY');
```


## Event Subscriptions

Subscribe to core events via the observer:

```typescript
ctx.observer.on('file:after', (event) => {
    console.log(`Executed ${event.filepath} in ${event.durationMs}ms`);
});

ctx.observer.on('change:complete', (event) => {
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
    await ctx.truncate();
} catch (err) {
    if (err instanceof ProtectedConfigError) {
        console.error('Cannot truncate protected database');
    }
}

try {
    await ctx.acquireLock();
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
    CreateContextOptions,
    Config,
    Settings,
    Identity,
    Dialect,

    // Results
    ExecuteResult,
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

    // Transactions
    TransactionContext,

    // Events
    NoormEvents,
    NoormEventNames,
} from '@noormdev/sdk';
```
