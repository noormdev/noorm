# Concepts


This page explains how noorm thinks about your database. Understanding these concepts makes everything else click.


## Files, Not Migrations

Most migration tools work like this: you write numbered migration files (`001_create_users.sql`, `002_add_email.sql`), and the tool runs them in order, once.

noorm works differently. You write your schema as it should be *right now*, and noorm figures out what changed.

```
sql/
├── tables/
│   ├── users.sql        # CREATE TABLE users...
│   └── posts.sql        # CREATE TABLE posts...
└── views/
    └── recent_posts.sql # CREATE VIEW recent_posts...
```

When you run `noorm run build`:

1. noorm scans your schema directory
2. For each file, it computes a checksum
3. If the checksum differs from last run, the file executes
4. The new checksum is stored

This means you can **edit your schema files directly**. Change a column type? Edit the file and run build. noorm handles the rest.

::: tip When to Use Changes
Files are for your schema definition (CREATE TABLE, CREATE VIEW, etc.). Use [changes](/guide/migrations/changes) when you need ordered, one-time migrations with rollback support—like data migrations or complex schema transitions.
:::


## Configs

A **config** is a saved database connection. You can have multiple configs for different environments:

- `dev` - Your local database
- `test` - Test database (gets wiped between runs)
- `staging` - Staging server
- `prod` - Production (protected)

```
┌─ Configs ─────────────────────────────┐
│  • dev        sqlite   ./data/dev.db  │
│    staging    postgres db.staging.com │
│    prod       postgres db.prod.com    │
└───────────────────────────────────────┘
```

The dot (•) shows which config is active. All commands use the active config unless you specify otherwise.

Switch configs:
```bash
noorm config use staging
```

Or specify per-command:
```bash
noorm -c prod run build
```


## Protected Configs

Some configs are marked as **protected**. This prevents accidental destructive operations:

- `db teardown` - Blocked on protected configs
- `db truncate` - Requires confirmation
- Accidental `DROP TABLE` - Still executes (be careful!)

Protection is a safety net, not a security boundary. It catches mistakes like running teardown against the wrong database.


## Secrets

Secrets are values you don't want in your config files:

- Database passwords
- API keys
- Connection strings

noorm stores secrets encrypted in your local state. They're never written to disk in plain text.

```bash
# Set a secret for the current config
noorm secret:set DB_PASSWORD

# Use in templates
<%= $.secrets.DB_PASSWORD %>
```

Secrets are **config-scoped**. Each config has its own set of secrets. There are also **global secrets** shared across all configs.


## State

noorm maintains local state in `.noorm/state.enc`:

- Your saved configs
- Secrets (encrypted)
- Your identity

This file is encrypted with a key derived from your machine. It's not portable between machines by design—each developer has their own configs and secrets.

::: warning Don't Commit state.enc
Add `.noorm/state.enc` to `.gitignore`. It contains machine-specific encrypted data that won't work on other machines anyway.
:::


## Settings

Settings live in `.noorm/settings.yml` and **should be committed**. They define project-wide behavior:

- Schema and changes directory paths
- Build include/exclude patterns
- Stage definitions
- Secret requirements

```yaml
# .noorm/settings.yml
paths:
  sql: ./sql
  changes: ./changes

build:
  include:
    - "**/*.sql"
  exclude:
    - "**/*.draft.sql"

stages:
  prod:
    protected: true
    secrets:
      - key: DB_PASSWORD
        required: true
```


## Stages

A **stage** is a template for configs. When you create a config and assign it to a stage, it inherits the stage's defaults:

```yaml
stages:
  development:
    dialect: sqlite
    isTest: false

  production:
    dialect: postgres
    protected: true
    secrets:
      - key: DB_PASSWORD
        required: true
```

Now when you create a config with stage `production`, it's automatically protected and requires a `DB_PASSWORD` secret.


## Changes vs Files

noorm has two ways to execute SQL:

| Aspect | Schema Files | Changes |
|--------|--------------|---------|
| Location | `sql/` | `changes/` |
| When to use | Schema definition | One-time migrations |
| Re-runs | Yes, when file changes | No, runs once |
| Rollback | No | Yes, with revert scripts |
| Order | Alphabetical by path | By date prefix |

**Schema files** are your source of truth. Edit them, run build, changes apply.

**Changes** are versioned migrations for things that need to run exactly once:

```
changes/
└── 2024-01-15-add-user-roles/
    ├── change/
    │   └── 001_add_role_column.sql
    └── revert/
        └── 001_remove_role_column.sql
```


## The Database Table

noorm creates a table in your database to track execution:

```sql
CREATE TABLE __noorm__ (
    id INTEGER PRIMARY KEY,
    type TEXT,           -- 'file' or 'change'
    path TEXT,           -- File path or change name
    checksum TEXT,       -- SHA-256 hash
    executed_at TEXT,    -- Timestamp
    executed_by TEXT,    -- Identity
    duration_ms INTEGER  -- Execution time
);
```

This is how noorm knows what ran. Don't delete or modify this table manually.


## What's Next?

- [TUI Quick Reference](/tui) - Navigate the terminal interface
- [SQL Templates](/guide/sql-files/templates) - Dynamic SQL generation
- [Changes Guide](/guide/migrations/changes) - Versioned migrations
