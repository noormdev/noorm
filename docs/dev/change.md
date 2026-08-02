# Change


## The Problem

Schema evolution is hard. You need to:

- Track which changes have been applied to each environment
- Roll back when things go wrong
- Coordinate changes across team members
- Reference existing schema files without duplicating SQL

The runner handles initial schema builds, but what about modifications after deployment? Adding a column, creating an index, altering constraints—these incremental changes need their own tracking.

noorm's change system solves this with versioned folders containing forward and rollback SQL. Each change is tracked independently with its own execution history.


## How It Works

A change is a folder with a specific structure:

```
changes/
└── 2025-01-15-add-email-verification/
    ├── change/                    # Forward changes (required)
    │   ├── 001_create-tokens-table.sql
    │   └── 002_add-user-column.sql
    ├── revert/                    # Rollback scripts (optional)
    │   ├── 001_drop-user-column.sql
    │   └── 002_drop-tokens-table.sql
    └── changelog.md               # Human-readable description
```

The naming convention `YYYY-MM-DD-description` ensures chronological ordering. Files within `change/` and `revert/` use sequence prefixes (`001_`, `002_`) for execution order.


## File Types

Changes support three file types:

| Extension | Description |
|-----------|-------------|
| `.sql` | Raw SQL executed directly |
| `.sql.tmpl` | Template processed through Eta before execution |
| `.txt` | Manifest referencing existing schema files |

The `.txt` manifest is particularly useful for referencing build SQL:

```txt
# 001_schema-refs.txt
# Reference existing schema files instead of duplicating
01_tables/003_verification_tokens.sql
03_functions/001_generate_token.sql
```

Referenced paths are resolved relative to your schema directory.


## Change Detection

Changes use checksum-based detection at the change level. Each condition has an associated `ChangeRunReason`:

| Reason | Condition | Action |
|--------|-----------|--------|
| `new` | No database record exists | Run |
| `changed` | Files modified since last run | Run |
| `failed` | Previous execution failed | Run |
| `reverted` | Change was applied then reverted | Run |
| `stale` | Marked stale by teardown operation | Run |
| `force` | `--force` flag provided | Run |
| — | Successfully applied, unchanged | Skip |

Unlike the runner which tracks individual files, changes track the combined checksum of all files in `change/` or `revert/`.

The `stale` status is set by teardown operations that wipe the database. When you run `db:teardown`, all applied changes are marked as stale so they'll re-run on the next `ff` operation.


## Basic Usage

```typescript
import { ChangeManager } from './core/change'
import { createConnection } from './core/connection'
import { resolveIdentity } from './core/identity'

const { db } = await createConnection(config.connection, config.name)
const identity = resolveIdentity()

const manager = new ChangeManager({
    db,
    configName: config.name,
    identity,
    projectRoot: process.cwd(),
    changesDir: '/project/changes',
    sqlDir: '/project/sql',
    access: config.access,   // per-channel roles from the config
    channel: 'user',         // 'user' for CLI/TUI/SDK, 'agent' for MCP
    dialect: 'postgres',     // defaults to 'postgres' when omitted
})

// List all changes with status
const list = await manager.list()
for (const cs of list) {
    console.log(`${cs.name}: ${cs.status}`)
}

// Run a specific change
const result = await manager.run('2025-01-15-add-email-verification')
console.log(`${result.status}: ${result.files.length} files in ${result.durationMs}ms`)

// Run next pending change
const next = await manager.next()

// Fast-forward: run all pending changes
const ffResult = await manager.ff()
console.log(`Applied ${ffResult.executed} changes`)
```


## Reverting Changes

If a change has `revert/` files, you can roll it back:

```typescript
// Revert a specific change
const revertResult = await manager.revert('2025-01-15-add-email-verification')

// Rewind: revert multiple changes in reverse order
const rewindResult = await manager.rewind(3)  // Revert last 3 applied changes
```

Revert executes files in `revert/` in reverse sequence order (002 before 001). The change status changes to `'reverted'`.


## Execution Options

| Option | Default | Description |
|--------|---------|-------------|
| `force` | `false` | Re-run even if already applied |
| `dryRun` | `false` | Render to `tmp/` without executing |
| `preview` | `false` | Output rendered SQL to stdout/file |
| `output` | `null` | File path for preview output |

Batch operations (`next`, `ff`, `rewind`) add:

| Option | Default | Description |
|--------|---------|-------------|
| `abortOnError` | `true` | Stop on first failure |

Batch results (`BatchChangeResult`) carry `warnings?: string[]` for conditions
that silently shrink a batch to nothing — currently a missing changes directory.
A mistyped `paths.changes` otherwise reports `executed: 0` and exit 0, which is
indistinguishable from an already-up-to-date database. `error?: string` carries
a pre-flight failure that no per-change result can explain (e.g. a rewind target
matching no applied change).


## Scaffolding

Create and modify changes programmatically:

```typescript
import { createChange, addFile, removeFile } from './core/change'

// Create a new change
const change = await createChange('/project/changes', {
    description: 'add-user-preferences',
    date: new Date(),  // Optional, defaults to today
})
// Creates: 2025-12-18-add-user-preferences/, already seeded with a runnable
// stub in each folder: change/001_add-user-preferences.sql and
// revert/001_add-user-preferences.sql (a comment naming what belongs there).
// An empty change/+revert/ pair fails validation, so createChange never
// returns one — see "Scaffolding a Runnable Stub" below.

// Add a SQL file — sequence numbers continue from the stub, so this is 002
const updated = await addFile(change, 'change', {
    name: 'create-preferences-table',
    type: 'sql',
    content: 'CREATE TABLE user_preferences (...);',
})
// Creates: change/002_create-preferences-table.sql

// Add a manifest file
await addFile(updated, 'change', {
    name: 'schema-refs',
    type: 'txt',
    paths: ['tables/preferences.sql', 'views/user_prefs.sql'],
})
// Creates: change/003_schema-refs.txt

// Remove a file
await removeFile(change, 'change', '001_add-user-preferences.sql')
```


### Scaffolding a Runnable Stub

`createChange` doesn't leave `change/` and `revert/` empty. An empty pair fails
`parseChange`'s validation, and the caller sees that misreported as "change not found"
rather than "needs editing" — so `createChange` scaffolds one stub file into each folder via
`addFile`, using the change's own slug as the filename: `001_<slug>.sql` in `change/`,
`001_<slug>.sql` in `revert/`. Each stub is a single comment naming what belongs there
("Add the SQL statements that apply this change" / "...undo this change"). A stub full of
comments still isn't runnable content — `executeChange` rejects files that are empty or
contain only comments/template placeholders, with a message that says so, before it ever
executes anything.


## Change Status

Each change has a status based on its execution history:

| Status | Meaning |
|--------|---------|
| `pending` | Never applied |
| `success` | Applied successfully |
| `failed` | Last execution failed |
| `reverted` | Was applied, then reverted |
| `stale` | Applied, but its objects were torn down — needs re-run |

These are the `OperationStatus` values from `core/shared`, shared with the runner.
`isPendingChange(item)` is the one predicate every "what still needs applying"
surface uses (`ff`, `next`, the SDK's `pending()`, the CLI picker): it returns
true for `pending`, `reverted`, and `stale` on non-orphaned changes.

The `list()` method returns items with additional metadata:

```typescript
interface ChangeListItem {
    name: string
    status: OperationStatus
    appliedAt: Date | null
    appliedBy: string | null
    revertedAt: Date | null
    errorMessage: string | null
    appliedHistoryId?: number | null  // history row id — the true apply-order key
    isNew: boolean         // Exists on disk but no DB record
    orphaned: boolean      // In DB but folder deleted from disk
    // Disk metadata (when change exists on disk)
    path?: string
    date?: Date | null
    description?: string
    changeFiles?: ChangeFile[]
    revertFiles?: ChangeFile[]
    hasChangelog?: boolean
}
```

`appliedAt` is second-precision, so changes applied in the same `ff` tick tie;
`rewind` breaks the tie on `appliedHistoryId`.


## Tracking Tables

Change execution is recorded in the same tables as the runner. Names below are the MySQL/SQLite prefixed form; PostgreSQL and SQL Server use `noorm.change` and `noorm.executions` in a dedicated schema instead.

**`__noorm_change__`** - Operation record:

| Field | Description |
|-------|-------------|
| `name` | Change name |
| `direction` | `'change'` or `'revert'` |
| `change_type` | `'change'` |
| `status` | `OperationStatus`: `'pending'`, `'success'`, `'failed'`, `'reverted'`, `'stale'` |
| `checksum` | Combined hash of all files |
| `executed_by` | Identity string |

**`__noorm_executions__`** - Individual file records:

| Field | Description |
|-------|-------------|
| `change_id` | FK to parent operation |
| `filepath` | File that was executed |
| `checksum` | SHA-256 of file contents |
| `status` | `'pending'`, `'success'`, `'failed'`, `'skipped'` |
| `duration_ms` | Execution time (integer, not float) |

**Note:** The `duration_ms` column is an integer. `performance.now()` returns floats, so all writes use `Math.round(durationMs)`. This is important for PostgreSQL compatibility.


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `change:created` | `{ name, path }` | New change scaffolded |
| `change:start` | `{ name, direction, files }` | Execution starting |
| `change:file` | `{ change, filepath, index, total }` | File being executed |
| `change:complete` | `{ name, direction, status, durationMs }` | Execution finished |
| `change:skip` | `{ name, reason }` | Change skipped (already applied, unchanged) |
| `file:dry-run` | `{ filepath, status, outputPath?, error? }` | File rendered during dry-run mode |

```typescript
import { observer } from './core/observer'

observer.on('change:start', ({ name, direction, files }) => {

    console.log(`${direction === 'change' ? 'Applying' : 'Reverting'} ${name}`)
    console.log(`Files: ${files.join(', ')}`)
})

observer.on('change:file', ({ change, filepath, index, total }) => {

    console.log(`[${index + 1}/${total}] ${filepath}`)
})

observer.on('change:complete', ({ name, status, durationMs }) => {

    console.log(`${name}: ${status} (${durationMs}ms)`)
})
```


## Error Handling

Change operations throw specific errors:

```typescript
import { attempt } from '@logosdx/utils'
import {
    ChangeNotFoundError,
    ChangeNotAppliedError,
    ChangeValidationError,
    ManifestReferenceError,
} from './core/change'

const [result, err] = await attempt(() => manager.run('my-change'))

if (err instanceof ChangeNotFoundError) {
    console.log(`Change folder not found: ${err.changeName}`)
}
else if (err instanceof ChangeValidationError) {
    console.log(`Invalid structure: ${err.issue}`)
}
else if (err instanceof ManifestReferenceError) {
    console.log(`Manifest references missing file: ${err.missingPath}`)
}
```

| Error | When Thrown |
|-------|-------------|
| `ChangeNotFoundError` | Folder doesn't exist |
| `ChangeNotAppliedError` | Trying to revert unapplied change |
| `ChangeValidationError` | Invalid folder structure |
| `ChangeOrphanedError` | In DB but folder deleted |
| `ManifestReferenceError` | `.txt` references missing file |

**Note**: Already-applied changes are not thrown as errors. Instead, they emit a `change:skip` event with `reason: 'already applied'` and the change reports `status: 'success'` with zero files. Use `--force` to re-run. `ChangeAlreadyAppliedError` is exported but no longer thrown by the executor.


## Execution History

The `ChangeHistory` class provides detailed execution tracking:

```typescript
import { ChangeHistory } from './core/change'

// (db, configName, dialect) — dialect defaults to 'sqlite', which selects the
// prefixed table names. Pass the real dialect or pg/mssql queries hit the
// wrong identifiers.
const history = new ChangeHistory(db, 'production', 'postgres')

// Get status for a specific change
const status = await history.getStatus('2024-01-15-add-users')
// {
//     name: '2024-01-15-add-users',
//     status: 'success',
//     appliedAt: Date,
//     appliedBy: 'Alice <alice@example.com>',
//     revertedAt: null,
//     errorMessage: null
// }

// Get all change statuses
const allStatuses = await history.getAllStatuses()
for (const [name, status] of allStatuses) {
    console.log(`${name}: ${status.status}`)
}
```


### Unified History

Query execution history across all operation types—changes, builds, and runs:

```typescript
// Get unified history (all types)
const records = await history.getUnifiedHistory(undefined, 50)

for (const record of records) {
    console.log(`${record.changeType}: ${record.name}`)
    console.log(`  ${record.status} at ${record.executedAt}`)
    console.log(`  by ${record.executedBy} (${record.durationMs}ms)`)
}

// Filter by operation type
const buildHistory = await history.getUnifiedHistory(['build', 'run'], 20)
const changeHistory = await history.getUnifiedHistory(['change'], 20)

// Convenience method for build/run only
const buildRunHistory = await history.getBuildRunHistory(20)
```


### File-Level History

Get execution details for individual files within an operation:

```typescript
// Get file execution records for an operation
const files = await history.getFileHistory(operationId)

for (const file of files) {
    console.log(`${file.filepath}: ${file.status}`)
    if (file.status === 'failed') {
        console.log(`  Error: ${file.errorMessage}`)
    }
    else if (file.status === 'skipped') {
        console.log(`  Skipped: ${file.skipReason}`)
    }
    else {
        console.log(`  ${file.durationMs}ms`)
    }
}
```


### History Types

```typescript
interface ChangeHistoryRecord {
    id: number
    name: string
    direction: Direction          // 'change' | 'revert'
    status: OperationStatus       // 'pending' | 'success' | 'failed' | 'reverted' | 'stale'
    executedAt: Date
    executedBy: string
    durationMs: number
    errorMessage: string | null
    checksum: string
}

// Adds the operation type; every other field is inherited unchanged.
interface UnifiedHistoryRecord extends ChangeHistoryRecord {
    changeType: 'build' | 'run' | 'change'
}

interface FileHistoryRecord {
    id: number
    changeId: number
    filepath: string
    fileType: 'sql' | 'txt'
    checksum: string
    status: ExecutionStatus       // 'pending' | 'success' | 'failed' | 'skipped'
    skipReason: string | null
    errorMessage: string | null
    durationMs: number
}
```


### CLI History Screens

The CLI provides dedicated screens for browsing execution history:

1. **Change History Screen** - Browse all change executions
2. **Change History Detail** - View individual file executions for an operation

Access via the changes menu (`g` from home, then `h` for history).


## ChangeTracker

The `ChangeTracker` class extends the base `Tracker` with change-specific operations:

```typescript
import { ChangeTracker } from './core/change'

// (db, configName, dialect) — same signature as the base Tracker
const tracker = new ChangeTracker(db, configName, 'postgres')

// Check if a change can be reverted. `force` is required, and the result is a
// CanRevertResult, not a boolean.
const check = await tracker.canRevert('2024-01-15-add-users', false)
// { canRevert: boolean, reason?: string, status?: OperationStatus, error?: Error }

if (check.error) {
    // State could not be established (unreadable/damaged tracking table) —
    // distinct from an established "no".
}

// Mark a change as reverted
await tracker.markAsReverted('2024-01-15-add-users')

// Mark all changes as stale (used by teardown operations); returns the count
const marked = await tracker.markAllAsStale()
```

The base `Tracker` class (from `core/runner`) provides:
- `needsRun()` / `needsRunByName()` - Change detection by filepath or name
- `createOperation()` - Create operation records with direction
- `createFileRecords()` - Create pending file records upfront
- `updateFileExecution()` - Update individual file status
- `skipRemainingFiles()` - Mark remaining files as skipped
- `finalizeOperation()` - Complete operation with final status

`ChangeTracker` adds change-specific methods:
- `canRevert(name, force)` - Check if change was successfully applied
- `markAsReverted(name)` - Update status to 'reverted'
- `markAllAsStale()` - Mark all applied changes for re-execution

**Note:** `ChangeHistory` is now query-focused. Mutation methods (`canRevert`, `markAsReverted`, `markAllAsStale`) moved to `ChangeTracker`.


## Change Context

The `ChangeContext` interface includes all parameters needed for change execution:

```typescript
interface ChangeContext {
    db: Kysely<NoormDatabase>
    configName: string
    identity: Identity
    projectRoot: string
    changesDir: string
    sqlDir: string               // resolves .txt manifest references
    access: ConfigAccess         // the config's per-channel roles
    channel: Channel             // 'user' (CLI/TUI/SDK) or 'agent' (MCP or CLI)
    config?: Record<string, unknown>
    secrets?: Record<string, string>
    globalSecrets?: Record<string, string>
    dialect?: 'postgres' | 'mysql' | 'sqlite' | 'mssql'  // default: 'postgres'
}
```

`access` and `channel` are required: `executeChange`/`revertChange` run the
policy gate once, at the core seam, so SDK/TUI/CLI/MCP callers all inherit one
enforcement path. `dialect` is optional and defaults to `'postgres'`; it selects
the tracking-table naming (schema-qualified vs prefixed) and the date formatting
lock operations need.


## Best Practices

1. **One logical change per change** - Don't bundle unrelated changes. If adding users and adding products, make two changes.

2. **Always include revert scripts** - Even if you think you'll never need them. Future you will thank present you.

3. **Test reverts in development** - Run `revert` then `change` to verify the rollback works before deploying.

4. **Use manifests for shared SQL** - Reference existing schema files with `.txt` manifests instead of duplicating SQL.

5. **Date prefix for ordering** - The `YYYY-MM-DD-` prefix ensures changes apply in chronological order across team members.

6. **Preview before production** - Use `--preview` or `--dry-run` to inspect exactly what will execute.

7. **Review history after failures** - Use `getFileHistory()` to identify exactly which file failed and why.
