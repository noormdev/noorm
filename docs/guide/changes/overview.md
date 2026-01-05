# Changes


Changes are versioned operations that evolve an existing database to match your ideal schema. When you need to add a column, transform data, or run SQL that should execute exactly once with rollback support, changes are the answer.


## Why "Changes", Not "Migrations"

Most tools call these migrations. We don't, and here's why.

**Your SQL files are the source of truth.** They define what your schema *is*—the ideal, current state. You handcraft them, review them, keep them up to date. When you need a fresh database, you run your SQL files. No archaeology through years of migration history.

**Changes describe what you *do*, not what you *move*.** To migrate implies moving something from one place to another. Data migrations traditionally mean moving data between servers, warehouses, or systems. But when you add a column to an existing table, you're not migrating anything—you're changing the schema.

Some argue that you *are* moving data—adding a column means moving data into it, splitting `full_name` into `first_name` and `last_name` is moving data between columns, or you're "moving the schema from one version to the next." This is mental gymnastics. It's stretching a word to fit a process it was never meant to describe.

The term "migration" originated in enterprise contexts where it actually made sense—incrementally moving schemas and data from Oracle to SQL Server, or consolidating legacy systems into a new platform. Rails borrowed this terminology in 2005 and popularized it for web applications. Everyone followed suit without questioning whether the word fit. We're not moving databases between systems. We're changing them in place. The language matters.

**Kysely already has migrations.** If you want a traditional migration system, Kysely has one built in. But it lacks what noorm provides:

- **Identity tracking** - Who ran what, and when?
- **Flexible workflows** - Build from scratch *or* apply changes, your choice
- **Templates and secrets** - Dynamic SQL with encrypted credentials
- **Execution history** - Full audit trail with timing and checksums
- **Revert scripts** - Rollback support when things go wrong

Changes are your changelog. They document *how* to get an existing database to match your SQL files. Your SQL files remain the source of truth.


## When to Use Changes

The distinction is simple: **can you rebuild from scratch, or do you need to evolve what's there?**

**Fresh database?** Run `noorm run build`. This executes your `sql/` folder—your source of truth. Tables, views, functions, seed data. Everything needed to create a working schema from nothing.

**Existing database with data you can't lose?** Run `noorm change ff`. This applies pending changes from your `changes/` folder. Each change runs once, gets recorded in the database, and won't run again unless reverted.

Changes exist because production databases can't be rebuilt. You can't drop a table with millions of rows and recreate it. You need to `ALTER TABLE` in place, transform data carefully, add indexes without blocking writes. Changes give you:

- **Execution tracking** - Know which changes have been applied
- **Revert scripts** - Roll back when something goes wrong
- **Ordered execution** - Date prefixes ensure consistent ordering across teams


## Directory Structure

Each change lives in its own folder with a specific structure:

```
changes/
└── 2025-01-15-add-email-verification/
    ├── change/                    # Forward scripts (required)
    │   ├── 001_create-tokens-table.sql
    │   └── 002_add-user-column.sql
    ├── revert/                    # Rollback scripts (optional)
    │   ├── 001_drop-user-column.sql
    │   └── 002_drop-tokens-table.sql
    └── changelog.md               # Human-readable description
```

**change/** contains your forward scripts. These run in sequence order when you apply the change.

**revert/** contains rollback scripts. These run in forward sequence order (001, then 002), just like change scripts. You design them to undo your changes in reverse—notice how `001_drop-user-column` undoes the last change and `002_drop-tokens-table` undoes the first.

**changelog.md** is optional but recommended. Document what the change does and why. Your future self will thank you.


## Naming Conventions

Change folders follow the pattern `YYYY-MM-DD-description`:

```
2025-01-15-add-email-verification
2025-02-01-migrate-user-roles
2025-02-14-add-search-indexes
```

The date prefix ensures changes apply in chronological order across your team. When Alice creates `2025-01-15-add-users` and Bob creates `2025-01-16-add-posts`, they'll apply in the right order regardless of when they merge.

Files within `change/` and `revert/` use sequence prefixes:

```
001_create-table.sql
002_add-column.sql
003_update-data.sql
```

The three-digit prefix guarantees execution order. Names after the underscore are for humans.


## Creating a Change

From the TUI, navigate to changes (press `g` from home) and select add (`a`). noorm creates the folder structure for you.

In headless mode:

```bash
noorm -H change add add-email-verification
```

This creates:

```
changes/2025-01-15-add-email-verification/
├── change/
├── revert/
└── changelog.md
```

Now add your SQL files to `change/`. If you want rollback support, add corresponding scripts to `revert/`.


## Write Idempotent DDL

Always check for existence before making changes. Use `IF NOT EXISTS` when creating, `IF EXISTS` when dropping. This protects you when:

- A change accidentally runs twice
- Someone executes the file directly outside of noorm
- You need to re-run after a partial failure

```sql
-- change/001_add-verification-column.sql (forward)
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;

-- revert/001_drop-verification-column.sql (rollback)
ALTER TABLE users DROP COLUMN IF EXISTS email_verified;
```

```sql
-- change/001_create-tokens-table.sql (forward)
CREATE TABLE IF NOT EXISTS verification_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER REFERENCES users(id),
    token TEXT NOT NULL,
    expires_at TIMESTAMP NOT NULL
);

-- revert/001_drop-tokens-table.sql (rollback)
DROP TABLE IF EXISTS verification_tokens;
```

This applies to both forward and revert scripts. A revert that fails because "column doesn't exist" is just as broken as a change that fails because "column already exists."


## File Types

Changes support three file types:

### SQL Files (.sql)

Raw SQL executed directly. The most common type.

```sql
-- 001_add-verification-column.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE;
```

### Templates (.sql.tmpl)

Dynamic SQL processed through the Eta template engine before execution. Useful when you need conditional logic or variable substitution. See [Templates](/guide/sql-files/templates) for full syntax reference.

```sql
-- 001_add-audit-table.sql.tmpl
CREATE TABLE {%~ $.config.schema %}.audit_log (
    id SERIAL PRIMARY KEY,
    action TEXT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

### Manifests (.txt)

Reference existing schema files instead of duplicating SQL. The manifest lists paths relative to your schema directory.

Many database objects use `CREATE OR REPLACE`—views, functions, procedures, triggers. They're already idempotent. When you change a table, you often need to recreate dependent views or functions. Instead of copying that SQL into your change folder, reference the source of truth:

```txt
# change/001_rebuild-views.txt
views/user_summary.sql
views/active_users.sql
functions/get_user_stats.sql
```

```sql
-- change/002_add-status-column.sql
ALTER TABLE users ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'active';
```

Manifest files participate in ordering. Here, `001_rebuild-views.txt` runs first (recreating views that might depend on the old schema), then `002_add-status-column.sql` adds the column. You could also flip this—add the column first with `001_`, then rebuild views with `002_` so they pick up the new column.

This keeps your `sql/` folder as the single source of truth. Views and functions are defined once, referenced wherever needed.


## Checking Change Status

From the TUI, the changes screen shows status for each change:

```
┌─ Changes ─────────────────────────────────────────────┐
│  • 2025-01-15-add-email-verification    success       │
│    2025-02-01-migrate-user-roles        pending       │
│    2025-02-14-add-search-indexes        pending       │
└───────────────────────────────────────────────────────┘
```

Each change has a status:

| Status | Meaning |
|--------|---------|
| `pending` | Not yet applied |
| `success` | Applied successfully |
| `failed` | Last execution failed |
| `reverted` | Was applied, then rolled back |

In headless mode:

```bash
noorm -H change list
```

```json
{
    "changes": [
        { "name": "2025-01-15-add-email-verification", "status": "success" },
        { "name": "2025-02-01-migrate-user-roles", "status": "pending" }
    ]
}
```


## Common Workflows


### Apply a Single Change

Run a specific change by name:

```bash
noorm -H change run 2025-02-01-migrate-user-roles
```

From the TUI, select the change and press enter.


### Apply All Pending Changes

Fast-forward applies all pending changes in order:

```bash
noorm -H change ff
```

This is what you typically run in CI/CD after deployment.


### Apply the Next Pending Change

Run just the next change in sequence:

```bash
noorm -H change next
```

Useful when you want to apply changes one at a time and verify each.


### Revert a Change

Roll back a previously applied change:

```bash
noorm -H change revert 2025-02-01-migrate-user-roles
```

This runs the scripts in `revert/` in sequence order. The change status becomes `reverted`, which means it will run again on the next fast-forward.


### Rewind Multiple Changes

Revert the last N applied changes:

```bash
noorm -H change rewind 3
```

This reverts the three most recently applied changes, starting with the newest.


### Preview Before Running

See what SQL will execute without running it:

```bash
noorm -H change run 2025-02-01-migrate-user-roles --preview
```

For templates, this shows the rendered SQL. Use this before running against production.


### Dry Run

Render files to a temporary directory without executing:

```bash
noorm -H change run 2025-02-01-migrate-user-roles --dry-run
```

Files are written to `tmp/` so you can inspect them.


## When Changes Re-Run

noorm tracks whether each change needs to run based on several conditions:

| Condition | What Happens |
|-----------|--------------|
| New change folder | Runs |
| Files modified since last run | Runs |
| Previous execution failed | Runs |
| Change was reverted | Runs |
| Database was torn down | Runs (marked stale) |
| `--force` flag provided | Runs |
| Successfully applied, unchanged | Skipped |

After a successful run, the change won't run again unless something changes. This is tracked via checksums of all files in `change/` or `revert/`.

::: tip Force Re-Run
Need to re-apply a change? Use `--force`:
```bash
noorm -H change run my-change --force
```
:::


## Best Practices

**One logical change per folder.** Don't bundle unrelated changes. If you're adding users and adding products, make two separate changes.

**Always include revert scripts.** Even if you think you'll never need them. Recovery is worth the extra files.

**Test reverts in development.** Run `revert` then `change` to verify rollback works before deploying.

**Verify with explore and terminal.** noorm includes a database explorer (`d` → `e` from home) and SQL terminal (`d` → `t`) so you can inspect your schema and query data without leaving the tool. After applying a change, explore the table to confirm the column exists. After reverting, run a quick SELECT to verify it's gone. Don't trust—verify.

**Use manifests for shared SQL.** Reference existing schema files with `.txt` manifests instead of duplicating SQL.

**Preview before production.** Use `--preview` or `--dry-run` to inspect exactly what will execute.

**Write meaningful changelog.md files.** Explain *why* the change exists, not just what it does. Future debugging sessions will benefit.


## What's Next?

- [Forward & Revert](/guide/changes/forward-revert) - Applying and rolling back changes
- [History](/guide/changes/history) - Tracking execution history
- [Templates](/guide/sql-files/templates) - Using `.sql.tmpl` files in changes
