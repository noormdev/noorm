# Data Transfer


## The Problem

You have two databases with the same schema—staging and production, dev and QA, primary and backup. You need to copy data between them. The options aren't great.

Database-native tools (`pg_dump`, `mysqldump`, `bcp`) work but they're dialect-specific, require shell access, and don't integrate with your config management. Writing custom scripts means handling FK ordering, identity columns, conflict resolution, and batch sizing yourself. Every dialect has its own quirks.

noorm's transfer module moves data between databases using your existing configs. It handles FK dependency ordering, identity column preservation, same-server optimization, and configurable conflict resolution. PostgreSQL, MySQL, and MSSQL are supported—including cross-dialect transfers (e.g., PostgreSQL to MySQL) with automatic type conversion.


## How It Works

Transfer operates in two phases:

1. **Planning** — Introspects source and destination schemas, builds a dependency graph from foreign keys, topologically sorts tables, and detects whether both databases share a server.

2. **Execution** — Transfers tables in dependency order using one of three strategies:

| Strategy | When | How |
|----------|------|-----|
| Same-server | Same host/port, same dialect | Direct `INSERT INTO dest SELECT * FROM source` |
| Cross-server | Different hosts, same dialect | Batched read from source, write to destination |
| Cross-dialect | Different dialects | Batched read → type conversion via DtStreamer → write |

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

    /** Export to .dt file instead of DB insert. */
    exportPath?: string

    /** Passphrase for .dtzx export encryption. */
    passphrase?: string

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

If the post-transfer re-enable fails, the transfer itself still completes, but `TransferResult.fkChecksRestored` is `false` and the CLI prints a warning. Re-enable FK checks manually before trusting referential integrity on the destination.


## Cross-Dialect Transfers

When source and destination use different dialects (e.g., PostgreSQL to MySQL), the transfer module uses the `DtStreamer` for in-memory type conversion.

### How It Works

1. Query source database version via `queryDatabaseVersion()`
2. Build column type mappings via `buildDtSchema()` — maps dialect-specific types to universal intermediates
3. Validate target schema compatibility via `validateSchema()`
4. For each batch:
   - Fetch rows from source
   - Convert via `streamer.convertBatch()` — source values → universal → target values
   - Insert into destination

No file I/O or JSON serialization occurs—conversion happens entirely in memory on native JavaScript objects.

### Universal Type System

The `DtStreamer` converts between dialect types through a universal intermediate:

| Category | Universal Types |
|----------|-----------------|
| Simple | `string`, `int`, `bigint`, `float`, `decimal`, `bool`, `timestamp`, `date`, `uuid` |
| Encoded | `json`, `binary`, `vector`, `array`, `custom` |

Version-aware mappings handle dialect differences:

| Type | PostgreSQL | MySQL | MSSQL |
|------|------------|-------|-------|
| JSON | `jsonb` | `JSON` | `NVARCHAR(MAX)` (pre-2025), `JSON` (2025+) |
| Vector | `vector(N)` | `VECTOR(N)` (9.0+) | `VECTOR(N)` (2025+) |
| UUID | `uuid` | `CHAR(36)` | `UNIQUEIDENTIFIER` |
| Boolean | `boolean` | `TINYINT(1)` | `BIT` |
| Array | `type[]` | JSON fallback | JSON fallback |

### Soft-Limit Batching

Cross-dialect transfers use soft-limit batching to prevent OOM on tables with large BLOB/BINARY columns:

- Default batch size: 1000 rows
- Memory threshold: 1GB per batch
- Whichever limit is reached first triggers a flush

```typescript
const streamer = createStreamer({
    sourceDialect: 'postgres',
    targetDialect: 'mysql',
    columns: schema.columns,
    batchSize: 1000,        // soft row limit
    maxBatchBytes: gigabytes(1),  // memory limit
})
```


## File Export/Import

The `.dt` format provides portable data files for backup, migration, and seeding.

### File Extensions

| Extension | Description |
|-----------|-------------|
| `.dt` | Plain text (human-readable JSON5) |
| `.dtz` | Gzip-compressed |
| `.dtzx` | Encrypted + compressed (AES-256-GCM with passphrase) |

### Format Structure

Each `.dt` file is line-based JSON5:

```
{v:1,d:"postgres",dv:"16.2",t:"users",columns:[{name:"id",type:"int"},{name:"email",type:"string"}]}
[1,"alice@example.com"]
[2,"bob@example.com"]
```

Line 1 is the schema header with source dialect, version, table name, and column definitions. Subsequent lines are data rows as JSON5 arrays.

### Encoding

Values use smart encoding based on size and compressibility:

| Condition | Encoding |
|-----------|----------|
| Small values (< 128 bytes) | `raw` (inline) |
| Binary data | `b64` (base64) |
| Large compressible data (gzip saves ≥15%) | `gz64` (gzip + base64) |

Encoded values appear as tuples: `["SGVsbG8gV29ybGQ=", "b64"]`

### API

```typescript
import { exportTable, importDtFile } from './core/dt'

// Export a table to .dt file
const [result, err] = await exportTable({
    db: kyselyDb,
    dialect: 'postgres',
    tableName: 'users',
    filepath: './backup/users.dtz',
    batchSize: 5000,
})

// Import from .dt file
const [importResult, importErr] = await importDtFile({
    filepath: './backup/users.dtz',
    db: destDb,
    dialect: 'mysql',
    onConflict: 'update',
})
```

### Encryption

`.dtzx` files use passphrase-based encryption:

- Key derivation: PBKDF2 with random salt
- Cipher: AES-256-GCM with random IV
- Format: `{ salt, iv, authTag, ciphertext }` (all base64)

The encryption is self-contained—no dependency on noorm's identity system. Files can be shared and decrypted anywhere with the passphrase.

### Template Loader Integration

`.dt` and `.dtz` files work as seed data in templates:

```sql
-- seeds/users.sql
<% const users = await load('./users.dt') %>
<% for (const row of users) { %>
INSERT INTO users (id, email) VALUES (<%= row.id %>, '<%= row.email %>');
<% } %>
```

Note: `.dtzx` files are not supported in templates—there's no secure way to provide the passphrase.


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

    /** Whether this is a cross-dialect transfer */
    crossDialect: boolean

    /** Source database dialect */
    sourceDialect: Dialect

    /** Destination database dialect */
    destinationDialect: Dialect

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

    /** Column type definitions for cross-dialect transfers */
    columnTypes?: DtColumn[]

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

    /**
     * Whether FK checks were re-enabled on the destination.
     * false only when checks were disabled for this transfer and the
     * re-enable attempt failed. status does not flip on a failed
     * FK restore, so check this field after every transfer.
     */
    fkChecksRestored: boolean

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

### Transfer Events

| Event | Payload | When |
|-------|---------|------|
| `transfer:planning` | `{ source, destination }` | Planning phase starts |
| `transfer:plan:ready` | `{ sameServer, tableCount, estimatedRows, warnings }` | Plan built successfully |
| `transfer:starting` | `{ tableCount, sameServer }` | Execution begins |
| `transfer:table:before` | `{ table, index, total, rowCount }` | Before each table |
| `transfer:table:progress` | `{ table, rowsTransferred, rowsTotal, rowsSkipped }` | During batch transfers |
| `transfer:table:after` | `{ table, status, rowsTransferred, rowsSkipped, durationMs, error? }` | After each table |
| `transfer:complete` | `{ status, totalRows, tableCount, durationMs }` | Transfer finished |

### Export/Import Events

| Event | Payload | When |
|-------|---------|------|
| `dt:export:start` | `{ filepath, table, columnCount }` | Export begins |
| `dt:export:progress` | `{ filepath, table, rowsWritten, bytesWritten }` | After each batch flush |
| `dt:export:complete` | `{ filepath, table, rowsWritten, bytesWritten, durationMs }` | Export finished |
| `dt:import:start` | `{ filepath, sourceDialect, sourceVersion, table }` | Import begins |
| `dt:import:schema` | `{ filepath, table, columns, validation }` | Schema parsed and validated |
| `dt:import:progress` | `{ filepath, table, rowsImported, rowsSkipped }` | After each batch insert |
| `dt:import:complete` | `{ filepath, table, rowsImported, rowsSkipped, durationMs }` | Import finished |

### Cross-Dialect Stream Events

| Event | Payload | When |
|-------|---------|------|
| `dt:stream:start` | `{ table, sourceDialect, targetDialect }` | Cross-dialect stream begins |
| `dt:stream:progress` | `{ table, rowsConverted }` | After each batch conversion |
| `dt:stream:complete` | `{ table, rowsConverted, durationMs }` | Cross-dialect stream finished |
| `dt:validate:result` | `{ table, valid, errors, warnings }` | Schema validation completed |

```typescript
import { observer } from './core/observer'

observer.on('transfer:table:progress', ({ table, rowsTransferred, rowsTotal }) => {
    const pct = Math.round((rowsTransferred / rowsTotal) * 100)
    console.log(`${table}: ${pct}% (${rowsTransferred}/${rowsTotal})`)
})

observer.on('transfer:complete', ({ status, totalRows, durationMs }) => {
    console.log(`Transfer ${status}: ${totalRows} rows in ${durationMs}ms`)
})

observer.on('dt:export:progress', ({ table, rowsWritten, bytesWritten }) => {
    console.log(`Exporting ${table}: ${rowsWritten} rows, ${bytesWritten} bytes`)
})
```


## CLI Integration

### Interactive Mode (TUI)

From the database menu, the transfer screen provides a wizard with three modes:

**DB-to-DB Transfer:**
1. Select destination config
2. Choose tables (all or specific)
3. Set conflict strategy and options
4. Preview plan
5. Execute with live progress

**Export to File:**
1. Select "Export to .dt file" from destination list
2. Choose tables
3. Set export path, compression, and encryption options
4. Execute with progress

**Import from File:**
1. Select "Import from .dt file" from destination list
2. Enter file path
3. Enter passphrase (if `.dtzx`)
4. Preview schema validation
5. Set conflict strategy
6. Execute with progress

Access via: Home → `d` (database) → select config → transfer option

### Headless Mode

```bash
# Transfer all tables to another config
noorm db transfer --to backup

# Transfer specific tables with upsert
noorm db transfer --to backup --tables users,posts --on-conflict update

# Cross-dialect transfer (postgres to mysql)
noorm db transfer --to mysql-staging --tables users

# Dry run to preview plan
noorm db transfer --to backup --dry-run

# Truncate destination first
noorm db transfer --to backup --truncate

# JSON output for scripting
noorm db transfer --to backup --json

# Export single table to .dt file
noorm db transfer --export ./backup/users.dt --tables users

# Export multiple tables to directory (compressed)
noorm db transfer --export ./backup/ --tables users,posts --compress

# Export with encryption
noorm db transfer --export ./backup/ --tables users,posts --passphrase "my-secret"

# Import from .dt file
noorm db transfer --import ./backup/users.dt

# Import encrypted file with upsert
noorm db transfer --import ./backup.dtzx --passphrase "my-secret" --on-conflict update

# Validate import schema without executing
noorm db transfer --import ./backup.dt --dry-run
```

### Export Path Rules

The `--tables` flag is required for export. The `--export` path is interpreted based on table count:

| Scenario | Path | Result |
|----------|------|--------|
| Single table | `./data/users.dt` | Writes to that exact path |
| Multiple tables | `./data/backup/` | Creates `<table>.dt` per table |

Extension determines format when specified explicitly. Otherwise:

| Flags | Output Extension |
|-------|------------------|
| (none) | `.dt` |
| `--compress` | `.dtz` |
| `--passphrase` | `.dtzx` |


## Module Structure

```
src/core/transfer/
├── index.ts            # Public API: transferData, getTransferPlan
├── types.ts            # Type definitions
├── events.ts           # Observer event types
├── planner.ts          # Schema analysis, FK ordering, plan building
├── executor.ts         # Transfer execution (same-server, cross-server, cross-dialect)
├── same-server.ts      # Same-server detection logic
└── dialects/
    ├── index.ts        # Dialect factory
    ├── types.ts        # TransferDialectOperations interface
    ├── postgres.ts     # PostgreSQL implementation
    ├── mysql.ts        # MySQL implementation
    └── mssql.ts        # MSSQL implementation

src/core/dt/
├── index.ts            # Public API: exportTable, importDtFile, createStreamer
├── types.ts            # DtSchema, DtColumn, UniversalType, Encoding, etc.
├── constants.ts        # Thresholds (GZIP_THRESHOLD=128, GZIP_RATIO_THRESHOLD=0.85)
├── events.ts           # Observer event types for dt operations
├── type-map.ts         # toUniversalType(), toDialectType()
├── serialize.ts        # serializeRow(), encodeValue()
├── deserialize.ts      # deserializeRow(), decodeValue()
├── writer.ts           # DtWriter class (streaming file writer)
├── reader.ts           # DtReader class (streaming file reader)
├── streamer.ts         # DtStreamer class (in-memory cross-dialect conversion)
├── schema.ts           # buildDtSchema(), validateSchema()
├── version.ts          # queryDatabaseVersion()
├── crypto.ts           # encryptWithPassphrase(), decryptWithPassphrase()
├── paths.ts            # resolveExportPath(), resolveExportExtension()
└── dialects/
    ├── index.ts        # Dialect registry
    ├── postgres.ts     # PostgreSQL type mappings
    ├── mysql.ts        # MySQL type mappings (version-aware)
    └── mssql.ts        # MSSQL type mappings (version-aware)
```


## Limitations

1. **SQLite not supported** — SQLite has no server concept and limited ALTER TABLE support, making it impractical for transfer operations.

2. **Schema must pre-exist** — The destination database must already have matching table structures. Transfer does not create or modify schema.

3. **Row-by-row conflict handling** — Cross-server and cross-dialect transfers with conflict strategies insert rows individually rather than in bulk, which is slower for large datasets with many conflicts.

4. **PostgreSQL cross-database** — PostgreSQL cannot query across databases without the `dblink` or `postgres_fdw` extensions. Same-server optimization only applies when both configs point to the same database.

5. **Type conversion fidelity** — Cross-dialect transfers convert through universal types. Some dialect-specific features may be lost (e.g., PostgreSQL arrays become JSON in MySQL, custom types become strings). The schema validation warns about potential issues before transfer begins.

6. **No .dtzx in templates** — Encrypted `.dtzx` files cannot be used as seed data in templates because there's no secure way to provide the passphrase in the template context.
