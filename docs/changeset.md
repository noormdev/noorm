# Changeset


## The Problem

Schema evolution is hard. You need to:

- Track which changes have been applied to each environment
- Roll back when things go wrong
- Coordinate changes across team members
- Reference existing schema files without duplicating SQL

The runner handles initial schema builds, but what about modifications after deployment? Adding a column, creating an index, altering constraints—these incremental changes need their own tracking.

noorm's changeset system solves this with versioned folders containing forward and rollback SQL. Each changeset is tracked independently with its own execution history.


## How It Works

A changeset is a folder with a specific structure:

```
changesets/
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

Changesets support three file types:

| Extension | Description |
|-----------|-------------|
| `.sql` | Raw SQL executed directly |
| `.sql.tmpl` | Template processed through Eta before execution |
| `.txt` | Manifest referencing existing schema files |

The `.txt` manifest is particularly useful for referencing build SQL:

```txt
# 001_schema-refs.txt
# Reference existing schema files instead of duplicating
schema/tables/verification_tokens.sql
schema/functions/generate_token.sql
```

Referenced paths are resolved relative to your schema directory.


## Change Detection

Changesets use checksum-based detection at the changeset level:

| Condition | Action |
|-----------|--------|
| New changeset (no DB record) | Run |
| Files changed since last run | Run |
| Previous run failed | Run |
| `--force` flag | Run |
| Successfully applied, unchanged | Skip |

Unlike the runner which tracks individual files, changesets track the combined checksum of all files in `change/` or `revert/`.


## Basic Usage

```typescript
import { ChangesetManager } from './core/changeset'
import { createConnection } from './core/connection'
import { resolveIdentity } from './core/identity'

const { db } = await createConnection(config.connection, config.name)
const identity = resolveIdentity()

const manager = new ChangesetManager({
    db,
    configName: config.name,
    identity,
    projectRoot: process.cwd(),
    changesetsDir: '/project/changesets',
    schemaDir: '/project/sql',
})

// List all changesets with status
const list = await manager.list()
for (const cs of list) {
    console.log(`${cs.name}: ${cs.status}`)
}

// Run a specific changeset
const result = await manager.run('2025-01-15-add-email-verification')
console.log(`${result.status}: ${result.files.length} files in ${result.durationMs}ms`)

// Run next pending changeset
const next = await manager.next()

// Fast-forward: run all pending changesets
const ffResult = await manager.ff()
console.log(`Applied ${ffResult.executed} changesets`)
```


## Reverting Changes

If a changeset has `revert/` files, you can roll it back:

```typescript
// Revert a specific changeset
const revertResult = await manager.revert('2025-01-15-add-email-verification')

// Rewind: revert multiple changesets in reverse order
const rewindResult = await manager.rewind(3)  // Revert last 3 applied changesets
```

Revert executes files in `revert/` in reverse sequence order (002 before 001). The changeset status changes to `'reverted'`.


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

Create and modify changesets programmatically:

```typescript
import { createChangeset, addFile, removeFile } from './core/changeset'

// Create a new changeset
const changeset = await createChangeset('/project/changesets', {
    description: 'add-user-preferences',
    date: new Date(),  // Optional, defaults to today
})
// Creates: 2025-12-18-add-user-preferences/

// Add a SQL file
const updated = await addFile(changeset, 'change', {
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
await removeFile(changeset, 'change', '001_create-preferences-table.sql')
```


## Changeset Status

Each changeset has a status based on its execution history:

| Status | Meaning |
|--------|---------|
| `pending` | Never applied |
| `success` | Applied successfully |
| `failed` | Last execution failed |
| `reverted` | Was applied, then reverted |

The `list()` method returns items with additional metadata:

```typescript
interface ChangesetListItem {
    name: string
    status: 'pending' | 'success' | 'failed' | 'reverted'
    appliedAt: Date | null
    appliedBy: string | null
    revertedAt: Date | null
    isNew: boolean         // Exists on disk but no DB record
    orphaned: boolean      // In DB but folder deleted from disk
    errorMessage?: string  // Error message if status is 'failed'
    // Disk metadata (when changeset exists on disk)
    path?: string
    date?: Date
    description?: string
    changeFiles?: ChangesetFile[]
    revertFiles?: ChangesetFile[]
    hasChangelog?: boolean
}
```


## Tracking Tables

Changeset execution is recorded in the same tables as the runner:

**`__noorm_changeset__`** - Operation record:

| Field | Description |
|-------|-------------|
| `name` | Changeset name |
| `direction` | `'change'` or `'revert'` |
| `change_type` | `'changeset'` |
| `status` | `'pending'`, `'success'`, `'failed'` |
| `checksum` | Combined hash of all files |
| `executed_by` | Identity string |

**`__noorm_executions__`** - Individual file records:

| Field | Description |
|-------|-------------|
| `changeset_id` | FK to parent operation |
| `filepath` | File that was executed |
| `checksum` | SHA-256 of file contents |
| `status` | `'success'`, `'failed'`, `'skipped'` |


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `changeset:created` | `{ name, path }` | New changeset scaffolded |
| `changeset:start` | `{ name, direction, files }` | Execution starting |
| `changeset:file` | `{ changeset, filepath, index, total }` | File being executed |
| `changeset:complete` | `{ name, direction, status, durationMs }` | Execution finished |
| `changeset:skip` | `{ name, reason }` | Changeset skipped (already applied, unchanged) |
| `file:dry-run` | `{ filepath, outputPath }` | File written during dry-run mode |

```typescript
import { observer } from './core/observer'

observer.on('changeset:start', ({ name, direction, files }) => {

    console.log(`${direction === 'change' ? 'Applying' : 'Reverting'} ${name}`)
    console.log(`Files: ${files.join(', ')}`)
})

observer.on('changeset:file', ({ changeset, filepath, index, total }) => {

    console.log(`[${index + 1}/${total}] ${filepath}`)
})

observer.on('changeset:complete', ({ name, status, durationMs }) => {

    console.log(`${name}: ${status} (${durationMs}ms)`)
})
```


## Error Handling

Changeset operations throw specific errors:

```typescript
import { attempt } from '@logosdx/utils'
import {
    ChangesetNotFoundError,
    ChangesetNotAppliedError,
    ChangesetValidationError,
    ManifestReferenceError,
} from './core/changeset'

const [result, err] = await attempt(() => manager.run('my-changeset'))

if (err instanceof ChangesetNotFoundError) {
    console.log(`Changeset folder not found: ${err.changesetName}`)
}
else if (err instanceof ChangesetValidationError) {
    console.log(`Invalid structure: ${err.issue}`)
}
else if (err instanceof ManifestReferenceError) {
    console.log(`Manifest references missing file: ${err.missingPath}`)
}
```

| Error | When Thrown |
|-------|-------------|
| `ChangesetNotFoundError` | Folder doesn't exist |
| `ChangesetNotAppliedError` | Trying to revert unapplied changeset |
| `ChangesetValidationError` | Invalid folder structure |
| `ChangesetOrphanedError` | In DB but folder deleted |
| `ManifestReferenceError` | `.txt` references missing file |

**Note**: Already-applied changesets are not thrown as errors. Instead, they emit a `changeset:skip` event with `reason: 'already_applied'`. Use `--force` to re-run.


## Execution History

The `ChangesetHistory` class provides detailed execution tracking:

```typescript
import { ChangesetHistory } from './core/changeset'

const history = new ChangesetHistory(db, 'production')

// Get status for a specific changeset
const status = await history.getStatus('2024-01-15-add-users')
// {
//     name: '2024-01-15-add-users',
//     status: 'success',
//     appliedAt: Date,
//     appliedBy: 'Alice <alice@example.com>',
//     revertedAt: null,
//     errorMessage: null
// }

// Get all changeset statuses
const allStatuses = await history.getAllStatuses()
for (const [name, status] of allStatuses) {
    console.log(`${name}: ${status.status}`)
}
```


### Unified History

Query execution history across all operation types—changesets, builds, and runs:

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
const changesetHistory = await history.getUnifiedHistory(['changeset'], 20)

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
interface ChangesetHistoryRecord {
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
    changeType: 'changeset' | 'build' | 'run'
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
    changesetId: number
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

1. **Change History Screen** - Browse all changeset executions
2. **Change History Detail** - View individual file executions for an operation

Access via the changesets menu (`g` from home, then `h` for history).


## Best Practices

1. **One logical change per changeset** - Don't bundle unrelated changes. If adding users and adding products, make two changesets.

2. **Always include revert scripts** - Even if you think you'll never need them. Future you will thank present you.

3. **Test reverts in development** - Run `revert` then `change` to verify the rollback works before deploying.

4. **Use manifests for shared SQL** - Reference existing schema files with `.txt` manifests instead of duplicating SQL.

5. **Date prefix for ordering** - The `YYYY-MM-DD-` prefix ensures changesets apply in chronological order across team members.

6. **Preview before production** - Use `--preview` or `--dry-run` to inspect exactly what will execute.

7. **Review history after failures** - Use `getFileHistory()` to identify exactly which file failed and why.
