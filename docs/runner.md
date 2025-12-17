# Runner


## The Problem

You have SQL files that need to run against a database. But running them manually is error-prone:

- Which files have already run?
- Did that file change since last execution?
- What happens if execution fails halfway through?
- How do you preview what will run before committing?

noorm's runner solves this with checksum-based change detection and execution tracking. Files that haven't changed are skipped. Failed files are automatically retried. Everything is logged to the database for auditability.


## How It Works

The runner provides three execution modes:

| Mode | Purpose | Input |
|------|---------|-------|
| **Build** | Execute all files in schema directory | Schema path from config |
| **File** | Execute a single SQL file | File path |
| **Dir** | Execute all files in a directory | Directory path |

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
| `concurrency` | `1` | Parallel file execution (1 for DDL safety) |
| `abortOnError` | `true` | Stop on first failure |
| `dryRun` | `false` | Render and write to `tmp/` without executing |
| `preview` | `false` | Output rendered SQL to stdout/file |


## Dry Run Mode

The `--dry-run` flag renders all SQL files and writes them to a local `tmp/` directory that mirrors the source structure. This lets you inspect the exact SQL that would be executed without actually running it.

```
Source:                              Dry run output:
sql/views/my_view.sql           →    tmp/sql/views/my_view.sql
sql/seed/users.sql.tmpl         →    tmp/sql/seed/users.sql
sql/Auth/02-Permissions.sql.tmpl →   tmp/sql/Auth/02-Permissions.sql
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
-- sql/seed/users.sql.tmpl
{% for (const user of $.users) { %}
INSERT INTO users (email, name) VALUES ({%~ $.quote(user.email) %}, {%~ $.quote(user.name) %});
{% } %}
```

The runner passes config, secrets, and project root to the template context. See [Template](./template.md) for full documentation.


## Tracking Tables

Every execution is recorded in two tables:

**`__noorm_changeset__`** - Parent operation record:

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
| `changeset_id` | FK to parent operation |
| `filepath` | File that was executed |
| `checksum` | SHA-256 of file contents |
| `status` | `'success'`, `'failed'`, `'skipped'` |
| `skip_reason` | `'unchanged'` if skipped |
| `duration_ms` | Execution time |


## Basic Usage

```typescript
import { runBuild, runFile, runDir, preview } from './core/runner'

// Execute all files in schema directory
const result = await runBuild(context, '/project/sql', {
    force: false,
    abortOnError: true,
})

console.log(`Ran ${result.filesRun} files in ${result.durationMs}ms`)
console.log(`Skipped ${result.filesSkipped} unchanged files`)

// Execute a single file
const fileResult = await runFile(context, '/project/sql/001_users.sql')

// Dry run - render to tmp/ without executing
const dryResult = await runBuild(context, '/project/sql', {
    dryRun: true,
})

// Preview rendered SQL
const previews = await preview(context, [
    '/project/sql/seed.sql.tmpl',
])
console.log(previews[0].renderedSql)
```


## Observer Events

| Event | Payload | Description |
|-------|---------|-------------|
| `build:start` | `{ schemaPath, fileCount }` | Build operation started |
| `build:complete` | `{ status, filesRun, filesSkipped, filesFailed, durationMs }` | Build finished |
| `run:file` | `{ filepath, configName }` | Single file execution started |
| `run:dir` | `{ dirpath, fileCount, configName }` | Directory execution started |
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


## Best Practices

1. **Number files for ordering** - Use `001_`, `002_` prefixes for deterministic execution order

2. **One DDL per file** - Complex statements (stored procedures, triggers) work better in separate files

3. **Use templates for dynamic content** - Seeds, environment-specific config, generated permissions

4. **Dry run before production** - Always `--dry-run` against production config to inspect what will execute

5. **Don't modify executed files** - If you need to change a table, create a new migration file instead of editing the old one
