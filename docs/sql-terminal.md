# SQL Terminal


## The Problem

You're debugging a migration. Did that INSERT actually work? What's in the table now? You could switch to a database client, reconnect with credentials, run a query—or you could just stay in noorm.

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

The terminal executes queries via Kysely's `sql.raw()` and stores history per-config in `.noorm/sql-history/`.


## Quick Start

```typescript
import { executeRawSql, SqlHistoryManager } from './core/sql-terminal'

// Execute a query
const result = await executeRawSql(db, 'SELECT * FROM users LIMIT 10', 'production')

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

The `executeRawSql` function handles any SQL statement:

```typescript
import { executeRawSql } from './core/sql-terminal'

// SELECT query
const selectResult = await executeRawSql(db, `
    SELECT id, email, created_at
    FROM users
    WHERE active = true
    ORDER BY created_at DESC
    LIMIT 20
`, 'production')

// {
//     success: true,
//     columns: ['id', 'email', 'created_at'],
//     rows: [{ id: 1, email: 'alice@...', created_at: '...' }, ...],
//     durationMs: 12
// }

// INSERT/UPDATE/DELETE
const dmlResult = await executeRawSql(db, `
    UPDATE users SET last_login = NOW() WHERE id = 1
`, 'production')

// {
//     success: true,
//     rowsAffected: 1,
//     durationMs: 5
// }

// DDL statements work too
const ddlResult = await executeRawSql(db, `
    CREATE INDEX users_email_idx ON users(email)
`, 'production')
```

### Error Handling

Failed queries return structured error information:

```typescript
const result = await executeRawSql(db, 'SELECT * FROM nonexistent', 'dev')

if (!result.success) {
    console.error(result.errorMessage)
    // "relation \"nonexistent\" does not exist"
}
```


## History Management

The `SqlHistoryManager` class persists query history and results:

```typescript
import { SqlHistoryManager } from './core/sql-terminal'

const history = new SqlHistoryManager('/project', 'production')
```

### Storage Structure

```
.noorm/
└── sql-history/
    ├── production.json                    # History index
    └── production/
        ├── abc123-def456.results.gz       # Gzipped results
        ├── ghi789-jkl012.results.gz
        └── ...
```

History entries are stored in JSON. Query results are gzipped separately to keep the index file small.

### Adding Entries

```typescript
// Execute and store
const result = await executeRawSql(db, 'SELECT * FROM users', 'production')
const entryId = await history.addEntry('SELECT * FROM users', result)

// Results are automatically saved to gzipped file
console.log(entryId)  // "abc123-def456-..."
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
| `sql-terminal:execute:after` | `{ query, configName, success, durationMs, rowCount?, error? }` | After execution |

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

Access the SQL terminal through the database menu:

1. Press `d` from home to enter database menu
2. Select a config with an active connection
3. Press `t` to enter SQL terminal
4. Type queries and press Enter to execute

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

1. **Use for verification** - After running migrations, verify data with quick SELECT queries.

2. **Limit large queries** - Always use LIMIT when exploring tables with many rows.

3. **Review before DML** - Use SELECT to verify your WHERE clause before UPDATE/DELETE.

4. **Clear old history** - Periodically run `clearOlderThan()` to manage storage.

5. **Don't store secrets** - Avoid queries containing sensitive data—history is stored in plaintext (gzipped but not encrypted).

```typescript
// Good - verify before delete
const preview = await executeRawSql(db,
    'SELECT id, email FROM users WHERE last_login < NOW() - INTERVAL 1 YEAR',
    'production'
)
console.log(`Would delete ${preview.rows?.length} users`)

// Then execute
await executeRawSql(db,
    'DELETE FROM users WHERE last_login < NOW() - INTERVAL 1 YEAR',
    'production'
)
```
