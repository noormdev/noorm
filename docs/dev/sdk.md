# noorm SDK


## Overview

The noorm SDK provides programmatic access to noorm-managed databases. Use it for:

- **Test suites** - Reset and seed databases between tests
- **Scripts** - Data transforms, exports, and automation
- **CI/CD** - Headless database operations
- **SDK generation** - Introspect schema to generate types


## Installation

The SDK is published as a standalone `@noormdev/sdk` package:

```bash
pnpm add @noormdev/sdk
```


## Quick Start

```typescript
import { createContext } from '@noormdev/sdk'

// Create a typed context for the 'dev' config
const ctx = await createContext<{ users: { id: number; name: string } }>({
    config: 'dev',
})

// Connect to the database
await ctx.connect()

// Type-safe queries via Kysely (top-level)
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])
    .execute()

// Noorm operations via namespace
await ctx.noorm.changes.ff()

// Disconnect when done
await ctx.disconnect()
```


## API Structure

The Context API is split into two levels:

**Top-level** — SQL-focused operations you use in application code:
- `kysely`, `dialect`, `connected` — properties
- `connect()`, `disconnect()` — lifecycle
- `transaction()`, `proc()`, `func()`, `tvf()` — SQL execution
- `noorm` — namespace for management operations

**ctx.noorm** — noorm management operations, organized by namespace:
- `run`: `build()`, `file()`, `files()`, `dir()`, `discover()`, `preview()`
- `db`: `truncate()`, `teardown()`, `previewTeardown()`, `reset()`, `listTables()`, `describeTable()`, `overview()`
- `changes`: `apply()`, `revert()`, `ff()`, `status()`, `pending()`, `history()`, `create()`, `addFile()`, `removeFile()`, `renameFile()`, `reorderFiles()`, `delete()`, `discover()`, `parse()`, `validate()`
- `lock`: `acquire()`, `release()`, `status()`, `withLock()`, `forceRelease()`
- `dt`: `exportTable()`, `importFile()`
- `transfer`: `to()`, `plan()`
- `templates`: `render()`
- `secrets`: `get()`
- `vault`: `init()`, `status()`, `set()`, `get()`, `getAll()`, `list()`, `delete()`, `exists()`, `propagate()`, `copy()`
- `utils`: `checksum()`, `testConnection()`
- Properties: `config`, `settings`, `identity`, `observer`


## API Reference


### Factory Function

#### `createContext(options)`

Creates an SDK context for programmatic database access.

```typescript
interface CreateContextOptions {
    config?: string          // Config name (or use NOORM_CONFIG env var)
    projectRoot?: string     // Project root path (see note below)
    requireTest?: boolean    // Refuse if config.isTest !== true
    channel?: Channel        // 'user' (default) or 'mcp' — which access role applies
    stage?: string           // Stage name for stage defaults
}
```

> **Finding the project root**: `projectRoot` defaults to `process.cwd()`. That's correct when your script runs from the project directory. When running from elsewhere (a monorepo tooling package, a CI step with a different working directory), pass the directory containing `.noorm/` explicitly:
> ```typescript
> const ctx = await createContext({ projectRoot: '/path/to/project' })
> ```

```typescript

const ctx = await createContext<MyDatabase>({
    config: 'test',
    requireTest: true,
})
```

**Safety Options:**

- `requireTest: true` - Throws `RequireTestError` if the config doesn't have `isTest: true`. Use this in test suites to prevent accidentally running against production.

- `channel: 'mcp'` - Enforces the config's `access.mcp` role instead of `access.user` for destructive operations (`truncate`, `teardown`, `reset`, `changes.revert`). Use this when embedding the SDK behind an MCP-like surface. Defaults to `'user'`. A denied or unconfirmable operation throws `ProtectedConfigError` — the SDK has no prompt, so a `confirm`-tier permission needs `NOORM_YES=1` or the CLI/TUI. See [Access Roles](./config.md#access-roles).


### Environment Variable Support

The SDK supports environment variable overrides and env-only mode for CI/CD.


#### ENV Overrides

Override any config property via `NOORM_*` environment variables:

```bash
# Override connection host for CI runner
export NOORM_CONNECTION_HOST=db.ci.internal
export NOORM_CONFIG=staging
```

```typescript
// SDK uses 'staging' config with host overridden
const ctx = await createContext()
```

Priority (highest to lowest):
1. `NOORM_*` env vars
2. Stored config
3. Stage defaults
4. Defaults


#### Env-Only Mode (No Stored Config)

In CI pipelines, you can run without any stored configs:

```bash
# GitHub Actions
env:
    NOORM_CONNECTION_DIALECT: postgres
    NOORM_CONNECTION_HOST: ${{ secrets.DB_HOST }}
    NOORM_CONNECTION_DATABASE: ${{ secrets.DB_NAME }}
    NOORM_CONNECTION_USER: ${{ secrets.DB_USER }}
    NOORM_CONNECTION_PASSWORD: ${{ secrets.DB_PASSWORD }}

steps:
    - run: node deploy.js
```

```typescript
// deploy.js - no config name needed
const ctx = await createContext()
await ctx.connect()
await ctx.noorm.changes.ff()
await ctx.disconnect()
```

Minimum required env vars for env-only mode:
- `NOORM_CONNECTION_DIALECT` (postgres, mysql, sqlite, mssql)
- `NOORM_CONNECTION_DATABASE`

See the [Configuration documentation](./config.md) for the full list of supported environment variables.


### Top-Level Properties

| Property    | Type         | Description                                  |
|-------------|--------------|----------------------------------------------|
| `kysely`    | `Kysely<DB>` | Direct Kysely access (requires connect())    |
| `dialect`   | `Dialect`    | Database dialect (postgres, mysql, etc.)      |
| `connected` | `boolean`    | Whether currently connected                   |
| `noorm`     | `NoormOps`   | Noorm management operations (lazy singleton)  |


### Lifecycle Methods

#### `connect()`

Establishes the database connection.

```typescript
await ctx.connect()
```

#### `disconnect()`

Closes the database connection.

```typescript
await ctx.disconnect()
```


### Transactions

#### `transaction<T>(fn)`

Execute operations within a database transaction. The callback receives a full Kysely `Transaction<DB>` with query builder, `sql` template literal, and all Kysely features.

```typescript
import { sql } from 'kysely'

const result = await ctx.transaction(async (trx) => {
    await trx
        .updateTable('accounts')
        .set({ balance: sql`balance - ${100}` })
        .where('id', '=', 1)
        .execute()
    await trx
        .updateTable('accounts')
        .set({ balance: sql`balance + ${100}` })
        .where('id', '=', 2)
        .execute()
    return { transferred: 100 }
})
```


### Stored Procedures, Functions & TVFs

Stored procedures, database functions, and table-valued functions get their own type-safe methods. Define your signatures as interfaces using `[Args, ReturnType]` tuples and pass them as extra generics:

```typescript
interface MyProcs {
    'get_users': [{ department_id: number; active: boolean }, User]
    'refresh_cache': void   // shorthand for [void, void]
}

interface MyFuncs {
    'calc_total': [{ order_id: number }, { total: number }]
    'get_version': void
}

interface MyTvfs {
    'get_department_users': [{ dept_id: number }, DeptUser]
    'split_string': [{ input: string; delimiter: string }, { value: string }]
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs, MyTvfs>({ config: 'dev' })
await ctx.connect()

// Stored procedure — return type inferred from tuple
const users = await ctx.proc('get_users', { department_id: 1, active: true })

// Override return type when needed
const custom = await ctx.proc<'get_users', CustomUser>('get_users', { department_id: 1, active: true })

// Database function — return type inferred from tuple
const result = await ctx.func('calc_total', { order_id: 42 }, 'total')

// Override return type when needed
const custom2 = await ctx.func<'calc_total', { total: bigint }>('calc_total', { order_id: 42 }, 'total')

// Table-valued function — returns multiple rows like proc()
const deptUsers = await ctx.tvf('get_department_users', { dept_id: 5 })

// No-param variants
await ctx.proc('refresh_cache')
const ver = await ctx.func('get_version', 'v')
```

Parameter types control the call signature:

- **Object** → named params where the dialect supports it (MSSQL `@key =`, PG `key =>`), positional fallback on MySQL
- **Tuple** → always positional
- **void** → no params required

`proc()` and `func()` throw on SQLite, which has no stored procedure or function call support. `tvf()` is only available on MSSQL and PostgreSQL.


#### Parameter handling and NULL semantics

The SDK serializes both `undefined` and `null` to SQL `NULL` when
building named-parameter `EXEC` / `CALL` statements. If a key is
present in the params object — regardless of whether the value is
`undefined` or `null` — the SDK emits `@key = NULL` (or the
dialect-specific equivalent). The SDK does NOT silently drop
`undefined` keys.

This is a deliberate convention. Mapping both JavaScript "no value"
shapes to a single wire-level meaning makes serialization predictable
through `JSON.stringify`, Zod's `.optional()`, and conditional spread
patterns. The cost is that you cannot rely on a SQL proc's `DEFAULT`
value through an optional Zod field — MSSQL applies `DEFAULT` only when
the parameter is *omitted from the call*, and the SDK never omits.

When authoring SDK call sites or domain wrappers that target MSSQL
procs with `DEFAULT` parameters, prefer one of:

```typescript
// A — encode the default in the validator.
const memoryFlags = z.object({
    wasInferred: z.boolean().default(false),
    wasObserved: z.boolean().default(false),
})

// B — omit the key entirely from the params object when "absent".
const params: Record<string, unknown> = { content: 'x' }
if (wasInferred !== undefined) {
    params.wasInferred = wasInferred
}
await ctx.proc('sp_Memory_Create', params)
```

If you are extending the SDK with a new dialect or proc-call code
path, preserve this contract: present-key-is-NULL, absent-key-is-omit.
See the user-facing reference at
[`docs/reference/sdk.md`](../reference/sdk.md#parameter-handling-and-null-semantics)
for the consumer-side narrative.


### ctx.noorm — Noorm Operations


#### Properties

| Property   | Type             | Description                             |
|------------|------------------|-----------------------------------------|
| `config`   | `Config`         | The resolved config object              |
| `settings` | `Settings`       | Project settings (paths, rules, stages) |
| `identity` | `Identity`       | Current operator identity               |
| `observer` | `ObserverEngine` | Event observer for subscriptions        |


#### Schema Operations

##### `run.build(options?)`

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.noorm.run.build({ force: true })
console.log(`Ran ${result.filesRun} files`)
```

##### `db.truncate()`

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.noorm.db.truncate()
console.log(`Truncated ${result.truncated.length} tables`)
```

##### `db.teardown()`

Drop all database objects except noorm tracking tables.

```typescript
const result = await ctx.noorm.db.teardown()
```

##### `db.previewTeardown()`

Preview what teardown would drop without executing.

```typescript
const preview = await ctx.noorm.db.previewTeardown()
```

##### `db.reset()`

Full rebuild: teardown + build.

```typescript
await ctx.noorm.db.reset()
```


#### File Runner

##### `run.file(filepath, options?)`

Execute a single SQL file.

```typescript
await ctx.noorm.run.file('seeds/test-data.sql')
await ctx.noorm.run.file('/absolute/path/to/seed.sql')
```

##### `run.files(filepaths, options?)`

Execute multiple SQL files sequentially.

```typescript
await ctx.noorm.run.files([
    'functions/utils.sql',
    'triggers/audit.sql',
])
```

##### `run.dir(dirpath, options?)`

Execute all SQL files in a directory.

```typescript
await ctx.noorm.run.dir('seeds/')
```

##### `run.discover(dirpath?)`

Discover SQL files in a directory. Defaults to the configured SQL directory.

```typescript
const files = await ctx.noorm.run.discover('sql/')
```

##### `run.preview(filepaths, output?)`

Preview SQL files — render templates without executing.

```typescript
const results = await ctx.noorm.run.preview(['sql/001.sql', 'sql/002.sql'])
```


#### Changes

##### `changes.apply(name, options?)`

Apply a specific change.

```typescript
const result = await ctx.noorm.changes.apply('2024-01-15-add-users')
```

##### `changes.revert(name, options?)`

Revert a specific change.

```typescript
const result = await ctx.noorm.changes.revert('2024-01-15-add-users')
```

##### `changes.ff()`

Apply all pending changes.

```typescript
const result = await ctx.noorm.changes.ff()
console.log(`Applied ${result.executed} changes`)
```

##### `changes.status()`

Get status of all changes.

```typescript
const changes = await ctx.noorm.changes.status()
for (const cs of changes) {
    console.log(`${cs.name}: ${cs.status}`)
}
```

##### `changes.pending()`

Get only pending changes.

```typescript
const pending = await ctx.noorm.changes.pending()
```

##### `changes.history(limit?)`

Get execution history.

```typescript
const history = await ctx.noorm.changes.history(10)
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`)
}
```

##### Scaffold Methods

These methods work offline (no database connection required) and manage change directories on disk.

##### `changes.create(options)`

Create a new change directory with change/ and revert/ folders.

```typescript
const change = await ctx.noorm.changes.create({ description: 'add-user-roles' })
```

##### `changes.addFile(change, folder, options)`

Add a file to a change.

```typescript
const updated = await ctx.noorm.changes.addFile(change, 'change', {
    name: 'create-table',
    type: 'sql',
})
```

##### `changes.removeFile(change, folder, filename)`

Remove a file from a change.

```typescript
await ctx.noorm.changes.removeFile(change, 'change', '001_create-table.sql')
```

##### `changes.renameFile(change, folder, oldFilename, newDescription)`

Rename a file in a change.

```typescript
await ctx.noorm.changes.renameFile(change, 'change', '001_old.sql', 'new-name')
```

##### `changes.reorderFiles(change, folder, newOrder)`

Reorder files in a change folder.

```typescript
await ctx.noorm.changes.reorderFiles(change, 'change', ['002_b.sql', '001_a.sql'])
```

##### `changes.delete(change)`

Delete a change directory from disk.

```typescript
await ctx.noorm.changes.delete(change)
```

##### `changes.discover()`

Discover all changes on disk.

```typescript
const changes = await ctx.noorm.changes.discover()
```

##### `changes.parse(name)`

Parse a single change from disk by name.

```typescript
const change = await ctx.noorm.changes.parse('2024-01-15-add-users')
```

##### `changes.validate(change)`

Validate a change's structure. Throws `ChangeValidationError` if invalid.

```typescript
ctx.noorm.changes.validate(change)
```


#### Explore

##### `db.listTables()`

List all tables in the database.

```typescript
const tables = await ctx.noorm.db.listTables()
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`)
}
```

##### `db.describeTable(name, schema?)`

Get detailed information about a table.

```typescript
const detail = await ctx.noorm.db.describeTable('users')
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`)
    }
}
```

##### `db.overview()`

Get database overview with counts of all object types.

```typescript
const overview = await ctx.noorm.db.overview()
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`)
```


#### Locks

##### `lock.acquire(options?)`

Acquire a database lock.

```typescript
const lock = await ctx.noorm.lock.acquire({ timeout: 60000 })
```

##### `lock.release()`

Release the current lock.

```typescript
await ctx.noorm.lock.release()
```

##### `lock.status()`

Get current lock status.

```typescript
const status = await ctx.noorm.lock.status()
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`)
}
```

##### `lock.withLock(fn, options?)`

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.noorm.lock.withLock(async () => {
    await ctx.noorm.run.build()
    await ctx.noorm.changes.ff()
})
```

##### `lock.forceRelease()`

Force release any database lock regardless of ownership. Returns `true` if a lock was released.

```typescript
await ctx.noorm.lock.forceRelease()
```


#### Templates

##### `templates.render(filepath)`

Render a template file without executing.

```typescript
const result = await ctx.noorm.templates.render('sql/001_users.sql.tmpl')
console.log(result.sql)
```


#### Secrets

##### `secrets.get(key)`

Get a config-scoped secret.

```typescript
const apiKey = ctx.noorm.secrets.get('API_KEY')
```


#### Vault

Encrypted team secrets stored in the database. All operations require a connection. Operations that decrypt secrets require the user's private key.

##### `vault.init()`

Initialize the vault for this database.

```typescript
const [vaultKey, err] = await ctx.noorm.vault.init()
```

##### `vault.status()`

Get vault status.

```typescript
const status = await ctx.noorm.vault.status()
```

##### `vault.set(key, value, privateKey)`

Set a vault secret.

```typescript
const [, err] = await ctx.noorm.vault.set('API_KEY', 'sk-live-...', privateKey)
```

##### `vault.get(key, privateKey)`

Get a vault secret by key. Returns `null` if not found or no vault access.

```typescript
const value = await ctx.noorm.vault.get('API_KEY', privateKey)
```

##### `vault.getAll(privateKey)`

Get all vault secrets.

```typescript
const all = await ctx.noorm.vault.getAll(privateKey)
```

##### `vault.list()`

List all vault secret keys without decrypting values.

```typescript
const keys = await ctx.noorm.vault.list()
```

##### `vault.delete(key)`

Delete a vault secret.

```typescript
const [deleted, err] = await ctx.noorm.vault.delete('OLD_KEY')
```

##### `vault.exists(key)`

Check if a vault secret exists.

```typescript
const exists = await ctx.noorm.vault.exists('API_KEY')
```

##### `vault.propagate(privateKey)`

Propagate vault key to all users without access.

```typescript
const result = await ctx.noorm.vault.propagate(privateKey)
```

##### `vault.copy(destConfig, keys, privateKey, options?)`

Copy vault secrets to another config's database.

```typescript
const [result, err] = await ctx.noorm.vault.copy(destConfig, ['API_KEY'], privateKey)
```


#### Utilities

##### `utils.checksum(filepath)`

Compute SHA-256 checksum for a file.

```typescript
const checksum = await ctx.noorm.utils.checksum('sql/001_users.sql')
```

##### `utils.testConnection()`

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.noorm.utils.testConnection()
if (!result.ok) {
    console.error('Connection failed:', result.error)
}
```


#### Transfer

##### `transfer.to(destConfig, options?)`

Transfer data from this context's database to a destination.

```typescript
const source = await createContext({ config: 'staging' })
const dest = await createContext({ config: 'dev' })
await source.connect()
await dest.connect()

const [result, err] = await source.noorm.transfer.to(dest.noorm.config, {
    tables: ['users', 'posts'],
    onConflict: 'skip',
})

await source.disconnect()
await dest.disconnect()
```

##### `transfer.plan(destConfig, options?)`

Generate a transfer plan without executing.

```typescript
const [plan, err] = await source.noorm.transfer.plan(dest.noorm.config)
if (plan) {
    console.log(`${plan.estimatedRows} rows across ${plan.tables.length} tables`)
}
```


#### DT File Operations

##### `dt.exportTable(tableName, filepath, options?)`

Export a table to a .dt file. Extension determines format: `.dt`, `.dtz` (gzipped), `.dtzx` (encrypted).

```typescript
const [result, err] = await ctx.noorm.dt.exportTable('users', './exports/users.dtz')
```

##### `dt.importFile(filepath, options?)`

Import a .dt file into the connected database.

```typescript
const [result, err] = await ctx.noorm.dt.importFile('./exports/users.dtz', {
    onConflict: 'skip',
})
```


#### Event Subscriptions

Subscribe to core events via the observer:

```typescript
ctx.noorm.observer.on('file:after', (event) => {
    console.log(`Executed ${event.filepath} in ${event.durationMs}ms`)
})

ctx.noorm.observer.on('change:complete', (event) => {
    console.log(`Change ${event.name}: ${event.status}`)
})
```


## Use Cases


### Test Suites (Jest/Vitest)

```typescript
import { createContext, Context } from '@noormdev/sdk'

describe('User API', () => {
    let ctx: Context

    beforeAll(async () => {
        ctx = await createContext({ config: 'test', requireTest: true })
        await ctx.connect()
        await ctx.noorm.db.reset()  // Clean slate
    })

    afterAll(async () => {
        await ctx.disconnect()
    })

    beforeEach(async () => {
        await ctx.noorm.db.truncate()  // Wipe between tests
    })

    it('creates a user', async () => {
        await ctx.kysely
            .insertInto('users')
            .values({ name: 'Alice' })
            .execute()
        const rows = await ctx.kysely
            .selectFrom('users')
            .selectAll()
            .execute()
        expect(rows).toHaveLength(1)
    })
})
```


### Scripts and Tooling

```typescript
import { createContext } from '@noormdev/sdk'

// Data export script
const ctx = await createContext({ config: 'prod' })
await ctx.connect()

const users = await ctx.kysely
    .selectFrom('users')
    .selectAll()
    .where('active', '=', true)
    .execute()
await writeJson('users-export.json', users)

await ctx.disconnect()
```


### Type Generation

```typescript
import { createContext } from '@noormdev/sdk'

const ctx = await createContext({ config: 'dev' })
await ctx.connect()

const tables = await ctx.noorm.db.listTables()
for (const table of tables) {
    const detail = await ctx.noorm.db.describeTable(table.name)
    generateTypeDefinition(detail)
}

await ctx.disconnect()
```


### CI/CD Pipeline

```typescript
import { createContext } from '@noormdev/sdk'

const ctx = await createContext({ config: process.env.DB_CONFIG })
await ctx.connect()

// Test connection
const test = await ctx.noorm.utils.testConnection()
if (!test.ok) {
    console.error('Database not available:', test.error)
    process.exit(1)
}

// Apply changes with lock
await ctx.noorm.lock.withLock(async () => {
    await ctx.noorm.changes.ff()
})

await ctx.disconnect()
```


## Error Handling

```typescript
import {
    createContext,
    RequireTestError,
    ProtectedConfigError,
    LockAcquireError,
} from '@noormdev/sdk'

try {
    const ctx = await createContext({ config: 'prod', requireTest: true })
} catch (err) {
    if (err instanceof RequireTestError) {
        console.error('Cannot use production config in tests')
    }
}

try {
    await ctx.noorm.db.truncate()
} catch (err) {
    if (err instanceof ProtectedConfigError) {
        console.error('Denied by the config\'s access role, or needs confirmation the SDK can\'t give')
    }
}

try {
    await ctx.noorm.lock.acquire()
} catch (err) {
    if (err instanceof LockAcquireError) {
        console.error(`Lock held by ${err.holder}`)
    }
}
```


## Headless/CI Mode


### CLI Commands

Every `noorm` subcommand runs as a non-interactive CLI by default — there is no `--headless` flag, no mode detection, no CI heuristic. The interactive Ink/React TUI lives behind a dedicated `noorm ui` subcommand. Subcommands are space-separated (the old `change/ff` slash notation is gone):

```bash
# Build schema
noorm --config dev run build

# Fast-forward changes
noorm --config dev change ff

# Apply single change
noorm --config dev change run 2024-01-15-add-users

# Truncate database
noorm --config test db truncate

# JSON output for scripting
noorm --json --config dev change ff | jq '.status'
```


### Common CLI Routes

| Command | Description |
|---------|-------------|
| `run build` | Build schema from SQL files |
| `run file <path>` | Run single SQL file |
| `run dir <path>` | Run all files in directory |
| `run preview <path>` | Render a `.sql.tmpl` without executing |
| `run inspect <path>` | Inspect template context |
| `db truncate` | Truncate all tables |
| `db teardown` | Drop all objects |
| `db explore` | Database overview |
| `db explore tables` | List tables |
| `db explore tables detail <name>` | Describe a table |
| `db transfer` | DB-to-DB / export / import (`--to`, `--export`, `--import`) |
| `change` | List change status |
| `change ff` | Apply pending changes |
| `change run <name>` | Apply single change |
| `change revert <name>` | Revert single change |
| `change history` | Execution history |
| `lock status` | Lock status |
| `lock acquire` | Acquire lock |
| `lock release` | Release lock |
| `lock force` | Force-release a lock |
| `vault init` / `set` / `list` / `rm` / `cp` / `propagate` | Encrypted team-secret store |
| `info` | Project, schema, identity, and connection summary |
| `sql "<query>"` | Execute a raw SQL query |

Append `--help` to any command to see its arguments, options, and curated examples — citty renders help natively.


### GitHub Actions Example

```yaml
name: Database Changes
on:
  push:
    branches: [main]

jobs:
  migrate:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - run: npm ci
      - name: Apply changes
        run: |
          npx noorm --config ${{ vars.DB_CONFIG }} change ff
        env:
          DB_HOST: ${{ secrets.DB_HOST }}
          DB_PASSWORD: ${{ secrets.DB_PASSWORD }}
```


## TypeScript Support

The SDK is fully typed. Use generics for type-safe Kysely access:

```typescript
interface Database {
    users: {
        id: number
        name: string
        email: string
    }
    posts: {
        id: number
        user_id: number
        title: string
    }
}

const ctx = await createContext<Database>({ config: 'dev' })
await ctx.connect()

// ctx.kysely is now Kysely<Database> - full type safety
const users = await ctx.kysely
    .selectFrom('users')
    .select(['id', 'name'])       // Autocomplete works
    .where('email', '=', email)   // Type-checked
    .execute()
```
