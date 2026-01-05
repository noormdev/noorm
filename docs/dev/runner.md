# Runner


## The Problem

You have SQL files that need to run against a database. But running them manually is error-prone:

- Which files have already run?
- Did that file change since last execution?
- What happens if execution fails halfway through?
- How do you preview what will run before committing?

noorm's runner solves this with checksum-based change detection and execution tracking. Files that haven't changed are skipped. Failed files are automatically retried. Everything is logged to the database for auditability.


## How It Works

The runner provides four execution modes:

| Mode | Purpose | Input |
|------|---------|-------|
| **Build** | Execute all files in schema directory | Schema path from config |
| **File** | Execute a single SQL file | File path |
| **Dir** | Execute all files in a directory | Directory path |
| **Files** | Execute specific files selectively | Array of file paths |

When you run a file:

1. Compute SHA-256 checksum of file contents
2. Check tracking database for previous execution
3. Skip if unchanged, run if new/changed/failed
4. Render template if `.sql.tmpl` file
5. Execute SQL against database
6. Record result in tracking tables


## Change Detection

Files are re-executed only when necessary:

| Condition | Action |
|-----------|--------|
| New file (no previous record) | Run |
| Checksum changed | Run |
| Previous execution failed | Run |
| `--force` flag | Run |
| Unchanged and successful | Skip |

This makes builds idempotent—run the same build command twice and unchanged files won't re-execute.


## Run Options

| Option | Default | Description |
|--------|---------|-------------|
| `force` | `false` | Re-run even if unchanged |
| `abortOnError` | `true` | Stop on first failure |
| `dryRun` | `false` | Render and write to `tmp/` without executing |
| `preview` | `false` | Output rendered SQL to stdout/file |

> **Note:** Files are always executed sequentially for DDL safety. Parallel execution is not currently supported.


## Dry Run Mode

The `--dry-run` flag renders all SQL files and writes them to a local `tmp/` directory that mirrors the source structure. This lets you inspect the exact SQL that would be executed without actually running it.

```
Source:                                     Dry run output:
sql/02_views/001_my_view.sql           →    tmp/sql/02_views/001_my_view.sql
sql/03_seeds/001_users.sql.tmpl        →    tmp/sql/03_seeds/001_users.sql
sql/04_auth/002_permissions.sql.tmpl   →    tmp/sql/04_auth/002_permissions.sql
```

Templates are fully rendered with the current config context. The `.tmpl` extension is stripped from output files.

**Use cases:**

| Scenario | Command |
|----------|---------|
| Inspect rendered templates | `noorm run build --dry-run` |
| Review before production deploy | `noorm run build --dry-run -c production` |
| Debug template variables | `noorm run file seed.sql.tmpl --dry-run` |
| CI/CD validation step | `noorm run build --dry-run && git diff tmp/` |


## Preview Mode

The `--preview` flag outputs rendered SQL to stdout or a single file. Unlike dry run, it doesn't record anything in the tracker.

```bash
# Preview to stdout
noorm run build --preview

# Preview to file
noorm run build --preview --output build.sql
```

**Dry run vs Preview:**

| Aspect | Dry Run | Preview |
|--------|---------|---------|
| Output location | `tmp/` directory (mirrored structure) | stdout or single file |
| Records in tracker | No | No |
| Change detection | No (processes all files) | No (processes all files) |
| Use case | Pre-execution inspection | Quick SQL review |


## Template Integration

Files ending in `.sql.tmpl` are processed through the template engine before execution:

```sql
-- sql/03_seeds/001_users.sql.tmpl
{% for (const user of $.users) { %}
INSERT INTO users (email, name) VALUES ({%~ $.quote(user.email) %}, {%~ $.quote(user.name) %});
{% } %}
```

The runner passes config, secrets, and project root to the template context. See [Template](./template.md) for full documentation.


## Tracking Tables

Every execution is recorded in two tables:

**`__noorm_change__`** - Parent operation record:

| Field | Description |
|-------|-------------|
| `name` | Operation identifier (e.g., `build:2024-01-15T10:30:00`) |
| `change_type` | `'build'` or `'run'` |
| `executed_by` | Identity string |
| `config_name` | Which config was used |
| `status` | `'pending'`, `'success'`, `'failed'` |

**`__noorm_executions__`** - Individual file records:

| Field | Description |
|-------|-------------|
| `change_id` | FK to parent operation |
| `filepath` | File that was executed |
| `checksum` | SHA-256 of file contents |
| `status` | `'success'`, `'failed'`, `'skipped'` |
| `skip_reason` | `'unchanged'` if skipped |
| `duration_ms` | Execution time |


## Basic Usage

```typescript
import { runBuild, runFile, runDir, runFiles, preview } from './core/runner'

// Execute all files in schema directory
const result = await runBuild(context, '/project/sql', {
    force: false,
    abortOnError: true,
})

console.log(`Ran ${result.filesRun} files in ${result.durationMs}ms`)
console.log(`Skipped ${result.filesSkipped} unchanged files`)

// Execute a single file
const fileResult = await runFile(context, '/project/sql/001_users.sql')

// Execute all files in a directory
const dirResult = await runDir(context, '/project/sql/02_views')

// Execute specific files (selective execution)
const filesResult = await runFiles(context, [
    '/project/sql/01_tables/001_users.sql',
    '/project/sql/01_tables/002_posts.sql',
    '/project/sql/02_views/001_active_users.sql',
])

// Dry run - render to tmp/ without executing
const dryResult = await runBuild(context, '/project/sql', {
    dryRun: true,
})

// Preview rendered SQL
const previews = await preview(context, [
    '/project/sql/seed.sql.tmpl',
])
console.log(previews[0].renderedSql)

// Preview to a file (optional 3rd parameter)
const previewsToFile = await preview(context, [
    '/project/sql/seed.sql.tmpl',
], '/project/output.sql')
```


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `build:start` | `{ schemaPath, fileCount }` | Build operation started |
| `build:complete` | `{ status, filesRun, filesSkipped, filesFailed, durationMs }` | Build finished |
| `run:file` | `{ filepath, configName }` | Single file execution started |
| `run:dir` | `{ dirpath, fileCount, configName }` | Directory execution started |
| `run:files` | `{ fileCount, configName }` | Selective file execution started |
| `file:before` | `{ filepath, checksum, configName }` | About to execute a file |
| `file:after` | `{ filepath, status, durationMs, error? }` | File execution completed |
| `file:skip` | `{ filepath, reason }` | File skipped (unchanged) |
| `file:dry-run` | `{ filepath, outputPath }` | File written to tmp/ |

```typescript
import { observer } from './core/observer'

observer.on('file:after', ({ filepath, status, durationMs }) => {

    console.log(`${status}: ${filepath} (${durationMs}ms)`)
})

observer.on('file:skip', ({ filepath, reason }) => {

    console.log(`Skipped: ${filepath} (${reason})`)
})

observer.on('build:complete', ({ filesRun, filesSkipped, durationMs }) => {

    console.log(`Build complete: ${filesRun} run, ${filesSkipped} skipped in ${durationMs}ms`)
})
```


## Additional Utilities

The runner module exports several utility functions:

```typescript
import {
    computeChecksum,              // Compute SHA-256 checksum of a file
    computeChecksumFromContent,   // Compute SHA-256 checksum from string content
    computeCombinedChecksum,      // Combine multiple file checksums deterministically
} from './core/runner'

// Compute checksum from file
const checksum = await computeChecksum('/path/to/file.sql')

// Compute checksum from content string
const contentChecksum = computeChecksumFromContent('SELECT * FROM users')

// Combine multiple checksums (for change-level tracking)
const combined = computeCombinedChecksum([checksum1, checksum2, checksum3])
```


### File Filtering

Filter files by include/exclude path patterns:

```typescript
import { filterFilesByPaths } from './core/shared'

const files = [
    '/project/sql/01_tables/001_users.sql',
    '/project/sql/02_views/001_active.sql',
    '/project/sql/archive/old.sql',
]

const filtered = filterFilesByPaths(
    files,
    '/project',
    ['sql/01_tables', 'sql/02_views'],  // include
    ['sql/archive']                     // exclude
)
// ['/project/sql/01_tables/001_users.sql', '/project/sql/02_views/001_active.sql']
```

This utility is used internally by build operations when applying settings rules. The CLI passes the SQL directory (`paths.sql`) as the base directory, so settings patterns like `01_tables` resolve relative to the SQL path, not the project root. Exclude patterns take precedence when both match.


## Unified executeFiles

The `executeFiles` function provides low-level file execution with full tracking. Both runner and change modules use this internally:

```typescript
import { executeFiles, FileInput } from './core/runner'

// Prepare file inputs with pre-computed checksums
const files: FileInput[] = [
    { filepath: '/project/sql/001_users.sql', checksum: 'abc123' },
    { filepath: '/project/sql/002_posts.sql', checksum: 'def456' },
]

const result = await executeFiles(context, files, {
    operationId,          // Pre-created operation ID
    force: false,
    abortOnError: true,
    dryRun: false,
})
```

The `FileInput` type:

```typescript
interface FileInput {
    filepath: string
    checksum: string      // Pre-computed SHA-256
    fileType?: 'sql' | 'txt'  // Default: 'sql'
}
```

This design separates file discovery (external) from execution (internal), enabling:
- Pre-validation before database operations begin
- Checksum computation for all files upfront
- Full batch visibility via `createFileRecords()`


## Tracker Class

The `Tracker` class handles execution history and change detection. It serves as the base for both runner and change operations.

```typescript
import { Tracker } from './core/runner'

const tracker = new Tracker(db)

// Check if file needs to run (by filepath)
const { needsRun, reason, record } = await tracker.needsRun(filepath, checksum, force)

// Check if file needs to run (by name only - for changes)
const { needsRun, reason, record } = await tracker.needsRunByName(name, checksum, force)

// Create an operation record
const operationId = await tracker.createOperation({
    name: 'build:2024-01-15T10:30:00',
    changeType: 'build',
    direction: 'commit',  // 'commit' or 'revert'
    configName: 'dev',
    executedBy: 'alice@example.com',
})

// Create file records upfront (for full batch visibility)
await tracker.createFileRecords(operationId, [
    { filepath: '/path/to/file1.sql', checksum: 'abc123' },
    { filepath: '/path/to/file2.sql', checksum: 'def456' },
])

// Update individual file after execution
await tracker.updateFileExecution(operationId, filepath, {
    status: 'success',
    durationMs: 45,
    checksum: 'abc123',
})

// Skip remaining files (e.g., on error with abortOnError)
await tracker.skipRemainingFiles(operationId, 'aborted due to previous error')

// Legacy: Record a file execution (still supported)
await tracker.recordExecution({
    operationId,
    filepath,
    checksum,
    status: 'success',
    durationMs: 45,
})

// Finalize operation with optional checksum and error message
await tracker.finalizeOperation(operationId, 'success', 1234, checksum, errorMessage)
```


### Direction and ChangeType

Operations have both a `changeType` and `direction`:

| ChangeType | Direction | Meaning |
|------------|-----------|---------|
| `build` | `commit` | Schema build operation |
| `run` | `commit` | Ad-hoc file/directory execution |
| `change` | `commit` | Forward change |
| `change` | `revert` | Rollback change |

The API uses `'commit'` | `'revert'` for clarity, but the database stores `'change'` | `'revert'` for backwards compatibility. The mapping happens in `createOperation()`.


### Batch Visibility

Creating file records upfront provides complete audit trails:

```typescript
// All files are visible immediately as 'pending'
await tracker.createFileRecords(operationId, files)

// As each executes, status updates to 'success' or 'failed'
await tracker.updateFileExecution(operationId, filepath, { status: 'success', ... })

// If aborted, remaining files marked as 'skipped'
await tracker.skipRemainingFiles(operationId, 'aborted due to error')
```

This means even if a build fails midway, users can see which files would have run.


### Template Checksums

For template files (`.sql.tmpl`), checksums are computed from the **rendered content**, not the source file:

```typescript
// Template source checksum (what's on disk)
const sourceChecksum = await computeChecksum('/path/to/seed.sql.tmpl')

// Rendered content checksum (what actually executes)
const renderedSql = await renderTemplate(templateContent, context)
const executionChecksum = computeChecksumFromContent(renderedSql)
```

This ensures change detection works correctly when template variables change (e.g., different secrets between environments) even if the template source is unchanged.


## Run Context

The `RunContext` interface includes all execution parameters:

```typescript
interface RunContext {
    db: Kysely<NoormDatabase>
    configName: string
    identity: Identity
    projectRoot: string
    config?: Record<string, unknown>        // Config object for template context
    secrets?: Record<string, string>        // Config-scoped secrets
    globalSecrets?: Record<string, string>  // Global secrets from state
}
```

The optional `config` field exposes the active configuration as a template variable, allowing templates to access config properties like database name, dialect, etc.


## Best Practices

1. **Number files for ordering** - Use `001_`, `002_` prefixes for deterministic execution order

2. **One DDL per file** - Complex statements (stored procedures, triggers) work better in separate files

3. **Use templates for dynamic content** - Seeds, environment-specific config, generated permissions

4. **Dry run before production** - Always `--dry-run` against production config to inspect what will execute

5. **Don't modify executed files** - If you need to change a table, create a new change instead of editing the old one
