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

Same-server detection varies by dialect (`src/core/transfer/same-server.ts`):

| Dialect | Same-server criteria |
|---------|---------------------|
| PostgreSQL | **Never** — always takes the batch path |
| MySQL | Same host + port (cross-database queries supported) |
| MSSQL | Same host + port (cross-database queries supported) |
| SQLite | Never (no server concept) |

PostgreSQL is never same-server, and the reason is not just the missing `dblink` / `postgres_fdw`. When both configs name the *same* database, the direct statement degenerates to `INSERT INTO t SELECT ... FROM t` — copying the destination into itself. Neither outcome is a transfer, so postgres has no direct path at all.

Host comparison normalizes `127.0.0.1`, `::1`, and `localhost.localdomain` to `localhost`. An unset port falls back to the dialect's default before comparison, so `host: 'db'` and `host: 'db', port: 3306` are the same server on MySQL.


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

    /** Caller channel for the policy gate. Default: 'user' */
    channel?: Channel

}
```

### Policy gates

Both entry points are gated against the **destination** config — the write target is the destructive side, not the source:

| Function | Permission | Notes |
|----------|-----------|-------|
| `transferData` | `db:reset` | Checked before any connection opens. Dry runs are gated too — the matrix has no carve-out |
| `getTransferPlan` | `transfer:plan` | The plan is destination schema metadata (table names, row estimates, the FK graph). Ungated, a viewer denied `transferData` could read all of it through `--dry-run` |

A denial is returned as the error half of the tuple, not thrown.


## Conflict Strategies

When the destination already has rows with matching primary keys:

| Strategy | Behavior | PostgreSQL | MySQL | MSSQL |
|----------|----------|------------|-------|-------|
| `fail` | Abort on first conflict | Plain insert | Plain insert | Plain insert |
| `skip` | Skip conflicting rows | `ON CONFLICT (pk) DO NOTHING` | `INSERT IGNORE` | `MERGE ... WHEN NOT MATCHED INSERT` |
| `update` | Update non-PK columns | `ON CONFLICT (pk) DO UPDATE SET` | `ON DUPLICATE KEY UPDATE` | `MERGE ... WHEN MATCHED UPDATE / WHEN NOT MATCHED INSERT` |
| `replace` | Overwrite the whole row | `ON CONFLICT (pk) DO UPDATE SET` (all columns) | `REPLACE INTO` | `MERGE`, updating all columns when matched |

`replace` only literally deletes and re-inserts on MySQL, where `REPLACE INTO` is defined that way — with the side effects that implies (`ON DELETE CASCADE` fires, unlisted columns reset to defaults). PostgreSQL and MSSQL implement it as an upsert over every column, so the row is overwritten in place.

When *all* columns are part of the primary key there is nothing to update, so `update` degrades to `DO NOTHING` on PostgreSQL and `INSERT IGNORE` on MySQL.

The `fail` strategy uses the same-server direct path when available. Other strategies always use the cross-server batch path, even on the same server, because conflict handling requires row-level control. A cross-dialect transfer never uses the direct path regardless of strategy.


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

Internal tables are excluded by **name prefix only** — `listUserTables` drops anything starting with `__noorm_` (`src/core/transfer/planner.ts:249`).

> **Caveat on PostgreSQL and SQL Server.** Those dialects keep their tracking tables in a dedicated `noorm` schema under clean names (`noorm.change`, `noorm.lock`, …), which the `__noorm_` prefix test does not match. Unlike the explore and teardown paths, the transfer planner's catalog queries exclude only the true system schemas (`pg_catalog` / `information_schema` / `pg_toast`, and `is_ms_shipped = 0` on MSSQL), so noorm's own tracking tables can appear in a plan. Check the dry-run table list, or pass `--tables` explicitly, before transferring a whole PostgreSQL or SQL Server database.

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
| PostgreSQL | Not needed — every insert carries `OVERRIDING SYSTEM VALUE`, which is what lets `GENERATED ALWAYS AS IDENTITY` accept an explicit value | — | `SELECT setval(pg_get_serial_sequence(...), MAX(col))` |
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
| PostgreSQL | `SET session_replication_role = replica` (session-wide) | `SET session_replication_role = DEFAULT` |
| MySQL | `SET FOREIGN_KEY_CHECKS = 0` (session-wide) | `SET FOREIGN_KEY_CHECKS = 1` |
| MSSQL | `ALTER TABLE ... NOCHECK CONSTRAINT ALL` (per table) | `ALTER TABLE ... WITH CHECK CHECK CONSTRAINT ALL` (per table) |

PostgreSQL's `session_replication_role` suppresses all trigger-based constraint checking, foreign keys included, for the session — it is not a per-table `DISABLE TRIGGER`. It requires superuser (or an equivalent grant); on a locked-down role the transfer will fail at the disable step rather than silently proceeding unprotected.

MSSQL's re-enable uses `WITH CHECK CHECK`, not a bare `CHECK` — the extra `WITH CHECK` re-validates the rows inserted while the constraint was off, so the constraint comes back trusted instead of merely enabled.

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
| Simple (native JSON values) | `string`, `int`, `bigint`, `float`, `decimal`, `bool`, `timestamp`, `date`, `uuid` |
| Encoded (`[value, encoding]` tuples) | `json`, `binary`, `vector`, `array`, `text`, `custom` |

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

- Key derivation: PBKDF2-SHA256, 100,000 iterations, 32-byte random salt, 32-byte key
- Cipher: AES-256-GCM, 16-byte random IV, 16-byte auth tag
- Format: `{ salt, iv, authTag, ciphertext }` (all base64)
- Minimum passphrase length: 12 characters, enforced on **encryption only** — a floor on decryption would brick archives written by older versions, and a wrong passphrase already fails at the GCM tag

The encryption is self-contained—no dependency on noorm's identity system. Files can be shared and decrypted anywhere with the passphrase.

### Decompression bounds

`.dt` content is untrusted — it arrives from a colleague, a bucket, or a CI artifact — and gzip reaches roughly 1000:1 on repetitive input. The reader caps expansion rather than discovering the problem as an OOM:

| Limit | Value | Applies to |
|-------|-------|------------|
| `MAX_DECOMPRESSED_VALUE_BYTES` | 64 MB | A single gzipped column value |
| `MAX_DECOMPRESSED_ARCHIVE_BYTES` | 1 GB | A whole `.dtzx` archive — it is decrypted and inflated before any row is read, so the entire thing is resident |
| `MAX_ROW_BYTES` | 256 MB | One line in a `.dt` stream — readline buffers until it finds a newline, so a file with no newlines is the same exhaustion vector by another route |

`.dt` and `.dtz` stream, so only the per-value and per-line caps apply to them.

### Template Loader Integration

`.dt` and `.dtz` files work as seed data in templates. There is no `load()` helper — the file is auto-loaded by filename into the `$` context like any other data file, as an array of row objects:

```
seeds/
├── users.sql.tmpl
└── users.dt        → $.users
```

```sql
-- seeds/users.sql.tmpl
{% for (const row of $.users) { %}
INSERT INTO users (id, email) VALUES ({%~ row.id %}, {%~ $.quote(row.email) %});
{% } %}
```

The loader reads the schema header for column names and maps each row's positional values to named fields, so `$.users[0].email` works without you naming the columns.

Note: `.dtzx` files are not supported in templates—there's no secure way to provide the passphrase.


## Dialect Operations

Each dialect implements the `TransferDialectOperations` interface:

```typescript
interface TransferDialectOperations {

    /** Session-level SQL to disable FK checks (PG/MySQL; MSSQL works per table) */
    getDisableFKSql(): string

    /** Session-level SQL to re-enable FK checks */
    getEnableFKSql(): string

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
| `transfer:complete` | `{ status, totalRows, tableCount, durationMs, fkChecksRestored }` | Transfer finished |

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

`dt:import:schema` reports `columns` as a **count**, not the column list.

### Worker Pipeline Events

Export and import run through the three-tier worker pipeline (connection worker → compute pool → order buffer), which emits its own per-stage counters:

| Event | Payload | When |
|-------|---------|------|
| `dt:export:loaded` | `{ table, loaded, totalRows }` | A batch arrived from the connection worker |
| `dt:export:processed` | `{ table, processed, totalRows }` | A compute worker finished serializing rows |
| `dt:export:saved` | `{ table, saved, totalRows }` | The order buffer flushed consecutive rows to `DtWriter` |
| `dt:import:loaded` | `{ table, loaded, totalRows }` | A batch of lines was read by `DtReader` |
| `dt:import:processed` | `{ table, processed, totalRows }` | A compute worker finished deserializing rows |
| `dt:import:saved` | `{ table, saved, totalRows }` | Deserialized rows were inserted |

### Modify Events

| Event | Payload | When |
|-------|---------|------|
| `dt:modify:start` | `{ inputPath, outputPath, recipeLength }` | Modify begins |
| `dt:modify:progress` | `{ rowsRead, rowsWritten, rowsFiltered }` | After each row |
| `dt:modify:complete` | `{ result }` | Modify finished |

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

Access via: Home → `d` (database) → select config → `r` (transfer)

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

# Export every table to a directory (compressed) — --tables defaults to all
noorm db transfer --export ./backup/ --compress

# Export multiple named tables to a directory
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

`--tables` defaults to every user table. Passing it *explicitly empty* is an error rather than a no-op — an export that wrote nothing, reported success, and exited 0 is a silent empty backup.

The `--export` path is interpreted based on how many tables resolve:

| Scenario | Path | Result |
|----------|------|--------|
| Single table | `./data/users.dt` | Writes to that exact path |
| Single table | `./data/users` | Appends the flag-derived extension |
| Multiple tables | `./data/backup/` | Creates `<table><ext>` per table |

An explicit `.dt` / `.dtz` / `.dtzx` suffix is honoured only in the single-table case. In multi-table mode the extension always comes from the flags:

| Flags | Output Extension |
|-------|------------------|
| (none) | `.dt` |
| `--compress` | `.dtz` |
| `--passphrase` | `.dtzx` |

Exporting to `.dtzx` without `--passphrase` prompts for one (masked, minimum 12 characters). In a non-TTY session or with `--json`, the prompt is impossible and the command exits with a usage error instead — pass `--passphrase` in CI.


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
├── modify.ts           # modifyDtFile(), transformSchema(), validateRecipe()
├── paging.ts           # Paged row reads for large files
├── paths.ts            # resolveExportPath(), resolveExportExtension(), resolveExportTables()
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

4. **No same-server path on PostgreSQL** — PostgreSQL cannot query across databases without `dblink` / `postgres_fdw`, and pointing both configs at the *same* database would make the direct statement copy a table into itself. Every PostgreSQL transfer therefore uses the batched path, even between two databases on one server.

5. **Type conversion fidelity** — Cross-dialect transfers convert through universal types. Some dialect-specific features may be lost (e.g., PostgreSQL arrays become JSON in MySQL, custom types become strings). The schema validation warns about potential issues before transfer begins.

6. **No .dtzx in templates** — Encrypted `.dtzx` files cannot be used as seed data in templates because there's no secure way to provide the passphrase in the template context.
