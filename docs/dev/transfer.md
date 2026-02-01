# Data Transfer


## The Problem

You have two databases with the same schema—staging and production, dev and QA, primary and backup. You need to copy data between them. The options aren't great.

Database-native tools (`pg_dump`, `mysqldump`, `bcp`) work but they're dialect-specific, require shell access, and don't integrate with your config management. Writing custom scripts means handling FK ordering, identity columns, conflict resolution, and batch sizing yourself. Every dialect has its own quirks.

noorm's transfer module moves data between any two same-dialect databases using your existing configs. It handles FK dependency ordering, identity column preservation, same-server optimization, and configurable conflict resolution. PostgreSQL, MySQL, and MSSQL are supported.


## How It Works

Transfer operates in two phases:

1. **Planning** — Introspects source and destination schemas, builds a dependency graph from foreign keys, topologically sorts tables, and detects whether both databases share a server.

2. **Execution** — Transfers tables in dependency order using one of two strategies:

| Strategy | When | How |
|----------|------|-----|
| Same-server | Source and destination on same host/port | Direct `INSERT INTO dest SELECT * FROM source` |
| Cross-server | Different hosts or ports | Batched read from source, write to destination |

Same-server detection varies by dialect:

| Dialect | Same-server criteria |
|---------|---------------------|
| PostgreSQL | Same host + port + database (no cross-database queries without extensions) |
| MySQL | Same host + port (cross-database queries supported) |
| MSSQL | Same host + port (cross-database queries supported) |
| SQLite | Never (no server concept) |


## Quick Start

```typescript
import { transferData, getTransferPlan } from './core/transfer'

// Transfer all tables from source to destination
const [result, err] = await transferData(sourceConfig, destConfig)

if (err) {
    console.error('Transfer failed:', err.message)
}
else {
    console.log(`Transferred ${result.totalRows} rows across ${result.tables.length} tables`)
}

// Preview without executing
const [plan, planErr] = await getTransferPlan(sourceConfig, destConfig)

console.log(`Tables: ${plan.tables.length}`)
console.log(`Same server: ${plan.sameServer}`)
console.log(`Estimated rows: ${plan.estimatedRows}`)
```


## Transfer Options

```typescript
interface TransferOptions {

    /** Tables to transfer. Empty = all user tables. */
    tables?: string[]

    /** How to handle primary key conflicts. Default: 'fail' */
    onConflict?: 'fail' | 'skip' | 'update' | 'replace'

    /** Rows per batch for cross-server transfers. Default: 1000 */
    batchSize?: number

    /** Disable foreign key checks during transfer. Default: true */
    disableForeignKeys?: boolean

    /** Preserve identity/auto-increment values. Default: true */
    preserveIdentity?: boolean

    /** Truncate destination tables before transfer. Default: false */
    truncateFirst?: boolean

    /** Validate only, don't execute. Default: false */
    dryRun?: boolean

}
```


## Conflict Strategies

When the destination already has rows with matching primary keys:

| Strategy | Behavior | PostgreSQL | MySQL | MSSQL |
|----------|----------|------------|-------|-------|
| `fail` | Abort on first conflict | Default insert | Default insert | Default insert |
| `skip` | Skip conflicting rows | `ON CONFLICT DO NOTHING` | `INSERT IGNORE` | `MERGE ... WHEN NOT MATCHED` |
| `update` | Update existing rows | `ON CONFLICT DO UPDATE` | `ON DUPLICATE KEY UPDATE` | `MERGE ... WHEN MATCHED UPDATE` |
| `replace` | Delete and re-insert | Row-by-row fallback | `REPLACE INTO` | `MERGE ... DELETE + INSERT` |

The `fail` strategy uses the same-server direct path when available. Other strategies always use the cross-server batch path, even on the same server, because conflict handling requires row-level control.


## Planning

The planner queries each dialect's system catalog to gather table metadata:

| Dialect | System Catalog | Row Estimates |
|---------|---------------|---------------|
| PostgreSQL | `information_schema` + `pg_catalog` | `pg_class.reltuples` |
| MySQL | `INFORMATION_SCHEMA` | `TABLE_ROWS` |
| MSSQL | `sys.tables` + `sys.columns` | `sys.partitions` |

For each table, the planner collects:

- Column names and order
- Primary key columns
- Identity/auto-increment column (if any)
- Foreign key relationships
- Estimated row count

Internal tables (`__noorm_*`) are automatically excluded.

### FK Dependency Ordering

Tables are topologically sorted by foreign key relationships. Parent tables are inserted before children:

```
users → todo_lists → todo_items
```

Becomes: `users`, `todo_lists`, `todo_items`

If a circular dependency is detected, the planner falls back to the original table order and emits a warning. FK checks are disabled during transfer to handle this case.

### Schema Validation

The planner checks the destination for matching tables. Missing tables generate warnings but don't block the transfer—they're simply skipped during execution.


## Execution

### Same-Server Path

When source and destination are on the same server, the executor uses direct SQL:

```sql
-- MySQL/MSSQL: cross-database INSERT...SELECT
INSERT INTO dest_db.table_name (col1, col2, ...)
SELECT col1, col2, ... FROM source_db.table_name
```

This avoids marshalling data through the application. Identity insert is enabled/disabled around the operation, and sequences are reset afterward.

### Cross-Server Path

When databases are on different servers, data is transferred in batches:

1. Fetch `batchSize` rows from source (ordered, paginated with OFFSET)
2. Insert batch into destination with conflict handling
3. Emit progress events after each batch
4. Repeat until all rows are transferred

Each batch is inserted row-by-row with dialect-specific conflict SQL. MSSQL uses `MERGE` statements, MySQL uses `INSERT IGNORE` / `ON DUPLICATE KEY UPDATE` / `REPLACE INTO`, and PostgreSQL uses Kysely's `onConflict` builder.

### Identity Column Handling

When `preserveIdentity` is true (default):

| Dialect | Enable | Disable | Sequence Reset |
|---------|--------|---------|----------------|
| PostgreSQL | Not needed (SERIAL/GENERATED BY DEFAULT) | — | `SELECT setval(pg_get_serial_sequence(...), MAX(col))` |
| MySQL | Not needed (AUTO_INCREMENT allows explicit values) | — | `ALTER TABLE ... AUTO_INCREMENT = MAX(col) + 1` |
| MSSQL | `SET IDENTITY_INSERT table ON` | `SET IDENTITY_INSERT table OFF` | `DBCC CHECKIDENT(table, RESEED)` |

### Truncate Handling

When `truncateFirst` is true, destination tables are cleared before data insertion:

| Dialect | Method | Reason |
|---------|--------|--------|
| PostgreSQL | `TRUNCATE TABLE ... CASCADE` | Handles FK references |
| MySQL | `TRUNCATE TABLE` | Standard truncate |
| MSSQL | `DELETE FROM` | MSSQL can't TRUNCATE with FK constraints |

### FK Check Management

Foreign key checks are disabled on the destination before transfer and re-enabled after:

| Dialect | Disable | Enable |
|---------|---------|--------|
| PostgreSQL | `ALTER TABLE ... DISABLE TRIGGER ALL` (per table) | `ALTER TABLE ... ENABLE TRIGGER ALL` |
| MySQL | `SET FOREIGN_KEY_CHECKS = 0` (session-wide) | `SET FOREIGN_KEY_CHECKS = 1` |
| MSSQL | `ALTER TABLE ... NOCHECK CONSTRAINT ALL` (per table) | `ALTER TABLE ... CHECK CONSTRAINT ALL` |


## Dialect Operations

Each dialect implements the `TransferDialectOperations` interface:

```typescript
interface TransferDialectOperations {

    /** SQL to enable identity insert for a table */
    getEnableIdentityInsertSql(table: string): string | null

    /** SQL to disable identity insert for a table */
    getDisableIdentityInsertSql(table: string): string | null

    /** SQL to reset auto-increment sequence after transfer */
    getResetSequenceSql(table: string, column: string, schema?: string): string | null

    /** Build dialect-specific INSERT with conflict handling */
    buildConflictInsert(
        table: string,
        columns: string[],
        primaryKey: string[],
        strategy: ConflictStrategy,
    ): string

    /** Build direct INSERT...SELECT for same-server transfers */
    buildDirectTransfer(
        sourceDb: string,
        sourceTable: string,
        destTable: string,
        columns: string[],
        sourceSchema?: string,
        destSchema?: string,
    ): string

    /** Execute FK disable on destination tables */
    executeDisableFK(db: Kysely<NoormDatabase>, tables: string[]): Promise<void>

    /** Execute FK enable on destination tables */
    executeEnableFK(db: Kysely<NoormDatabase>, tables: string[]): Promise<void>

}
```

Implementations live in `src/core/transfer/dialects/`:

- `postgres.ts` — PostgreSQL operations
- `mysql.ts` — MySQL operations
- `mssql.ts` — MSSQL operations


## Type Definitions

### TransferPlan

```typescript
interface TransferPlan {

    /** Tables in dependency order (parents before children) */
    tables: TransferTablePlan[]

    /** Whether source and destination are on same server */
    sameServer: boolean

    /** Total estimated rows across all tables */
    estimatedRows: number

    /** Warnings about potential issues */
    warnings: string[]

}

interface TransferTablePlan {

    name: string
    schema?: string
    rowCount: number
    hasIdentity: boolean
    identityColumn?: string
    primaryKey: string[]
    columns: string[]
    dependsOn: string[]

}
```

### TransferResult

```typescript
interface TransferResult {

    /** Overall status */
    status: 'success' | 'partial' | 'failed'

    /** Results per table */
    tables: TransferTableResult[]

    /** Total rows transferred */
    totalRows: number

    /** Total duration in milliseconds */
    durationMs: number

}

interface TransferTableResult {

    table: string
    status: 'success' | 'skipped' | 'failed'
    rowsTransferred: number
    rowsSkipped: number
    durationMs: number
    error?: string

}
```


## Observer Events

| Event | Payload | When |
|-------|---------|------|
| `transfer:planning` | `{ source, destination }` | Planning phase starts |
| `transfer:plan:ready` | `{ sameServer, tableCount, estimatedRows, warnings }` | Plan built successfully |
| `transfer:starting` | `{ tableCount, sameServer }` | Execution begins |
| `transfer:table:before` | `{ table, index, total, rowCount }` | Before each table |
| `transfer:table:progress` | `{ table, rowsTransferred, rowsTotal, rowsSkipped }` | During batch transfers |
| `transfer:table:after` | `{ table, status, rowsTransferred, rowsSkipped, durationMs, error? }` | After each table |
| `transfer:complete` | `{ status, totalRows, tableCount, durationMs }` | Transfer finished |

```typescript
import { observer } from './core/observer'

observer.on('transfer:table:progress', ({ table, rowsTransferred, rowsTotal }) => {
    const pct = Math.round((rowsTransferred / rowsTotal) * 100)
    console.log(`${table}: ${pct}% (${rowsTransferred}/${rowsTotal})`)
})

observer.on('transfer:complete', ({ status, totalRows, durationMs }) => {
    console.log(`Transfer ${status}: ${totalRows} rows in ${durationMs}ms`)
})
```


## CLI Integration

### Interactive Mode (TUI)

From the database menu, the transfer screen provides a wizard:

1. Select source config
2. Select destination config
3. Choose tables (all or specific)
4. Set conflict strategy and options
5. Preview plan
6. Execute with live progress

Access via: Home → `d` (database) → select config → transfer option

### Headless Mode

```bash
# Transfer all tables
noorm -H db transfer --to backup

# Transfer specific tables with upsert
noorm -H db transfer --to backup --tables users,posts --on-conflict update

# Dry run to preview plan
noorm -H db transfer --to backup --dry-run

# Truncate destination first
noorm -H db transfer --to backup --truncate

# JSON output for scripting
noorm -H --json db transfer --to backup
```


## Module Structure

```
src/core/transfer/
├── index.ts            # Public API: transferData, getTransferPlan
├── types.ts            # Type definitions
├── events.ts           # Observer event types
├── planner.ts          # Schema analysis, FK ordering, plan building
├── executor.ts         # Transfer execution (same-server + cross-server)
├── same-server.ts      # Same-server detection logic
└── dialects/
    ├── index.ts        # Dialect factory
    ├── types.ts        # TransferDialectOperations interface
    ├── postgres.ts     # PostgreSQL implementation
    ├── mysql.ts        # MySQL implementation
    └── mssql.ts        # MSSQL implementation
```


## Limitations

1. **Same-dialect only** — Source and destination must use the same database dialect. Cross-dialect transfers (e.g., PostgreSQL to MySQL) are not supported.

2. **SQLite not supported** — SQLite has no server concept and limited ALTER TABLE support, making it impractical for transfer operations.

3. **Schema must pre-exist** — The destination database must already have matching table structures. Transfer does not create or modify schema.

4. **Row-by-row conflict handling** — Cross-server transfers with conflict strategies insert rows individually rather than in bulk, which is slower for large datasets with many conflicts.

5. **PostgreSQL cross-database** — PostgreSQL cannot query across databases without the `dblink` or `postgres_fdw` extensions. Same-server optimization only applies when both configs point to the same database.
