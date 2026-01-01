# noorm SDK


## Overview

The noorm SDK provides programmatic access to noorm-managed databases. Use it for:

- **Test suites** - Reset and seed databases between tests
- **Scripts** - Data migrations, exports, and automation
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

// Create a context for the 'dev' config
const ctx = await createContext({ config: 'dev' })

// Connect to the database
await ctx.connect()

// Run queries
const users = await ctx.query<{ id: number; name: string }>(
    'SELECT id, name FROM users'
)

// Disconnect when done
await ctx.disconnect()
```


## API Reference


### Factory Function

#### `createContext(options)`

Creates an SDK context for programmatic database access.

```typescript
interface CreateContextOptions<DB = unknown> {
    config?: string          // Config name (or use NOORM_CONFIG env var)
    projectRoot?: string     // Defaults to process.cwd()
    requireTest?: boolean    // Refuse if config.isTest !== true
    allowProtected?: boolean // Allow destructive ops on protected configs
    stage?: string           // Stage name for stage defaults
}

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
await ctx.fastForward()
await ctx.disconnect()
```

Minimum required env vars for env-only mode:
- `NOORM_CONNECTION_DIALECT` (postgres, mysql, sqlite, mssql)
- `NOORM_CONNECTION_DATABASE`

See the [Configuration documentation](./config.md) for the full list of supported environment variables.


### Properties

| Property | Type | Description |
|----------|------|-------------|
| `config` | `Config` | The loaded config object |
| `settings` | `Settings` | Project settings (paths, rules, stages) |
| `identity` | `Identity` | Current operator identity |
| `kysely` | `Kysely<DB>` | Direct Kysely access (requires connect()) |
| `dialect` | `Dialect` | Database dialect (postgres, mysql, etc.) |
| `connected` | `boolean` | Whether currently connected |
| `observer` | `ObserverEngine` | Event observer for subscriptions |


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

#### `testConnection()`

Tests if the connection can be established without actually connecting.

```typescript
const result = await ctx.testConnection()
if (!result.ok) {
    console.error('Connection failed:', result.error)
}
```


### SQL Execution

#### `query<T>(sql, params?)`

Execute a SELECT query and return rows.

```typescript
const users = await ctx.query<User>('SELECT * FROM users WHERE active = true')
```

> **Note:** For parameterized queries, use `ctx.kysely` directly with Kysely's type-safe query builder.

#### `execute(sql, params?)`

Execute an INSERT/UPDATE/DELETE statement.

```typescript
const result = await ctx.execute('DELETE FROM sessions WHERE expires_at < NOW()')
console.log(`Deleted ${result.rowsAffected} sessions`)
```

#### `transaction<T>(fn)`

Execute operations within a transaction.

```typescript
const result = await ctx.transaction(async (tx) => {
    await tx.execute('UPDATE accounts SET balance = balance - 100 WHERE id = 1')
    await tx.execute('UPDATE accounts SET balance = balance + 100 WHERE id = 2')
    return { transferred: 100 }
})
```


### Schema Operations

#### `build(options?)`

Execute all SQL files in the schema directory.

```typescript
const result = await ctx.build({ force: true })
console.log(`Ran ${result.filesRun} files`)
```

#### `truncate()`

Wipe all data, keeping the schema intact.

```typescript
const result = await ctx.truncate()
console.log(`Truncated ${result.truncated.length} tables`)
```

#### `teardown()`

Drop all database objects except noorm tracking tables.

```typescript
const result = await ctx.teardown()
```

#### `reset()`

Full rebuild: teardown + build.

```typescript
await ctx.reset()
```


### File Runner

#### `runFile(filepath, options?)`

Execute a single SQL file.

```typescript
await ctx.runFile('seeds/test-data.sql')
await ctx.runFile('/absolute/path/to/seed.sql')
```

#### `runFiles(filepaths, options?)`

Execute multiple SQL files sequentially.

```typescript
await ctx.runFiles([
    'functions/utils.sql',
    'triggers/audit.sql',
])
```

#### `runDir(dirpath, options?)`

Execute all SQL files in a directory.

```typescript
await ctx.runDir('seeds/')
```


### Changesets

#### `applyChangeset(name, options?)`

Apply a specific changeset.

```typescript
const result = await ctx.applyChangeset('2024-01-15-add-users')
```

#### `revertChangeset(name, options?)`

Revert a specific changeset.

```typescript
const result = await ctx.revertChangeset('2024-01-15-add-users')
```

#### `fastForward()`

Apply all pending changesets.

```typescript
const result = await ctx.fastForward()
console.log(`Applied ${result.executed} changesets`)
```

#### `getChangesetStatus()`

Get status of all changesets.

```typescript
const changesets = await ctx.getChangesetStatus()
for (const cs of changesets) {
    console.log(`${cs.name}: ${cs.status}`)
}
```

#### `getPendingChangesets()`

Get only pending changesets.

```typescript
const pending = await ctx.getPendingChangesets()
```


### Explore

#### `listTables()`

List all tables in the database.

```typescript
const tables = await ctx.listTables()
for (const table of tables) {
    console.log(`${table.name}: ${table.columnCount} columns`)
}
```

#### `describeTable(name, schema?)`

Get detailed information about a table.

```typescript
const detail = await ctx.describeTable('users')
if (detail) {
    for (const col of detail.columns) {
        console.log(`${col.name}: ${col.dataType}`)
    }
}
```

#### `overview()`

Get database overview with counts of all object types.

```typescript
const overview = await ctx.overview()
console.log(`Tables: ${overview.tables}, Views: ${overview.views}`)
```


### Locks

#### `acquireLock(options?)`

Acquire a database lock.

```typescript
const lock = await ctx.acquireLock({ timeout: 60000 })
```

#### `releaseLock()`

Release the current lock.

```typescript
await ctx.releaseLock()
```

#### `getLockStatus()`

Get current lock status.

```typescript
const status = await ctx.getLockStatus()
if (status.isLocked) {
    console.log(`Locked by ${status.lock.lockedBy}`)
}
```

#### `withLock(fn, options?)`

Execute an operation with automatic lock acquisition and release.

```typescript
await ctx.withLock(async () => {
    await ctx.build()
    await ctx.fastForward()
})
```


### Templates

#### `renderTemplate(filepath)`

Render a template file without executing.

```typescript
const result = await ctx.renderTemplate('schema/001_users.sql.tmpl')
console.log(result.sql)
```


### History

#### `getHistory(limit?)`

Get execution history.

```typescript
const history = await ctx.getHistory(10)
for (const record of history) {
    console.log(`${record.name}: ${record.status} at ${record.executedAt}`)
}
```


### Secrets

#### `getSecret(key)`

Get a config-scoped secret.

```typescript
const apiKey = ctx.getSecret('API_KEY')
```


### Utilities

#### `computeChecksum(filepath)`

Compute SHA-256 checksum for a file.

```typescript
const checksum = await ctx.computeChecksum('schema/001_users.sql')
```


### Event Subscriptions

Subscribe to core events via the observer:

```typescript
ctx.observer.on('file:after', (event) => {
    console.log(`Executed ${event.filepath} in ${event.durationMs}ms`)
})

ctx.observer.on('changeset:complete', (event) => {
    console.log(`Changeset ${event.name}: ${event.status}`)
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
        await ctx.reset()  // Clean slate
    })

    afterAll(async () => {
        await ctx.disconnect()
    })

    beforeEach(async () => {
        await ctx.truncate()  // Wipe between tests
    })

    it('creates a user', async () => {
        await ctx.execute('INSERT INTO users (name) VALUES (\'Alice\')')
        const rows = await ctx.query('SELECT * FROM users')
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

const users = await ctx.query('SELECT * FROM users WHERE active = true')
await writeJson('users-export.json', users)

await ctx.disconnect()
```


### Type Generation

```typescript
import { createContext } from 'noorm/sdk'

const ctx = await createContext({ config: 'dev' })
await ctx.connect()

const tables = await ctx.listTables()
for (const table of tables) {
    const detail = await ctx.describeTable(table.name)
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
const test = await ctx.testConnection()
if (!test.ok) {
    console.error('Database not available:', test.error)
    process.exit(1)
}

// Apply migrations with lock
await ctx.withLock(async () => {
    await ctx.fastForward()
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
    await ctx.truncate()
} catch (err) {
    if (err instanceof ProtectedConfigError) {
        console.error('Cannot truncate protected database')
    }
}

try {
    await ctx.acquireLock()
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

# Fast-forward changesets
noorm -H --config dev change/ff

# Apply single changeset
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
| `change` | List changeset status |
| `change/ff` | Apply pending changesets |
| `change/run` | Apply single changeset |
| `change/revert` | Revert single changeset |
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
name: Database Migrations
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
      - name: Apply migrations
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
