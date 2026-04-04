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
await ctx.noorm.changes.ff();

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


## Stored Procedures, Functions & TVFs

Type-safe helpers for calling stored procedures, database functions, and table-valued functions. Define your signatures as interfaces, then pass them as generics to `createContext`:

```typescript
interface MyProcs {
    'get_users': [{ department_id: number; active: boolean }, User];
    'simple_proc': [[number, string], void];
    'refresh_cache': void;
}

interface MyFuncs {
    'calc_total': [{ order_id: number }, { total: number }];
    'add_numbers': [[number, number], { result: number }];
    'get_version': void;
}

interface MyTvfs {
    'get_team_members': [{ team_id: number }, TeamMember];
    'generate_series': [[number, number], { value: number }];
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs, MyTvfs>({ config: 'dev' });
```

Each entry maps a name to an `[Args, ReturnType]` tuple. For positional params, wrap in a nested tuple: `[[number, string], ReturnType]`. Plain `void` is shorthand for `[void, void]`.

When `Procs`, `Funcs`, or `Tvfs` are not provided, the corresponding method (`proc()`, `func()`, `tvf()`) cannot be called — the type system enforces that you define signatures first.


### proc(name, params?)

Call a stored procedure and return the result set rows. Generates dialect-specific SQL:

| Dialect    | Named Params                          | Positional      | No Params     |
| ---------- | ------------------------------------- | --------------- | ------------- |
| MSSQL      | `EXEC name @k = $1`                   | `EXEC name $1`  | `EXEC name`   |
| PostgreSQL | `CALL name(k => $1)`                  | `CALL name($1)` | `CALL name()` |
| MySQL      | `CALL name($1)` (positional fallback) | `CALL name($1)` | `CALL name()` |

```typescript
// Named params — return type inferred from tuple
const users = await ctx.proc('get_users', { department_id: 1, active: true });
// users: User[]

// Positional params
await ctx.proc('simple_proc', [42, 'hello']);

// No params
await ctx.proc('refresh_cache');

// Override return type explicitly
const custom = await ctx.proc<'get_users', CustomUser>('get_users', { department_id: 1, active: true });
// custom: CustomUser[]
```

**Returns:** `Promise<T[]>` — the result set rows. `T` is inferred from the `[Args, ReturnType]` tuple, or overridden via the second generic.

**Throws** on SQLite (no stored procedure support).


### func(name, params?, column)

Call a database function and return the scalar result. Generates `SELECT name(...) AS column`. Named params are only supported on PostgreSQL; other dialects fall back to positional.

| Dialect    | Named Params                                   | Positional               | No Params              |
| ---------- | ---------------------------------------------- | ------------------------ | ---------------------- |
| MSSQL      | `EXEC @var = name @k = $1; SELECT @var AS col` | `SELECT name($1) AS col` | `SELECT name() AS col` |
| PostgreSQL | `SELECT name(k => $1) AS col`                  | `SELECT name($1) AS col` | `SELECT name() AS col` |
| MySQL      | `SELECT name($1) AS col` (positional fallback) | `SELECT name($1) AS col` | `SELECT name() AS col` |

```typescript
// Named params + column alias — return type inferred from tuple
const result = await ctx.func('calc_total', { order_id: 42 }, 'total');
// result: { total: number }

// Positional params + column alias
const sum = await ctx.func('add_numbers', [1, 2], 'result');
// sum: { result: number }

// No params — just column alias
const ver = await ctx.func('get_version', 'v');

// Override return type explicitly
const custom = await ctx.func<'calc_total', { amount: number }>('calc_total', { order_id: 42 }, 'amount');
// custom: { amount: number }
```

**Returns:** `Promise<T>` — the first row (scalar value as `{ column: value }`). `T` is inferred from the `[Args, ReturnType]` tuple, or overridden via the second generic.

**Throws** on SQLite (no database function call support).


### tvf(name, params?)

Call a table-valued function and return the result set rows. Supported on MSSQL and PostgreSQL only.

| Dialect    | Named Params                         | Positional                | No Params               |
| ---------- | ------------------------------------ | ------------------------- | ----------------------- |
| MSSQL      | `SELECT * FROM name(@k = $1)`       | `SELECT * FROM name($1)` | `SELECT * FROM name()`  |
| PostgreSQL | `SELECT * FROM name(k => $1)`       | `SELECT * FROM name($1)` | `SELECT * FROM name()`  |

```typescript
// Named params — return type inferred from tuple
const members = await ctx.tvf('get_team_members', { team_id: 5 });
// members: TeamMember[]

// Positional params
const series = await ctx.tvf('generate_series', [1, 10]);
// series: { value: number }[]

// Override return type explicitly
const custom = await ctx.tvf<'get_team_members', CustomMember>('get_team_members', { team_id: 5 });
// custom: CustomMember[]
```

**Returns:** `Promise<T[]>` — the result set rows. `T` is inferred from the `[Args, ReturnType]` tuple, or overridden via the second generic.

**Throws** on SQLite and MySQL (no table-valued function support).


## ctx.noorm — Noorm Operations


### Properties

| Property   | Type             | Description                             |
| ---------- | ---------------- | --------------------------------------- |
| `config`   | `Config`         | The resolved config object              |
| `settings` | `Settings`       | Project settings (paths, rules, stages) |
| `identity` | `Identity`       | Current operator identity               |
| `observer` | `ObserverEngine` | Event observer for subscriptions        |


### ctx.noorm.run — Run Operations


#### run.build(options?)

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.noorm.run.build({ force: true });
console.log(`Ran ${result.filesRun} files`);
```


#### run.file(filepath, options?)

Execute a single SQL file.

```typescript
await ctx.noorm.run.file('seeds/test-data.sql');
```


#### run.files(filepaths, options?)

Execute multiple SQL files sequentially.

```typescript
await ctx.noorm.run.files([
    'functions/utils.sql',
    'triggers/audit.sql',
]);
```


#### run.dir(dirpath, options?)

Execute all SQL files in a directory.

```typescript
await ctx.noorm.run.dir('seeds/');
```


#### run.discover(dirpath?)

Discover SQL files in a directory without executing. Works offline — no connection required. Defaults to the project's configured SQL path.

```typescript
const files = await ctx.noorm.run.discover('sql/');
console.log(`Found ${files.length} SQL files`);
```

**Returns:** `Promise<string[]>` — absolute paths to discovered SQL files.


#### run.preview(filepaths, output?)

Render SQL files (including templates) without executing. Useful for reviewing what would run before committing.

```typescript
const results = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql']);
for (const r of results) {
    console.log(`${r.filepath}:\n${r.sql}`);
}
```

**Returns:** `Promise<FileResult[]>` — rendered SQL for each file.


### ctx.noorm.db — Database Operations


#### db.truncate()

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.noorm.db.truncate();
console.log(`Truncated ${result.truncated.length} tables`);
```


#### db.teardown()

Drop all database objects except noorm tracking tables.

```typescript
const result = await ctx.noorm.db.teardown();
```


#### db.previewTeardown()

Preview what teardown would drop without executing. Useful for confirming destructive operations before running them.

```typescript
const preview = await ctx.noorm.db.previewTeardown();
for (const obj of preview.objects) {
    console.log(`Would drop ${obj.type}: ${obj.name}`);
}
```

**Returns:** `Promise<TeardownPreview>` — list of objects that would be dropped.


#### db.reset()

Full rebuild: teardown + build.

```typescript
await ctx.noorm.db.reset();
```


### ctx.noorm.changes — Change Management


#### Scaffold Operations (offline)

These operations work without a database connection — they manage change directories on disk.


#### changes.create(options)

Create a new change directory with `change/` and `revert/` folders.

```typescript
const change = await ctx.noorm.changes.create({ description: 'add-user-roles' });
console.log(change.name); // e.g. '2024-01-15-add-user-roles'
```

**Returns:** `Promise<Change>` — the parsed change object.


#### changes.addFile(change, folder, options)

Add a file to a change's `change/` or `revert/` folder.

```typescript
const updated = await ctx.noorm.changes.addFile(change, 'change', {
    name: 'create-table',
    type: 'sql',
});
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.removeFile(change, folder, filename)

Remove a file from a change.

```typescript
await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql');
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.renameFile(change, folder, oldFilename, newDescription)

Rename a file in a change folder. Preserves the numeric prefix.

```typescript
await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name');
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.reorderFiles(change, folder, newOrder)

Reorder files in a change folder. Pass filenames in the desired order — numeric prefixes are reassigned.

```typescript
await ctx.noorm.changes.reorderFiles(change, 'change', [
    '002_b.sql',
    '001_a.sql',
]);
```

**Returns:** `Promise<Change>` — the updated change object.


#### changes.delete(change)

Delete a change directory from disk entirely.

```typescript
await ctx.noorm.changes.delete(change);
```


#### changes.discover()

Discover all changes on disk. Works offline — scans the configured changes directory.

```typescript
const changes = await ctx.noorm.changes.discover();
console.log(`Found ${changes.length} changes`);
```

**Returns:** `Promise<Change[]>` — all parsed change objects.


#### changes.parse(name)

Parse a single change from disk by name.

```typescript
const change = await ctx.noorm.changes.parse('2024-01-15-add-users');
```

**Returns:** `Promise<Change>` — the parsed change object.


#### changes.validate(change)

Validate a change's structure. Throws `ChangeValidationError` if the change is malformed.

```typescript
ctx.noorm.changes.validate(change);
```

**Returns:** `void` — throws on invalid structure.


#### Execution Operations (connected)


#### changes.apply(name, options?)

Apply a specific change.

```typescript
const result = await ctx.noorm.changes.apply('2024-01-15-add-users');
```


#### changes.revert(name, options?)

Revert a specific change.

```typescript
const result = await ctx.noorm.changes.revert('2024-01-15-add-users');
```


#### changes.ff()

Apply all pending changes.

```typescript
const result = await ctx.noorm.changes.ff();
console.log(`Applied ${result.executed} changes`);
```


#### changes.status()

Get status of all changes.

```typescript
const changes = await ctx.noorm.changes.status();
for (const cs of changes) {
    console.log(`${cs.name}: ${cs.status}`);
}
```


#### changes.pending()

Get only pending changes.

```typescript
const pending = await ctx.noorm.changes.pending();
```


### ctx.noorm.db — Explore


#### db.listTables()

List all tables in the database.

```typescript
const tables = await ctx.noorm.db.listTables();
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`);
}
```


#### db.describeTable(name, schema?)

Get detailed information about a table.

```typescript
const detail = await ctx.noorm.db.describeTable('users');
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`);
    }
}
```


#### db.overview()

Get database overview with counts of all object types.

```typescript
const overview = await ctx.noorm.db.overview();
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`);
```


### ctx.noorm.lock — Lock Management


#### lock.acquire(options?)

Acquire a database lock.

```typescript
const lock = await ctx.noorm.lock.acquire({ timeout: 60000 });
```


#### lock.release()

Release the current lock.

```typescript
await ctx.noorm.lock.release();
```


#### lock.status()

Get current lock status.

```typescript
const status = await ctx.noorm.lock.status();
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`);
}
```


#### lock.withLock(fn, options?)

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.noorm.lock.withLock(async () => {
    await ctx.noorm.run.build();
    await ctx.noorm.changes.ff();
});
```


#### lock.forceRelease()

Force release any database lock regardless of ownership. Use when a lock is stuck due to a crashed process or stale session.

```typescript
const released = await ctx.noorm.lock.forceRelease();
if (released) {
    console.log('Stale lock cleared');
}
```

**Returns:** `Promise<boolean>` — `true` if a lock was released, `false` if none existed.


### ctx.noorm.templates — Template Operations


#### templates.render(filepath)

Render a template file without executing.

```typescript
const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl');
console.log(result.sql);
```


### ctx.noorm.transfer — Transfer Operations


#### transfer.to(destConfig, options?)

Transfer data from this context's database to a destination config. Both contexts must be connected.

```typescript
const source = await createContext({ config: 'staging' });
const dest = await createContext({ config: 'dev' });
await source.connect();
await dest.connect();

const [result, err] = await source.noorm.transfer.to(dest.noorm.config, {
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


#### transfer.plan(destConfig, options?)

Generate a transfer plan without executing. Inspects both databases and returns table ordering, row estimates, and warnings.

```typescript
const [plan, err] = await source.noorm.transfer.plan(dest.noorm.config);
if (plan) {
    console.log(`${plan.estimatedRows} rows across ${plan.tables.length} tables`);
    for (const warning of plan.warnings) {
        console.warn(warning);
    }
}
```


### ctx.noorm.dt — DT File Operations


#### dt.exportTable(tableName, filepath, options?)

Export a table to a .dt file. The file extension determines the format: `.dt` (plain), `.dtz` (gzipped), `.dtzx` (encrypted).

```typescript
const [result, err] = await ctx.noorm.dt.exportTable('users', './exports/users.dtz');
if (result) {
    console.log(`Exported ${result.rowsWritten} rows (${result.bytesWritten} bytes)`);
}

// Encrypted export
const [encrypted, encErr] = await ctx.noorm.dt.exportTable('users', './exports/users.dtzx', {
    passphrase: 'my-secret',
});
```

**Options (`ExportOptions`):**

| Option       | Type     | Description                                       |
| ------------ | -------- | ------------------------------------------------- |
| `passphrase` | `string` | Passphrase for .dtzx encryption.                  |
| `schema`     | `string` | Schema/namespace (e.g., 'public' for PostgreSQL). |
| `batchSize`  | `number` | Rows per batch. Default: 1000.                    |


#### dt.importFile(filepath, options?)

Import a .dt file into the connected database.

```typescript
const [result, err] = await ctx.noorm.dt.importFile('./exports/users.dtz', {
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


### ctx.noorm.changes — History


#### changes.history(limit?)

Get execution history.

```typescript
const history = await ctx.noorm.changes.history(10);
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`);
}
```


### ctx.noorm.secrets — Secrets


#### secrets.get(key)

Get a config-scoped secret.

```typescript
const apiKey = ctx.noorm.secrets.get('API_KEY');
```


### ctx.noorm.vault — Vault (Encrypted Team Secrets)

Database-stored encrypted secrets shared across team members. Unlike config-scoped secrets, vault secrets live in the database and are encrypted with identity keypairs.


#### vault.init()

Initialize the vault for this database. Creates the vault key and stores it encrypted for the current identity.

```typescript
const [vaultKey, err] = await ctx.noorm.vault.init();
if (err) {
    console.error('Vault init failed:', err.message);
}
```

**Returns:** `Promise<[Buffer | null, Error | null]>` — the vault key buffer or an error.


#### vault.status()

Get vault status for the current identity.

```typescript
const status = await ctx.noorm.vault.status();
console.log(`Initialized: ${status.initialized}, Has access: ${status.hasAccess}`);
```

**Returns:** `Promise<VaultStatus>`


#### vault.set(key, value, privateKey)

Set a vault secret. Requires the caller's private key for vault key decryption.

```typescript
const [, err] = await ctx.noorm.vault.set('API_KEY', 'sk-live-...', privateKey);
if (err) {
    console.error('Failed to set secret:', err.message);
}
```

**Returns:** `Promise<[void, Error | null]>`


#### vault.get(key, privateKey)

Get a single vault secret by key.

```typescript
const value = await ctx.noorm.vault.get('API_KEY', privateKey);
```

**Returns:** `Promise<string | null>` — the decrypted value, or `null` if not found or no access.


#### vault.getAll(privateKey)

Get all vault secrets as a key-value map with metadata.

```typescript
const all = await ctx.noorm.vault.getAll(privateKey);
for (const [key, secret] of Object.entries(all)) {
    console.log(`${key}: set by ${secret.setBy}`);
}
```

**Returns:** `Promise<Record<string, VaultSecret>>`


#### vault.list()

List all vault secret keys without decrypting values. Does not require a private key.

```typescript
const keys = await ctx.noorm.vault.list();
console.log('Available secrets:', keys.join(', '));
```

**Returns:** `Promise<string[]>`


#### vault.delete(key)

Delete a vault secret.

```typescript
const [deleted, err] = await ctx.noorm.vault.delete('OLD_KEY');
if (deleted) {
    console.log('Secret removed');
}
```

**Returns:** `Promise<[boolean, Error | null]>`


#### vault.exists(key)

Check if a vault secret exists without decrypting.

```typescript
const exists = await ctx.noorm.vault.exists('API_KEY');
```

**Returns:** `Promise<boolean>`


#### vault.propagate(privateKey)

Propagate vault key to all team identities that don't yet have access. Run after adding new team members.

```typescript
const result = await ctx.noorm.vault.propagate(privateKey);
console.log(`Propagated to ${result.propagatedTo.length} new users`);
```

**Returns:** `Promise<VaultPropagationResult>`


#### vault.copy(destConfig, keys, privateKey, options?)

Copy vault secrets to another config's database. Useful for seeding a new environment with secrets from an existing one.

```typescript
const [result, err] = await ctx.noorm.vault.copy(
    destConfig,
    ['API_KEY', 'DB_TOKEN'],
    privateKey,
);
if (result) {
    console.log(`Copied ${result.copied} secrets`);
}
```

**Returns:** `Promise<[VaultCopyResult | null, Error | null]>`


### ctx.noorm.utils — Utilities


#### utils.testConnection()

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.noorm.utils.testConnection();
if (!result.ok) {
    console.error('Connection failed:', result.error);
}
```


#### utils.checksum(filepath)

Compute SHA-256 checksum for a file.

```typescript
const checksum = await ctx.noorm.utils.checksum('sql/001_users.sql');
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
    await ctx.noorm.db.truncate();
} catch (err) {
    if (err instanceof ProtectedConfigError) {
        console.error('Cannot truncate protected database');
    }
}

try {
    await ctx.noorm.lock.acquire();
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
    Change,
    CreateChangeOptions,
    AddFileOptions,
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
    TeardownPreview,

    // Locks
    Lock,
    LockStatus,
    LockOptions,

    // Templates
    TemplateResult,

    // Vault
    VaultSecret,
    VaultStatus,
    VaultCopyResult,
    VaultCopyOptions,
    VaultPropagationResult,

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
