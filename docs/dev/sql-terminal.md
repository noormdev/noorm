# SQL Terminal


## The Problem

You're debugging a change. Did that INSERT actually work? What's in the table now? You could switch to a database client, reconnect with credentials, run a query—or you could just stay in noorm.

The SQL terminal provides an interactive REPL for running arbitrary SQL queries. Execute SELECT, INSERT, UPDATE, DELETE, or any other SQL your database supports. Results are displayed in a formatted table, and query history is persisted with compressed result storage.


## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                     SQL Terminal                             │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ > SELECT * FROM users LIMIT 5                          │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ id │ email            │ name   │ created_at            │ │
│  ├────┼──────────────────┼────────┼───────────────────────┤ │
│  │ 1  │ alice@example... │ Alice  │ 2024-01-15T10:30:00Z │ │
│  │ 2  │ bob@example.com  │ Bob    │ 2024-01-15T11:45:00Z │ │
│  └────────────────────────────────────────────────────────┘ │
│                                                              │
│  5 rows (42ms)                                              │
└─────────────────────────────────────────────────────────────┘
```

The terminal executes queries via Kysely's `sql.raw()` and stores history per-config in `.noorm/state/history/`.

Every query passes an access-policy gate first. `executeRawSql` classifies the statement as `read`, `write`, or `ddl` and checks that class against the config's `access` role for the calling channel, so the SDK, CLI, and TUI all inherit one enforcement path.


## Quick Start

```typescript
import { executeRawSql, SqlHistoryManager } from './core/sql-terminal'

// Execute a query — the gate is mandatory
const gate = { access: config.access, channel: 'user', dialect: 'postgres' }
const result = await executeRawSql(db, 'SELECT * FROM users LIMIT 10', 'production', gate)

if (result.success) {
    console.log('Columns:', result.columns)
    console.log('Rows:', result.rows)
    console.log(`${result.rows?.length} rows in ${result.durationMs}ms`)
}
else {
    console.error('Error:', result.errorMessage)
}

// Track query history
const history = new SqlHistoryManager('/project', 'production')

// Add entry and save results
const entryId = await history.addEntry('SELECT * FROM users', result)

// Load previous results
const savedResult = await history.loadResults(entryId)
```


## Executing Queries

The `executeRawSql` function handles any SQL statement. The fourth argument is the `SqlPolicyGate` — `{ access, channel, dialect }` — and it is required:

```typescript
import { executeRawSql } from './core/sql-terminal'
import type { SqlPolicyGate } from './core/sql-terminal'

const gate: SqlPolicyGate = {
    access: config.access,
    channel: 'user',
    dialect: 'postgres',
}

// SELECT query — gated by `sql:read`
const selectResult = await executeRawSql(db, `
    SELECT id, email, created_at
    FROM users
    WHERE active = true
    ORDER BY created_at DESC
    LIMIT 20
`, 'production', gate)

// {
//     success: true,
//     columns: ['id', 'email', 'created_at'],
//     rows: [{ id: 1, email: 'alice@...', created_at: '...' }, ...],
//     durationMs: 12
// }

// INSERT/UPDATE/DELETE — gated by `sql:write`
const dmlResult = await executeRawSql(db, `
    UPDATE users SET last_login = NOW() WHERE id = 1
`, 'production', gate)

// {
//     success: true,
//     rowsAffected: 1,
//     durationMs: 5
// }

// DDL statements work too — gated by `sql:ddl`
const ddlResult = await executeRawSql(db, `
    CREATE INDEX users_email_idx ON users(email)
`, 'production', gate)
```

### Error Handling

Failed queries return structured error information:

```typescript
const result = await executeRawSql(db, 'SELECT * FROM nonexistent', 'dev', gate)

if (!result.success) {
    console.error(result.errorMessage)
    // "relation \"nonexistent\" does not exist"
}
```

A policy denial is different: `executeRawSql` **throws** with the policy's blocked reason rather than returning `{ success: false }`. Only the query itself failing produces a result object.

### `executeRawSqlUnchecked`

`src/core/sql-terminal/executor.ts:52` exports an ungated variant that skips classification and runs the SQL directly. It is deliberately left out of the module barrel — import it from `./executor.js` only, and only from tests exercising the Kysely plumbing. No production surface may call it.


## History Management

The `SqlHistoryManager` class persists query history and results:

```typescript
import { SqlHistoryManager } from './core/sql-terminal'

const history = new SqlHistoryManager('/project', 'production')
```

### Storage Structure

```
.noorm/
└── state/
    └── history/
        ├── production.json                # History index
        └── production/
            ├── <uuid>.results.gz          # Gzipped results
            ├── <uuid>.results.gz
            └── ...
```

History entries are stored in JSON. Query results are gzipped separately to keep the index file small. Both the index and the result files hold verbatim query text and every returned row in the clear, so the manager writes files `0600` and directories `0700` — and re-`chmod`s them on every write, to tighten anything an older version left world-readable.

### Adding Entries

```typescript
// Execute and store
const result = await executeRawSql(db, 'SELECT * FROM users', 'production', gate)
const entryId = await history.addEntry('SELECT * FROM users', result)

// Results are saved to a gzipped file only when the query succeeded and
// returned at least one row. Otherwise the entry has no `resultsFile`.
console.log(entryId)  // a UUID v4
```

### Browsing History

```typescript
// Get recent queries
const recent = await history.getRecent(50)

for (const entry of recent) {
    console.log(`${entry.executedAt.toISOString()}: ${entry.query.slice(0, 50)}...`)
    console.log(`  ${entry.success ? '✓' : '✗'} ${entry.rowCount ?? 0} rows, ${entry.durationMs}ms`)
}
```

### Loading Saved Results

```typescript
// Get full results for a history entry
const savedResult = await history.loadResults(entryId)

if (savedResult) {
    console.log('Columns:', savedResult.columns)
    console.log('Rows:', savedResult.rows)
}
```

### Cleanup

```typescript
// Clear entries older than 3 months
const cleared = await history.clearOlderThan(3)
console.log(`Removed ${cleared.entriesRemoved} entries, ${cleared.filesRemoved} files`)

// Clear all history
const allCleared = await history.clearAll()

// Get storage stats
const stats = await history.getStats()
console.log(`${stats.entryCount} entries, ${formatBytes(stats.resultsSize)} stored`)
```


## Type Definitions

### SqlExecutionResult

```typescript
interface SqlExecutionResult {
    success: boolean
    errorMessage?: string
    columns?: string[]
    rows?: Record<string, unknown>[]
    rowsAffected?: number
    durationMs: number
}
```

### SqlHistoryEntry

```typescript
interface SqlHistoryEntry {
    id: string                    // UUID
    query: string                 // The SQL query
    executedAt: Date              // When executed
    durationMs: number            // Execution time
    success: boolean              // Whether it succeeded
    errorMessage?: string         // Error if failed
    rowCount?: number             // Rows returned/affected
    resultsFile?: string          // Path to gzipped results
}
```

### ClearResult

```typescript
interface ClearResult {
    entriesRemoved: number        // History entries deleted
    filesRemoved: number          // Result files deleted
}
```


## Observer Events

| Event | Payload | When |
|-------|---------|------|
| `sql-terminal:execute:before` | `{ query, configName }` | Before query execution |
| `sql-terminal:execute:after` | success: `{ query, configName, success: true, durationMs, rowCount, rowsAffected }`<br>failure: `{ query, configName, success: false, durationMs, error }` | After execution |

```typescript
import { observer } from './core/observer'

observer.on('sql-terminal:execute:before', ({ query, configName }) => {
    console.log(`Executing on ${configName}: ${query.slice(0, 50)}...`)
})

observer.on('sql-terminal:execute:after', ({ success, durationMs, rowCount }) => {
    if (success) {
        console.log(`✓ ${rowCount} rows in ${durationMs}ms`)
    }
})
```


## CLI Integration

`Shift+Q` opens the SQL terminal from anywhere in the TUI — it is a global shortcut, not an entry on the database menu (`d` on the database screen is destroy, `t` is teardown).

1. Select a config with an active connection
2. Press `Shift+Q`
3. Type queries and press Enter to execute

Keyboard shortcuts in terminal:

| Key | Action |
|-----|--------|
| `Enter` | Execute query |
| `↑/↓` | Navigate history |
| `Tab` | Auto-complete (tables/columns) |
| `Ctrl+C` | Clear current input |
| `Esc` | Exit terminal |

Additional screens:

- **History** - Browse past queries, re-run, or view results
- **Clear** - Manage history cleanup (by age or clear all)


## Result Display

The CLI displays results in a formatted table:

```
┌─────┬────────────────────┬────────┬───────────────────────┐
│ id  │ email              │ name   │ created_at            │
├─────┼────────────────────┼────────┼───────────────────────┤
│ 1   │ alice@example.com  │ Alice  │ 2024-01-15T10:30:00Z │
│ 2   │ bob@example.com    │ Bob    │ 2024-01-15T11:45:00Z │
└─────┴────────────────────┴────────┴───────────────────────┘

2 rows (15ms)
```

Long values are truncated with ellipsis. Use the detail view to see full cell contents.


## Best Practices

1. **Use for verification** - After running changes, verify data with quick SELECT queries.

2. **Limit large queries** - Always use LIMIT when exploring tables with many rows.

3. **Review before DML** - Use SELECT to verify your WHERE clause before UPDATE/DELETE.

4. **Clear old history** - Periodically run `clearOlderThan()` to manage storage.

5. **Don't store secrets** - Avoid queries containing sensitive data—history is stored in plaintext (gzipped and owner-only at `0600`, but not encrypted).

```typescript
// Good - verify before delete
const preview = await executeRawSql(db,
    'SELECT id, email FROM users WHERE last_login < NOW() - INTERVAL 1 YEAR',
    'production',
    gate
)
console.log(`Would delete ${preview.rows?.length} users`)

// Then execute
await executeRawSql(db,
    'DELETE FROM users WHERE last_login < NOW() - INTERVAL 1 YEAR',
    'production',
    gate
)
```
