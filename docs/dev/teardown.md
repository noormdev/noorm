# Teardown


## The Problem

Development databases get messy. You're testing changes, rebuilding schemas, verifying rollback scripts. Each iteration leaves behind remnants—stale data, orphaned tables, half-applied changes.

The obvious solution—drop the database and recreate it—is slow. Database creation involves filesystem operations, permission grants, and connection pool resets. What should be instantaneous becomes 5-10 seconds. Run that before every test and your suite crawls.

Manually dropping objects is tedious and error-prone. Miss a foreign key constraint and your DROP TABLE fails. Forget a stored procedure and your next build throws "already exists" errors.

noorm's teardown module provides controlled database reset operations. Wipe data while preserving schema, or tear down everything and start fresh. Both operations handle foreign key constraints automatically, preserve noorm's internal tracking tables, and complete in milliseconds—not seconds.


## Two Operations

| Operation | What it does | Use case |
|-----------|--------------|----------|
| `truncateData` | Delete all rows, keep schema | Test data reset, seed re-runs |
| `teardownSchema` | Drop all objects | Full rebuild, change testing |

Both operations:
- Automatically disable/enable FK constraints
- Preserve noorm internal tables (`__noorm_*`)
- Support dry-run mode for preview
- Generate dialect-specific SQL


## Truncate Data

Remove all data while preserving table structure:

```typescript
import { truncateData } from './core/teardown'

// Truncate all tables
const result = await truncateData(db, 'postgres')

console.log(`Truncated: ${result.truncated.join(', ')}`)
console.log(`Preserved: ${result.preserved.join(', ')}`)
console.log(`Duration: ${result.durationMs}ms`)
```

### Preserving Tables

Keep specific tables intact:

```typescript
// Preserve lookup tables
const result = await truncateData(db, 'postgres', {
    preserve: ['countries', 'currencies', 'app_settings'],
})
```

### Truncating Specific Tables

Only truncate certain tables:

```typescript
// Only truncate user-related tables
const result = await truncateData(db, 'postgres', {
    only: ['users', 'user_sessions', 'user_preferences'],
})
```

### Identity Columns

By default, identity/auto-increment sequences are reset. Disable this:

```typescript
const result = await truncateData(db, 'postgres', {
    restartIdentity: false,  // Keep current sequence values
})
```


## Teardown Schema

Drop all user-created database objects:

```typescript
import { teardownSchema } from './core/teardown'

// Drop everything except noorm tables
const result = await teardownSchema(db, 'postgres')

console.log('Dropped:')
console.log(`  Tables: ${result.dropped.tables.length}`)
console.log(`  Views: ${result.dropped.views.length}`)
console.log(`  Functions: ${result.dropped.functions.length}`)
console.log(`  Types: ${result.dropped.types.length}`)
console.log(`Preserved: ${result.preserved.join(', ')}`)
```

### Drop Order

Objects are dropped in dependency-safe order:

1. **Foreign key constraints** - Must go first to allow table drops
2. **Views** - May depend on tables
3. **Tables** - Core schema objects
4. **Functions/Procedures** - May depend on types
5. **Types** - Enum and composite types last

### Selective Teardown

Keep certain object types:

```typescript
const result = await teardownSchema(db, 'postgres', {
    keepViews: true,      // Preserve all views
    keepFunctions: true,  // Preserve procedures and functions
    keepTypes: true,      // Preserve enum and composite types
})
```

Preserve specific tables:

```typescript
const result = await teardownSchema(db, 'postgres', {
    preserveTables: ['audit_log', 'system_config'],
})
```

### Post-Teardown Script

Run a cleanup SQL script after teardown:

```typescript
const result = await teardownSchema(db, 'postgres', {
    postScript: 'sql/teardown/cleanup.sql',
})

if (result.postScriptResult?.executed) {
    console.log('Cleanup script ran successfully')
}
else if (result.postScriptResult?.error) {
    console.error('Cleanup failed:', result.postScriptResult.error)
}
```


## Preview Mode

Both operations support dry-run mode to preview changes:

```typescript
// Preview truncate
const truncatePreview = await truncateData(db, 'postgres', { dryRun: true })
console.log('Would truncate:', truncatePreview.truncated)
console.log('SQL statements:', truncatePreview.statements)

// Preview teardown
import { previewTeardown } from './core/teardown'

const teardownPreview = await previewTeardown(db, 'postgres')
console.log('Would drop:')
console.log('  Tables:', teardownPreview.toDrop.tables)
console.log('  Views:', teardownPreview.toDrop.views)
console.log('SQL:', teardownPreview.statements)
```


## Type Definitions

### TruncateOptions

```typescript
interface TruncateOptions {
    /** Tables to preserve (won't be truncated) */
    preserve?: string[]

    /** If set, only truncate these tables */
    only?: string[]

    /** Reset identity/auto-increment sequences (default: true) */
    restartIdentity?: boolean

    /** Dry run - return SQL without executing */
    dryRun?: boolean
}
```

### TeardownOptions

```typescript
interface TeardownOptions {
    /** Additional tables to preserve beyond __noorm_* */
    preserveTables?: string[]

    /** Keep views (default: false) */
    keepViews?: boolean

    /** Keep functions/procedures (default: false) */
    keepFunctions?: boolean

    /** Keep types/enums (default: false) */
    keepTypes?: boolean

    /** SQL script path to run after teardown */
    postScript?: string

    /** Dry run - return SQL without executing */
    dryRun?: boolean
}
```

### Result Types

```typescript
interface TruncateResult {
    truncated: string[]      // Tables that were truncated
    preserved: string[]      // Tables that were preserved
    statements: string[]     // SQL statements executed
    durationMs: number       // Duration in milliseconds
}

interface TeardownResult {
    dropped: {
        tables: string[]
        views: string[]
        functions: string[]
        types: string[]
        foreignKeys: string[]
    }
    preserved: string[]
    statements: string[]
    durationMs: number
    postScriptResult?: {
        executed: boolean
        error?: string
    }
}
```


## Dialect Support

All four database dialects are supported with appropriate SQL generation:

| Feature | PostgreSQL | MySQL | MSSQL | SQLite |
|---------|------------|-------|-------|--------|
| Truncate tables | ✓ | ✓ | ✓ | DELETE FROM |
| Restart identity | ✓ | ✓ | RESEED | — |
| Disable FK checks | SET session_replication_role | SET FOREIGN_KEY_CHECKS | NOCHECK | PRAGMA foreign_keys |
| Drop cascade | CASCADE | — | — | — |

SQLite uses DELETE instead of TRUNCATE since SQLite doesn't support TRUNCATE.


## Observer Events

| Event | Payload | When |
|-------|---------|------|
| `teardown:start` | `{ type: 'truncate' \| 'schema' }` | Operation starting |
| `teardown:progress` | `{ category, object, action }` | Each object being processed |
| `teardown:error` | `{ error, object }` | Error during operation |
| `teardown:complete` | `{ result }` | Operation finished |

```typescript
import { observer } from './core/observer'

observer.on('teardown:progress', ({ category, object, action }) => {
    console.log(`${action} ${category}: ${object}`)
})

observer.on('teardown:complete', ({ result }) => {
    console.log(`Teardown complete in ${result.durationMs}ms`)
})
```


## CLI Integration

Access teardown from the database menu:

1. Press `d` from home to enter database menu
2. Select a config with an active connection
3. Choose truncate or teardown operation
4. Confirm the destructive action

The CLI shows a preview of affected objects before execution and requires explicit confirmation for non-dry-run operations.


## Safety Features

**Always Preserved:**
- `__noorm_change__` - Change execution history
- `__noorm_executions__` - File execution records
- `__noorm_locks__` - Active operation locks

**Confirmation Required:**
- Protected configs require extra confirmation
- Production stages show additional warnings
- Dry-run is recommended before actual execution


## Settings Integration

Configure default teardown behavior in `.noorm/settings.yml`:

```yaml
teardown:
    preserveTables:
        - AppSettings
        - UserRoles
        - AuditLog
    postScript: sql/teardown/cleanup.sql
```

These settings are applied automatically by the CLI and can be overridden per-operation. See [Settings](./settings.md#teardown-configuration) for details.


## Best Practices

1. **Preview first** - Always run with `dryRun: true` before executing, especially in shared environments.

2. **Preserve audit tables** - If you have audit logging, add those tables to `preserveTables` in settings.

3. **Use truncate for test cycles** - Faster than teardown + rebuild when schema hasn't changed.

4. **Post-script for seeds** - Use `postScript` to re-insert required seed data after teardown.

5. **Check protected status** - Teardown on protected configs should require explicit confirmation.

```typescript
// Safe teardown pattern
const preview = await previewTeardown(db, dialect)
console.log('Will drop:', preview.toDrop.tables.length, 'tables')

const confirmed = await promptUser('Proceed with teardown?')
if (confirmed) {
    await teardownSchema(db, dialect)
}
```
