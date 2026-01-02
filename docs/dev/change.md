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
sql/tables/verification_tokens.sql
sql/functions/generate_token.sql
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
    schemaDir: '/project/sql',
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


## Scaffolding

Create and modify changes programmatically:

```typescript
import { createChange, addFile, removeFile } from './core/change'

// Create a new change
const change = await createChange('/project/changes', {
    description: 'add-user-preferences',
    date: new Date(),  // Optional, defaults to today
})
// Creates: 2025-12-18-add-user-preferences/

// Add a SQL file
const updated = await addFile(change, 'change', {
    name: 'create-preferences-table',
    type: 'sql',
    content: 'CREATE TABLE user_preferences (...);',
})
// Creates: change/001_create-preferences-table.sql

// Add a manifest file
await addFile(updated, 'change', {
    name: 'schema-refs',
    type: 'txt',
    paths: ['tables/preferences.sql', 'views/user_prefs.sql'],
})
// Creates: change/002_schema-refs.txt

// Remove a file
await removeFile(change, 'change', '001_create-preferences-table.sql')
```


## Change Status

Each change has a status based on its execution history:

| Status | Meaning |
|--------|---------|
| `pending` | Never applied |
| `success` | Applied successfully |
| `failed` | Last execution failed |
| `reverted` | Was applied, then reverted |

The `list()` method returns items with additional metadata:

```typescript
interface ChangeListItem {
    name: string
    status: 'pending' | 'success' | 'failed' | 'reverted'
    appliedAt: Date | null
    appliedBy: string | null
    revertedAt: Date | null
    isNew: boolean         // Exists on disk but no DB record
    orphaned: boolean      // In DB but folder deleted from disk
    errorMessage?: string  // Error message if status is 'failed'
    // Disk metadata (when change exists on disk)
    path?: string
    date?: Date
    description?: string
    changeFiles?: ChangeFile[]
    revertFiles?: ChangeFile[]
    hasChangelog?: boolean
}
```


## Tracking Tables

Change execution is recorded in the same tables as the runner:

**`__noorm_change__`** - Operation record:

| Field | Description |
|-------|-------------|
| `name` | Change name |
| `direction` | `'change'` or `'revert'` |
| `change_type` | `'change'` |
| `status` | `'pending'`, `'success'`, `'failed'` |
| `checksum` | Combined hash of all files |
| `executed_by` | Identity string |

**`__noorm_executions__`** - Individual file records:

| Field | Description |
|-------|-------------|
| `change_id` | FK to parent operation |
| `filepath` | File that was executed |
| `checksum` | SHA-256 of file contents |
| `status` | `'success'`, `'failed'`, `'skipped'` |


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `change:created` | `{ name, path }` | New change scaffolded |
| `change:start` | `{ name, direction, files }` | Execution starting |
| `change:file` | `{ change, filepath, index, total }` | File being executed |
| `change:complete` | `{ name, direction, status, durationMs }` | Execution finished |
| `change:skip` | `{ name, reason }` | Change skipped (already applied, unchanged) |
| `file:dry-run` | `{ filepath, outputPath }` | File written during dry-run mode |

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

**Note**: Already-applied changes are not thrown as errors. Instead, they emit a `change:skip` event with `reason: 'already_applied'`. Use `--force` to re-run.


## Execution History

The `ChangeHistory` class provides detailed execution tracking:

```typescript
import { ChangeHistory } from './core/change'

const history = new ChangeHistory(db, 'production')

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
    direction: 'change' | 'revert'
    status: 'pending' | 'success' | 'failed' | 'reverted'
    executedAt: Date
    executedBy: string
    durationMs: number
    errorMessage: string | null
    checksum: string
}

interface UnifiedHistoryRecord {
    id: number
    name: string
    changeType: 'change' | 'build' | 'run'
    direction: 'change' | 'revert' | null
    status: 'pending' | 'success' | 'failed' | 'reverted'
    executedAt: Date
    executedBy: string
    durationMs: number
    errorMessage: string | null
    checksum: string
}

interface FileHistoryRecord {
    id: number
    changeId: number
    filepath: string
    fileType: 'sql' | 'txt'
    checksum: string
    status: 'pending' | 'success' | 'failed' | 'skipped'
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


## Best Practices

1. **One logical change per change** - Don't bundle unrelated changes. If adding users and adding products, make two changes.

2. **Always include revert scripts** - Even if you think you'll never need them. Future you will thank present you.

3. **Test reverts in development** - Run `revert` then `change` to verify the rollback works before deploying.

4. **Use manifests for shared SQL** - Reference existing schema files with `.txt` manifests instead of duplicating SQL.

5. **Date prefix for ordering** - The `YYYY-MM-DD-` prefix ensures changes apply in chronological order across team members.

6. **Preview before production** - Use `--preview` or `--dry-run` to inspect exactly what will execute.

7. **Review history after failures** - Use `getFileHistory()` to identify exactly which file failed and why.
