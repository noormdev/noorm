# Data Transfer


Move data between databases using your existing noorm configs. Tables are transferred in foreign key order so referential integrity is maintained. Cross-dialect transfers (e.g., PostgreSQL to MySQL) are supported with automatic type conversion.


## When You Need This

You have a staging database full of test data that you want to push to a fresh QA environment. Or you need to seed a local dev database from a shared development server. Or you're migrating data between two production instances.

The databases share the same schema—same tables, same columns. You need the data moved, not the structure.


## Supported Dialects

| Dialect | Supported | Same-server optimization | Cross-dialect |
|---------|-----------|--------------------------|---------------|
| PostgreSQL | Yes | No | Yes |
| MySQL | Yes | Yes (cross-database on same host) | Yes |
| MSSQL | Yes | Yes (cross-database on same host) | Yes |
| SQLite | No | — | — |

Same-server optimization uses direct `INSERT...SELECT` SQL instead of reading data into the application and writing it back. Faster for large datasets.

PostgreSQL never takes that path. Without `dblink` or `postgres_fdw` it cannot reach another database, and when both configs name the same database the statement degenerates into copying a table into itself. PostgreSQL transfers always run through the batch path instead.

Cross-dialect transfers convert data types automatically through a universal type system. Most common types map cleanly; some dialect-specific features (like PostgreSQL arrays) become JSON in dialects that don't support them natively.


## Interactive Mode

From the home screen:

1. Press `d` to enter the database menu
2. Select a config
3. Choose the transfer option
4. Walk through the wizard:
   - Pick destination (another config, export to file, or import from file)
   - Select tables (all or specific)
   - Choose a conflict strategy
   - Review the plan
   - Execute

The TUI shows live progress per table with row counts and batch completion.

**Export/Import options** appear in the destination selection list:
- "Export to .dt file" — saves data to portable files
- "Import from .dt file" — loads data from previously exported files


## Headless Mode

Exactly one of `--to`, `--export`, or `--import` is required; they are mutually exclusive. The source is the active config unless `-c` names another.

```bash
# Transfer all tables from active config to backup
noorm db transfer --to backup

# Specify source explicitly with -c
noorm db transfer -c staging --to production

# Transfer specific tables only
noorm db transfer --to backup --tables users,posts,comments
```

There is no positional source argument. `noorm db transfer staging --to production` does not name `staging` as the source; use `-c staging` (or `--config staging`).

### Dry Run

Preview what will happen without transferring anything:

```bash
noorm db transfer --to backup --dry-run
```

Output shows:
- Whether same-server optimization applies
- Table count and estimated row counts
- Transfer order (FK dependency sorted)
- Warnings (missing destination tables, etc.)

### Conflict Strategies

When destination tables already contain data with matching primary keys:

```bash
# Abort on first conflict (default)
noorm db transfer --to backup --on-conflict fail

# Skip rows that already exist
noorm db transfer --to backup --on-conflict skip

# Update existing rows with source data
noorm db transfer --to backup --on-conflict update

# Delete and re-insert conflicting rows
noorm db transfer --to backup --on-conflict replace
```

| Strategy | What happens |
|----------|-------------|
| `fail` | Stops transfer on first primary key conflict |
| `skip` | Leaves existing rows untouched, inserts new ones |
| `update` | Overwrites non-PK columns on existing rows |
| `replace` | Removes conflicting rows entirely, inserts fresh copies |

### Options

```bash
# Set batch size for cross-server transfers (default: 1000)
noorm db transfer --to backup --batch-size 5000

# Clear destination tables before transfer
noorm db transfer --to backup --truncate

# Don't disable foreign key checks (risky for dependent tables)
noorm db transfer --to backup --no-fk

# Don't preserve identity/auto-increment values
noorm db transfer --to backup --no-identity
```

### JSON Output

```bash
noorm db transfer --to backup --json
```

Transfer result:

```json
{
    "success": true,
    "status": "success",
    "tables": [
        {
            "table": "users",
            "status": "success",
            "rowsTransferred": 1500,
            "rowsSkipped": 0,
            "durationMs": 234
        }
    ],
    "totalRows": 1500,
    "durationMs": 1234,
    "fkChecksRestored": true
}
```

Check `fkChecksRestored`. When it is `false`, the transfer finished but foreign key enforcement could not be turned back on at the destination, and referential integrity is still disabled there until you re-enable it by hand. The CLI also writes a warning to stderr in that case.

Dry run result:

```json
{
    "success": true,
    "dryRun": true,
    "sameServer": false,
    "tableCount": 5,
    "estimatedRows": 10000,
    "tables": [
        {
            "name": "users",
            "rowCount": 1000,
            "hasIdentity": true,
            "dependsOn": []
        }
    ],
    "warnings": []
}
```


## What Happens During a Transfer

1. **Planning** — noorm reads the source schema, builds a foreign key dependency graph, and sorts tables so parents are transferred before children. A circular foreign key relationship cannot be sorted, so noorm falls back to the source's own table order and records a warning in the plan.

2. **FK checks disabled** — Foreign key constraints are temporarily disabled on the destination to avoid ordering issues within batches.

3. **Truncate (optional)** — If `--truncate` is set, destination tables are cleared first. PostgreSQL uses `TRUNCATE ... CASCADE`, MSSQL uses `DELETE` (can't truncate with FKs), MySQL uses standard `TRUNCATE`.

4. **Data transfer** — Each table is transferred in order. Same-server uses direct SQL. Cross-server reads batches from source and writes them to destination.

5. **Identity handling** — Identity/auto-increment values from the source are preserved by default. Sequences are reset after transfer to continue from the max value.

6. **FK checks re-enabled** — Constraints are turned back on.


## Requirements

- Destination tables must **already exist** with compatible column structure
- The noorm project must have configs for both source and destination databases
- The destination config's access role must permit `db:reset`: `viewer` is denied, `operator` and `admin` may write. From the SDK, an `operator` destination needs `yes: true` on the context (or `NOORM_YES=1`), since there is no prompt to answer
- For cross-dialect transfers, column types must be convertible (most are; check the dry-run output for warnings)

noorm's own tracking tables are never transferred. They are filtered out of the plan on both ends.


## Common Patterns

### Seed a dev database from staging

```bash
noorm db transfer -c staging --to local --truncate
```

Clears the local database first, then copies everything from staging.

### Incremental sync with skip

```bash
noorm db transfer --to backup --on-conflict skip
```

Only inserts rows that don't already exist in backup. Existing rows are left untouched.

### Upsert from source of truth

```bash
noorm db transfer --to target --on-conflict update
```

Updates all existing rows with the latest data from source, inserts new rows.

### Transfer specific tables

```bash
noorm db transfer --to backup --tables users,user_preferences
```

Only transfers the specified tables. FK dependencies between selected tables are still respected.

### CI/CD test data setup

```bash
noorm db transfer -c staging --to ci-test --truncate --on-conflict fail --json
```

Clean transfer for test environments. JSON output for pipeline integration. Fails fast if anything goes wrong.

### Cross-dialect migration

```bash
noorm db transfer -c postgres-legacy --to mysql-new --dry-run
noorm db transfer -c postgres-legacy --to mysql-new
```

Migrate from PostgreSQL to MySQL. Run `--dry-run` first to check for type conversion warnings.


## File Export/Import

Export data to portable `.dt` files for backup, sharing, or migration without a live destination database.

### File Formats

| Extension | Description |
|-----------|-------------|
| `.dt` | Line-delimited JSON5, uncompressed and human-readable |
| `.dtz` | The same content, gzipped |
| `.dtzx` | Gzipped and AES-256-GCM encrypted (requires passphrase) |

`.dt` and `.dtz` stream row by row on import. `.dtzx` is decrypted and inflated whole before the first row is read, so it carries a size ceiling the other two do not.

### Export to Files

`--tables` defaults to every table in the source. Pass it to narrow the export.

```bash
# Export every table to a directory
noorm db transfer --export ./backup/

# Export single table
noorm db transfer --export ./backup/users.dt --tables users

# Export multiple tables to a directory
noorm db transfer --export ./backup/ --tables users,posts,comments

# Export compressed
noorm db transfer --export ./backup/ --tables users,posts --compress

# Export encrypted (implies compression)
noorm db transfer --export ./backup/ --tables users --passphrase "my-secret"
```

An export that would write nothing is an error, not a silent success: both an empty `--tables` list and a source with no tables fail rather than leaving you with an empty backup you believe is good.

On an interactive terminal, omitting `--passphrase` for a `.dtzx` path prompts for it with masked input, which keeps the secret out of your shell history. Non-interactive runs need the flag.

**Path rules:**
- Single table → path is the output file, with the extension appended if missing
- Multiple tables → path is a directory, noorm creates `<table>.dt` per table

### Import from Files

```bash
# Import from .dt file
noorm db transfer --import ./backup/users.dt

# Import with upsert
noorm db transfer --import ./backup/users.dtz --on-conflict update

# Import encrypted file
noorm db transfer --import ./backup.dtzx --passphrase "my-secret"

# Validate schema compatibility only
noorm db transfer --import ./backup/users.dt --dry-run
```

### Export/Import JSON Output

Export result (single table):

```json
{
    "success": true,
    "mode": "export",
    "filepath": "./backup/users.dt",
    "tables": [
        { "table": "users", "filepath": "./backup/users.dt", "rowsExported": 1500, "bytesWritten": 45230 }
    ],
    "totalRows": 1500,
    "totalBytes": 45230
}
```

Export result (multiple tables):

```json
{
    "success": true,
    "mode": "export",
    "directory": "./backup/",
    "tables": [
        { "table": "users", "filepath": "./backup/users.dt", "rowsExported": 1500, "bytesWritten": 45230 },
        { "table": "posts", "filepath": "./backup/posts.dt", "rowsExported": 800, "bytesWritten": 23100 }
    ],
    "totalRows": 2300,
    "totalBytes": 68330
}
```

Import result:

```json
{
    "success": true,
    "mode": "import",
    "filepath": "./backup/users.dt",
    "rowsImported": 1500,
    "rowsSkipped": 0
}
```

### Common Export/Import Patterns

**Backup specific tables before risky operation:**

```bash
noorm db transfer --export ./pre-migration-backup/ --tables users,orders --compress
# ... run migration ...
# If something goes wrong:
noorm db transfer --import ./pre-migration-backup/users.dt --truncate
noorm db transfer --import ./pre-migration-backup/orders.dt --truncate
```

**Share test data with team:**

```bash
# Export encrypted for sharing
noorm db transfer --export ./fixtures.dtzx --passphrase "team-secret" --tables users,posts

# Teammate imports
noorm db transfer --import ./fixtures.dtzx --passphrase "team-secret"
```

**Cross-dialect migration via file:**

```bash
# Export from PostgreSQL
noorm use postgres-source
noorm db transfer --export ./migration-data/ --tables users,posts

# Import into MySQL
noorm use mysql-target
noorm db transfer --import ./migration-data/users.dt
noorm db transfer --import ./migration-data/posts.dt
```
