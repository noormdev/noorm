# Concepts


This page explains how noorm thinks about your database. Understanding these concepts makes everything else click.


## SQL Files Are Your Source of Truth

Your SQL files define what your schema **is**. They represent the ideal, current state of your database structure.

```
sql/
├── 01_tables/
│   ├── 001_users.sql    # CREATE TABLE users...
│   └── 002_posts.sql    # CREATE TABLE posts...
└── 02_views/
    └── 001_recent_posts.sql # CREATE VIEW recent_posts...
```

Need a fresh database? Run your SQL files. They contain everything needed to build your schema from scratch—no need to replay years of migrations.

This is different from migration-based tools where the "current state" only exists by running every migration in order. With noorm, your SQL files **are** the current state.


## Execution Order Is Alphanumeric

Everything runs in alphanumeric order. Directories, files within directories, change scripts—all sorted the same way.

This matters because dependencies have order. Tables must exist before views reference them. Functions must exist before triggers call them. Without numeric prefixes, you get alphabetical order:

```
sql/functions/   ← runs first (f < t < v)
sql/tables/      ← runs second
sql/views/       ← runs third
```

That's broken—views can't reference tables that don't exist yet. Use numeric prefixes:

```
sql/01_tables/   ← runs first
sql/02_views/    ← runs second
sql/03_functions/ ← runs third (functions can reference tables/views)
```

The same rule applies to files within directories:

```
01_tables/
├── 01_users.sql     ← runs first
├── 02_posts.sql     ← runs second (can reference users)
└── 03_comments.sql  ← runs third (can reference posts)
```

And to change scripts:

```
change/
├── 001_create_table.sql
├── 002_add_indexes.sql
└── 003_seed_data.sql
```

One rule, everywhere. Look at the filesystem and you know the order.


## Changes Are Your Changelog

Changes document what you did to evolve an existing database. They answer: who changed what, when, and why.

```
changes/
└── 2024-01-15-add-user-roles/
    ├── change/
    │   └── 001_add_role_column.sql
    └── revert/
        └── 001_remove_role_column.sql
```

When you need to add a column to an existing production database, you don't just edit the SQL file—you also write a change that performs the `ALTER TABLE`.


## Templates Turn Configuration Into SQL

Sometimes you need more than static SQL. Templates let you generate SQL from structured data—define your rules in YAML, JSON, or CSV, and let noorm write the repetitive SQL for you.

Add `.tmpl` to any SQL file to make it a template:

```
sql/
├── tables/
│   └── users.sql           # Static SQL
└── security/
    ├── rls.yml             # Configuration data
    └── rls.sql.tmpl        # Template that reads it
```

Templates can read adjacent data files. Place a `rls.yml` next to `rls.sql.tmpl`, and the data is available as `rls` in your template.

Here's a real example: PostgreSQL Row-Level Security. Without templates, you'd write dozens of similar `CREATE POLICY` statements. With templates, you define policies in YAML:

```yaml
# sql/security/rls.yml
policies:
    users:
        - name: users_own_data
          for: ALL
          check: user_id = current_user_id()

    posts:
        - name: posts_read_public
          for: SELECT
          check: is_public = true

        - name: posts_owner_write
          for: ALL
          check: author_id = current_user_id()

    comments:
        - name: comments_read_if_post_visible
          for: SELECT
          check: |
              EXISTS (
                  SELECT 1 FROM posts
                  WHERE posts.id = comments.post_id
                  AND (posts.is_public OR posts.author_id = current_user_id())
              )
```

Then generate all the SQL:

```sql
-- sql/security/rls.sql.tmpl
{% for (const [table, policies] of Object.entries($.rls.policies)) { %}

ALTER TABLE {%~ table %} ENABLE ROW LEVEL SECURITY;

{% for (const policy of policies) { %}
DROP POLICY IF EXISTS {%~ policy.name %} ON {%~ table %};
CREATE POLICY {%~ policy.name %} ON {%~ table %}
    FOR {%~ policy.for %}
    USING ({%~ policy.check %});
{% } %}

{% } %}
```

This generates correct, complete SQL for every table. Add a new policy? Edit the YAML. The template handles the boilerplate.

You can also define **helper functions** in `$helpers.ts` files. Helpers are inherited up the directory tree—define utilities at the root, specialize them in subdirectories:

```typescript
// sql/$helpers.ts
export function grantAll(role: string, tables: string[]) {
    return tables
        .map(t => `GRANT SELECT, INSERT, UPDATE, DELETE ON ${t} TO ${role};`)
        .join('\n');
}
```

```sql
-- sql/security/grants.sql.tmpl
{%~ $.grantAll('app_user', ['users', 'posts', 'comments']) %}
```

Templates are powerful for:
- **Row-level security policies** - Define access rules, generate USING/CHECK clauses
- **Role permissions** - List roles and grants in YAML, generate GRANT/REVOKE statements
- **Scheduled jobs** - Define cron schedules in YAML, generate pg_cron or SQL Agent setup
- **Seed data** - Store reference data in CSV, generate INSERT statements
- **Custom types** - Define domain constraints in YAML, generate CREATE DOMAIN statements

The pattern is always the same: human-readable configuration goes in a data file, repetitive SQL comes out of the template.


## The Workflow

1. **Update your SQL files first.** They should always reflect the ideal schema.
2. **Write a change** to evolve existing databases to match.

Your SQL files stay in sync with reality. Changes track how you got there.

::: tip Fresh vs Existing
- **Fresh database** → Run SQL files with `noorm run build`
- **Existing database** → Apply changes with `noorm change ff`
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

Secrets are sensitive values that get inserted **into** your database via SQL templates. They're for application configuration you store in the database:

- AWS credentials (access key, secret key)
- SMTP credentials for sending emails
- API keys for third-party services

noorm stores secrets encrypted in your local state. When you run SQL templates, secrets are available but never written to disk in plain text.

```sql
-- sql/config/aws.sql.tmpl
INSERT INTO app_config (key, value) VALUES
    ('aws_access_key', '{%~ $.secrets.AWS_ACCESS_KEY %}'),
    ('aws_secret_key', '{%~ $.secrets.AWS_SECRET_KEY %}');
```

```bash
# Set a secret for the current config
noorm secret set AWS_ACCESS_KEY
noorm secret set AWS_SECRET_KEY
```

When you rebuild your database, your credentials are always there—but never exposed in your SQL files or version control.

Secrets are **config-scoped**. Each config has its own set of secrets (dev AWS vs prod AWS). There are also **global secrets** shared across all configs.


## State and Identity

Your **identity** lives in `~/.noorm/identity.json` along with your public and private keys. These are machine-local and never shared.

Your **state** lives in `.noorm/state/state.enc` and contains:

- Your saved configs (database credentials)
- Secrets (encrypted with your keys)

State is encrypted with your identity keys. It's not portable between machines—each developer has their own configs and secrets.

::: warning Don't Commit state.enc
Add `.noorm/state/state.enc` to `.gitignore`. It contains machine-specific encrypted data that won't work on other machines anyway.
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
    - tables
    - views
    - functions

stages:
  prod:
    protected: true
    secrets:
      - key: AWS_SECRET_KEY
        required: true
```

The `include` array filters which folders are included in builds. Execution order is alphanumeric—use numeric prefixes (`01_tables`, `02_views`) to control the sequence. Paths are relative to your `paths.sql` directory.


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
      - key: AWS_SECRET_KEY
        required: true
```

Now when you create a config with stage `production`, it's automatically protected and requires an `AWS_SECRET_KEY` secret.


## SQL Files vs Changes

| Aspect | SQL Files | Changes |
|--------|-----------|---------|
| Purpose | Define ideal schema | Evolve existing databases |
| Location | `sql/` | `changes/` |
| When to run | Fresh database, tests | Existing database |
| Rollback | No | Yes, with revert scripts |
| Order | Settings-defined, then alphabetical | By date prefix |

**SQL files** are your source of truth. They define what your schema looks like today. Execution order is first determined by folder order in your settings, then alphabetically within each folder.

**Changes** are your changelog. They document how to get an existing database to match your SQL files.


## What's Next?

- [Building Your SDK](/getting-started/building-your-sdk) - Wrap noorm in a TypeScript SDK for your apps
- [TUI Quick Reference](/tui) - Navigate the terminal interface
- [SQL Templates](/guide/sql-files/templates) - Dynamic SQL generation
- [Changes Guide](/guide/changes/overview) - Evolving existing databases
