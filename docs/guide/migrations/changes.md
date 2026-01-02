# Changes


Changes are versioned migrations for one-time database operations. When you need to add a column, migrate data, or run SQL that should execute exactly once with rollback support, changes are the answer.


## When to Use Changes

noorm has two ways to run SQL. Knowing when to use each saves headaches.

**Schema files** are your database definition. You edit them directly, and noorm re-runs them when they change. Great for `CREATE TABLE`, `CREATE VIEW`, and anything you want to keep in sync.

**Changes** are for one-time operations:

- Adding a column to an existing table
- Migrating data between tables
- Creating indexes on production data
- Complex schema transitions with rollback

| Aspect | Schema Files | Changes |
|--------|--------------|---------|
| Location | `sql/` | `changes/` |
| Runs | Every time the file changes | Once, then tracked |
| Rollback | No | Yes, with revert scripts |
| Order | Alphabetical by path | By date prefix |

Think of schema files as "what the database looks like" and changes as "how to get there safely."


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

**change/** contains your forward migration scripts. These run in sequence order when you apply the change.

**revert/** contains rollback scripts. These run in *reverse* sequence order when you revert. Notice how `002` runs before `001` during revert---you undo changes in the opposite order you made them.

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


## File Types

Changes support three file types:

### SQL Files (.sql)

Raw SQL executed directly. The most common type.

```sql
-- 001_add-verification-column.sql
ALTER TABLE users ADD COLUMN email_verified BOOLEAN DEFAULT FALSE;
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

```txt
# 001_schema-refs.txt
# Reference existing files instead of copying
tables/verification_tokens.sql
functions/generate_token.sql
```

This is powerful for changes that need to re-run existing schema definitions. Instead of copying SQL, point to the source of truth.


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

This runs the scripts in `revert/` in reverse order. The change status becomes `reverted`, which means it will run again on the next fast-forward.


### Rewind Multiple Changes

Revert the last N applied changes:

```bash
noorm -H change rewind 3
```

This reverts the three most recently applied changes in reverse order.


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

**Use manifests for shared SQL.** Reference existing schema files with `.txt` manifests instead of duplicating SQL.

**Preview before production.** Use `--preview` or `--dry-run` to inspect exactly what will execute.

**Write meaningful changelog.md files.** Explain *why* the change exists, not just what it does. Future debugging sessions will benefit.


## What's Next?

- [Forward & Revert](/guide/migrations/forward-revert) - Applying and rolling back changes
- [History](/guide/migrations/history) - Tracking execution history
- [Templates](/guide/sql-files/templates) - Using `.sql.tmpl` files in changes
