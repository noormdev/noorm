# noorm SDK


## Overview

The noorm SDK provides programmatic access to noorm-managed databases. Use it for:

- **Test suites** - Reset and seed databases between tests
- **Scripts** - Data transforms, exports, and automation
- **CI/CD** - Headless database operations
- **SDK generation** - Introspect schema to generate types


## Installation

The SDK is part of the main noorm package:

```typescript
import { createContext } from 'noorm/sdk'
```


## Quick Start

```typescript
import { createContext } from 'noorm/sdk'

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
await ctx.noorm.fastForward()

// Disconnect when done
await ctx.disconnect()
```


## API Structure

The Context API is split into two levels:

**Top-level** — SQL-focused operations you use in application code:
- `kysely`, `dialect`, `connected` — properties
- `connect()`, `disconnect()` — lifecycle
- `transaction()`, `proc()`, `func()` — SQL execution
- `noorm` — namespace for management operations

**ctx.noorm** — noorm management operations for schema, changes, and tooling:
- Schema: `build()`, `truncate()`, `teardown()`, `reset()`
- Changes: `applyChange()`, `revertChange()`, `fastForward()`, `getChangeStatus()`, `getPendingChanges()`
- Explore: `listTables()`, `describeTable()`, `overview()`
- Runner: `runFile()`, `runFiles()`, `runDir()`
- Locks: `acquireLock()`, `releaseLock()`, `getLockStatus()`, `withLock()`, `forceReleaseLock()`
- Transfer: `transferTo()`, `transferPlan()`
- DT: `exportTable()`, `importFile()`
- Templates: `renderTemplate()`
- History: `getHistory()`
- Secrets: `getSecret()`
- Utilities: `computeChecksum()`, `testConnection()`
- Properties: `config`, `settings`, `identity`, `observer`


## API Reference


### Factory Function

#### `createContext(options)`

Creates an SDK context for programmatic database access.

```typescript
interface CreateContextOptions<DB = unknown> {
    config?: string          // Config name (or use NOORM_CONFIG env var)
    projectRoot?: string     // Project root path (see note below)
    requireTest?: boolean    // Refuse if config.isTest !== true
    allowProtected?: boolean // Allow destructive ops on protected configs
    stage?: string           // Stage name for stage defaults
}
```

> **Finding the project root**: Unlike the CLI, the SDK does not automatically walk up directories to find the project. Pass `projectRoot` explicitly, or use [Project Discovery](./project-discovery.md) to find it first:
> ```typescript
> import { findProjectRoot } from 'noorm/core'
> const { projectRoot } = findProjectRoot()
> const ctx = await createContext({ projectRoot })
> ```

```typescript

const ctx = await createContext<MyDatabase>({
    config: 'test',
    requireTest: true,
})
```

**Safety Options:**

- `requireTest: true` - Throws `RequireTestError` if the config doesn't have `isTest: true`. Use this in test suites to prevent accidentally running against production.

- `allowProtected: true` - Allows destructive operations (`truncate`, `teardown`, `reset`) on configs with `protected: true`. Use with caution.


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
await ctx.noorm.fastForward()
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


### Stored Procedures & Functions

Stored procedures and database functions get their own type-safe methods. Define your signatures as interfaces and pass them as extra generics:

```typescript
interface MyProcs {
    'get_users': { department_id: number; active: boolean }
    'refresh_cache': void
}

interface MyFuncs {
    'calc_total': { order_id: number }
    'get_version': void
}

const ctx = await createContext<MyDB, MyProcs, MyFuncs>({ config: 'dev' })
await ctx.connect()

// Stored procedure — returns result set rows
const users = await ctx.proc<User>('get_users', { department_id: 1, active: true })

// Database function — returns scalar as { column: value }
const result = await ctx.func<{ total: number }>('calc_total', { order_id: 42 }, 'total')

// No-param variants
await ctx.proc('refresh_cache')
const ver = await ctx.func<{ v: string }>('get_version', 'v')
```

Parameter types control the call signature:

- **Object** → named params where the dialect supports it (MSSQL `@key =`, PG `key =>`), positional fallback on MySQL
- **Tuple** → always positional
- **void** → no params required

Both methods throw on SQLite, which has no stored procedure or function call support.


### ctx.noorm — Noorm Operations


#### Properties

| Property   | Type             | Description                             |
|------------|------------------|-----------------------------------------|
| `config`   | `Config`         | The resolved config object              |
| `settings` | `Settings`       | Project settings (paths, rules, stages) |
| `identity` | `Identity`       | Current operator identity               |
| `observer` | `ObserverEngine` | Event observer for subscriptions        |


#### Schema Operations

##### `build(options?)`

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.noorm.build({ force: true })
console.log(`Ran ${result.filesRun} files`)
```

##### `truncate()`

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.noorm.truncate()
console.log(`Truncated ${result.truncated.length} tables`)
```

##### `teardown()`

Drop all database objects except noorm tracking tables.

```typescript
const result = await ctx.noorm.teardown()
```

##### `reset()`

Full rebuild: teardown + build.

```typescript
await ctx.noorm.reset()
```


#### File Runner

##### `runFile(filepath, options?)`

Execute a single SQL file.

```typescript
await ctx.noorm.runFile('seeds/test-data.sql')
await ctx.noorm.runFile('/absolute/path/to/seed.sql')
```

##### `runFiles(filepaths, options?)`

Execute multiple SQL files sequentially.

```typescript
await ctx.noorm.runFiles([
    'functions/utils.sql',
    'triggers/audit.sql',
])
```

##### `runDir(dirpath, options?)`

Execute all SQL files in a directory.

```typescript
await ctx.noorm.runDir('seeds/')
```


#### Changes

##### `applyChange(name, options?)`

Apply a specific change.

```typescript
const result = await ctx.noorm.applyChange('2024-01-15-add-users')
```

##### `revertChange(name, options?)`

Revert a specific change.

```typescript
const result = await ctx.noorm.revertChange('2024-01-15-add-users')
```

##### `fastForward()`

Apply all pending changes.

```typescript
const result = await ctx.noorm.fastForward()
console.log(`Applied ${result.executed} changes`)
```

##### `getChangeStatus()`

Get status of all changes.

```typescript
const changes = await ctx.noorm.getChangeStatus()
for (const cs of changes) {
    console.log(`${cs.name}: ${cs.status}`)
}
```

##### `getPendingChanges()`

Get only pending changes.

```typescript
const pending = await ctx.noorm.getPendingChanges()
```


#### Explore

##### `listTables()`

List all tables in the database.

```typescript
const tables = await ctx.noorm.listTables()
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`)
}
```

##### `describeTable(name, schema?)`

Get detailed information about a table.

```typescript
const detail = await ctx.noorm.describeTable('users')
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`)
    }
}
```

##### `overview()`

Get database overview with counts of all object types.

```typescript
const overview = await ctx.noorm.overview()
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`)
```


#### Locks

##### `acquireLock(options?)`

Acquire a database lock.

```typescript
const lock = await ctx.noorm.acquireLock({ timeout: 60000 })
```

##### `releaseLock()`

Release the current lock.

```typescript
await ctx.noorm.releaseLock()
```

##### `getLockStatus()`

Get current lock status.

```typescript
const status = await ctx.noorm.getLockStatus()
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`)
}
```

##### `withLock(fn, options?)`

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.noorm.withLock(async () => {
    await ctx.noorm.build()
    await ctx.noorm.fastForward()
})
```


#### Templates

##### `renderTemplate(filepath)`

Render a template file without executing.

```typescript
const result = await ctx.noorm.renderTemplate('sql/001_users.sql.tmpl')
console.log(result.sql)
```


#### History

##### `getHistory(limit?)`

Get execution history.

```typescript
const history = await ctx.noorm.getHistory(10)
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`)
}
```


#### Secrets

##### `getSecret(key)`

Get a config-scoped secret.

```typescript
const apiKey = ctx.noorm.getSecret('API_KEY')
```


#### Utilities

##### `computeChecksum(filepath)`

Compute SHA-256 checksum for a file.

```typescript
const checksum = await ctx.noorm.computeChecksum('sql/001_users.sql')
```

##### `testConnection()`

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.noorm.testConnection()
if (!result.ok) {
    console.error('Connection failed:', result.error)
}
```


#### Transfer

##### `transferTo(destConfig, options?)`

Transfer data from this context's database to a destination. Both must be connected.

```typescript
const source = await createContext({ config: 'staging' })
const dest = await createContext({ config: 'dev' })
await source.connect()
await dest.connect()

const [result, err] = await source.noorm.transferTo(dest.noorm.config, {
    tables: ['users', 'posts'],
    onConflict: 'skip',
})

await source.disconnect()
await dest.disconnect()
```

##### `transferPlan(destConfig, options?)`

Generate a transfer plan without executing.

```typescript
const [plan, err] = await source.noorm.transferPlan(dest.noorm.config)
if (plan) {
    console.log(`${plan.estimatedRows} rows across ${plan.tables.length} tables`)
}
```


#### DT File Operations

##### `exportTable(tableName, filepath, options?)`

Export a table to a .dt file. Extension determines format: `.dt`, `.dtz` (gzipped), `.dtzx` (encrypted).

```typescript
const [result, err] = await ctx.noorm.exportTable('users', './exports/users.dtz')
```

##### `importFile(filepath, options?)`

Import a .dt file into the connected database.

```typescript
const [result, err] = await ctx.noorm.importFile('./exports/users.dtz', {
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
import { createContext, Context } from 'noorm/sdk'

describe('User API', () => {
    let ctx: Context

    beforeAll(async () => {
        ctx = await createContext({ config: 'test', requireTest: true })
        await ctx.connect()
        await ctx.noorm.reset()  // Clean slate
    })

    afterAll(async () => {
        await ctx.disconnect()
    })

    beforeEach(async () => {
        await ctx.noorm.truncate()  // Wipe between tests
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
import { createContext } from 'noorm/sdk'

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
import { createContext } from 'noorm/sdk'

const ctx = await createContext({ config: 'dev' })
await ctx.connect()

const tables = await ctx.noorm.listTables()
for (const table of tables) {
    const detail = await ctx.noorm.describeTable(table.name)
    generateTypeDefinition(detail)
}

await ctx.disconnect()
```


### CI/CD Pipeline

```typescript
import { createContext } from 'noorm/sdk'

const ctx = await createContext({ config: process.env.DB_CONFIG })
await ctx.connect()

// Test connection
const test = await ctx.noorm.testConnection()
if (!test.ok) {
    console.error('Database not available:', test.error)
    process.exit(1)
}

// Apply changes with lock
await ctx.noorm.withLock(async () => {
    await ctx.noorm.fastForward()
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
} from 'noorm/sdk'

try {
    const ctx = await createContext({ config: 'prod', requireTest: true })
} catch (err) {
    if (err instanceof RequireTestError) {
        console.error('Cannot use production config in tests')
    }
}

try {
    await ctx.noorm.truncate()
} catch (err) {
    if (err instanceof ProtectedConfigError) {
        console.error('Cannot truncate protected database')
    }
}

try {
    await ctx.noorm.acquireLock()
} catch (err) {
    if (err instanceof LockAcquireError) {
        console.error(`Lock held by ${err.holder}`)
    }
}
```


## Headless/CI Mode


### CLI Headless Commands

noorm supports headless mode for CI/CD pipelines. Use `-H` or `--headless` flag:

```bash
# Build schema
noorm -H --config dev run/build

# Fast-forward changes
noorm -H --config dev change/ff

# Apply single change
noorm -H --config dev change/run --name 2024-01-15-add-users

# Truncate database
noorm -H --config test db/truncate

# Get JSON output for scripting
noorm -H --json --config dev change/ff | jq '.status'
```


### Available Headless Commands

| Route | Description |
|-------|-------------|
| `run/build` | Build schema from SQL files |
| `run/file` | Run single SQL file |
| `run/dir` | Run all files in directory |
| `db/truncate` | Truncate all tables |
| `db/teardown` | Drop all objects |
| `db/explore` | Database overview |
| `db/explore/tables` | List tables |
| `db/explore/tables/detail` | Describe a table |
| `change` | List change status |
| `change/ff` | Apply pending changes |
| `change/run` | Apply single change |
| `change/revert` | Revert single change |
| `change/history` | Execution history |
| `lock/status` | Lock status |
| `lock/acquire` | Acquire lock |
| `lock/release` | Release lock |


### Headless Detection

Headless mode is auto-detected when:
- `--headless` or `-H` flag is passed
- `NOORM_HEADLESS=true` environment variable
- CI environment variables (`CI`, `GITHUB_ACTIONS`, `GITLAB_CI`, etc.)
- No TTY available

Use `--tui` to force TUI mode in CI environments.


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
          npx noorm -H --config ${{ vars.DB_CONFIG }} change/ff
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
