# Data Transfer


Move data between databases using your existing noorm configs. Source and destination must use the same dialect. Tables are transferred in foreign key order so referential integrity is maintained.


## When You Need This

You have a staging database full of test data that you want to push to a fresh QA environment. Or you need to seed a local dev database from a shared development server. Or you're migrating data between two production instances.

The databases share the same schema—same tables, same columns. You need the data moved, not the structure.


## Supported Dialects

| Dialect | Supported | Same-server optimization |
|---------|-----------|--------------------------|
| PostgreSQL | Yes | Only within same database |
| MySQL | Yes | Yes (cross-database on same host) |
| MSSQL | Yes | Yes (cross-database on same host) |
| SQLite | No | — |

Same-server optimization uses direct `INSERT...SELECT` SQL instead of reading data into the application and writing it back. Significantly faster for large datasets.


## Interactive Mode

From the home screen:

1. Press `d` to enter the database menu
2. Select a config
3. Choose the transfer option
4. Walk through the wizard:
   - Pick source and destination configs
   - Select tables (all or specific)
   - Choose a conflict strategy
   - Review the plan
   - Execute

The TUI shows live progress per table with row counts and batch completion.


## Headless Mode

The `--to` flag is required. Source defaults to the active config.

```bash
# Transfer all tables from active config to backup
noorm -H db transfer --to backup

# Specify source explicitly
noorm -H db transfer staging --to production

# Transfer specific tables only
noorm -H db transfer --to backup --tables users,posts,comments
```

### Dry Run

Preview what will happen without transferring anything:

```bash
noorm -H db transfer --to backup --dry-run
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
noorm -H db transfer --to backup --on-conflict fail

# Skip rows that already exist
noorm -H db transfer --to backup --on-conflict skip

# Update existing rows with source data
noorm -H db transfer --to backup --on-conflict update

# Delete and re-insert conflicting rows
noorm -H db transfer --to backup --on-conflict replace
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
noorm -H db transfer --to backup --batch-size 5000

# Clear destination tables before transfer
noorm -H db transfer --to backup --truncate

# Don't disable foreign key checks (risky for dependent tables)
noorm -H db transfer --to backup --no-fk

# Don't preserve identity/auto-increment values
noorm -H db transfer --to backup --no-identity
```

### JSON Output

```bash
noorm -H --json db transfer --to backup
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
    "durationMs": 1234
}
```

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

1. **Planning** — noorm reads the source schema, builds a foreign key dependency graph, and sorts tables so parents are transferred before children.

2. **FK checks disabled** — Foreign key constraints are temporarily disabled on the destination to avoid ordering issues within batches.

3. **Truncate (optional)** — If `--truncate` is set, destination tables are cleared first. PostgreSQL uses `TRUNCATE ... CASCADE`, MSSQL uses `DELETE` (can't truncate with FKs), MySQL uses standard `TRUNCATE`.

4. **Data transfer** — Each table is transferred in order. Same-server uses direct SQL. Cross-server reads batches from source and writes them to destination.

5. **Identity handling** — Identity/auto-increment values from the source are preserved by default. Sequences are reset after transfer to continue from the max value.

6. **FK checks re-enabled** — Constraints are turned back on.


## Requirements

- Both databases must use the **same dialect** (both PostgreSQL, both MySQL, or both MSSQL)
- Destination tables must **already exist** with matching column structure
- The noorm project must have configs for both source and destination databases


## Common Patterns

### Seed a dev database from staging

```bash
noorm -H db transfer staging --to local --truncate
```

Clears the local database first, then copies everything from staging.

### Incremental sync with skip

```bash
noorm -H db transfer --to backup --on-conflict skip
```

Only inserts rows that don't already exist in backup. Existing rows are left untouched.

### Upsert from source of truth

```bash
noorm -H db transfer --to target --on-conflict update
```

Updates all existing rows with the latest data from source, inserts new rows.

### Transfer specific tables

```bash
noorm -H db transfer --to backup --tables users,user_preferences
```

Only transfers the specified tables. FK dependencies between selected tables are still respected.

### CI/CD test data setup

```bash
noorm -H --json db transfer staging --to ci-test --truncate --on-conflict fail
```

Clean transfer for test environments. JSON output for pipeline integration. Fails fast if anything goes wrong.
