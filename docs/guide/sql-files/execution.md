# Execution


## How Execution Works

When you run SQL files with noorm, every file goes through a checksum-based change detection process. This is the core value proposition: files that haven't changed don't run again.

Here's what happens under the hood:

1. noorm computes a SHA-256 checksum of the SQL that will actually run — for a `.sql.tmpl`, that is the *rendered* output, not the file on disk
2. It checks the tracking database for a previous execution record
3. If the file is new, changed, or previously failed, it runs
4. If unchanged and successful, it's skipped
5. After execution, the result and new checksum are recorded

Hashing the rendered output is what makes a template re-run when its data file, config, or secrets change even though its own bytes did not. The flip side: a template whose render is genuinely non-deterministic — one calling `$.now()` or `$.uuid()` — produces new SQL every time and therefore re-runs every build. That is the correct answer for a file whose output really is different each time; use a fixed value if you want it to settle.

This makes builds idempotent. Run the same command twice—unchanged files won't re-execute.


## run build

The primary command for executing your schema:

```bash
noorm run build
```

This executes all SQL files in your schema directory (defined in settings). Files are processed alphabetically by path, which means you can control execution order with prefixes:

```
sql/
├── 00_extensions/
│   └── 001_extensions.sql        # Runs first
├── 01_tables/
│   ├── 001_users.sql             # Runs second
│   └── 002_posts.sql             # Runs third
└── 02_views/
    └── 001_active_users.sql      # Runs last
```

Output shows what ran and what was skipped:

```
Building schema...

✓ sql/01_tables/001_users.sql
• sql/01_tables/002_posts.sql (unchanged)
✓ sql/02_views/001_active_users.sql

Executed: 2
Skipped:  1
```


## run file

Execute a single SQL file:

```bash
noorm run file sql/01_tables/001_users.sql
```

Useful for testing a specific file or re-running one file after a quick fix. The same change detection applies—if the file hasn't changed since its last successful run, it won't execute unless you use `--force`.


## run dir

Execute all files in a specific directory:

```bash
noorm run dir sql/02_views
```

Processes all `.sql` and `.sql.tmpl` files in that directory (and subdirectories), alphabetically. This is helpful when you want to rebuild just views or just a subset of your schema.


## Force Mode

Skip change detection entirely with `--force`:

```bash
noorm run build --force
```

Every file executes, regardless of whether it changed. Use this when:

- You need to rebuild everything after a database restore
- Troubleshooting an issue and want fresh execution
- External changes happened that noorm doesn't know about

In the TUI, the force option appears when you select a run command.


## Dry Run Mode

Preview what would execute without actually running anything:

```bash
noorm run build --dry-run
```

This renders all SQL files (including templates) and writes them to a local `tmp/` directory that mirrors your source structure:

```
Source:                              Dry run output:
sql/02_views/001_my_view.sql  →   tmp/sql/02_views/001_my_view.sql
sql/03_seeds/001_users.sql.tmpl  →   tmp/sql/03_seeds/001_users.sql
```

Templates are fully rendered with your current config context. The `.tmpl` extension is stripped from output files.

**When to use dry run:**

| Scenario | Command |
|----------|---------|
| Inspect rendered templates | `noorm run build --dry-run` |
| Review before production deploy | `noorm run build --dry-run -c production` |
| Debug template variables | `noorm run file seed.sql.tmpl --dry-run` |
| CI/CD validation step | `noorm run build --dry-run` |


## What Gets Tracked

noorm maintains two tables in your database to track execution history. On PostgreSQL and SQL Server they live in a dedicated `noorm` schema; MySQL and SQLite have no schemas, so they keep prefixed names in the default schema.

**`noorm.change`** (`__noorm_change__` on MySQL and SQLite) - Operation records:

| Field | Description |
|-------|-------------|
| `name` | Operation identifier (e.g., `build:2024-01-15T10:30:00`) |
| `change_type` | `'build'` or `'run'` |
| `executed_by` | Identity string (who ran it) |
| `config_name` | Which config was used |
| `status` | `'pending'`, `'success'`, `'failed'` |

**`noorm.executions`** (`__noorm_executions__` on MySQL and SQLite) - Individual file records:

| Field | Description |
|-------|-------------|
| `change_id` | FK to parent operation |
| `filepath` | File that was executed |
| `checksum` | SHA-256 of file contents |
| `status` | `'success'`, `'failed'`, `'skipped'` |
| `skip_reason` | `'unchanged'` if skipped |
| `duration_ms` | Execution time |

These tables let noorm answer: "Has this exact file content been executed before, and did it succeed?"


## Execution Order

Files execute **alphabetically by full path**. This is deterministic and predictable, but it means you need to name files carefully when order matters. See [Organization](/guide/sql-files/organization) for detailed naming strategies.

Common patterns:

```
sql/
├── 00_extensions/
│   └── 001_uuid.sql           # Extensions first
├── 01_types/
│   └── 001_enums.sql          # Types before tables
├── 02_tables/
│   ├── 001_users.sql          # Independent tables first
│   ├── 002_profiles.sql       # Tables with FKs after their dependencies
│   └── 003_posts.sql
└── 03_views/
    └── 001_active_users.sql   # Views last (they depend on tables)
```

The numbered prefixes ensure:
1. Extensions load before anything uses them
2. Types exist before tables reference them
3. Tables exist before views reference them
4. Within each category, files run in predictable order

::: tip File Naming
Use `001_`, `002_` prefixes rather than `1_`, `2_` for consistent sorting. Leading zeros ensure `002` comes before `010` alphabetically.
:::


## MSSQL: Multiple Statements per File


SQL Server has a particular rule: `CREATE PROCEDURE`, `CREATE FUNCTION`, `CREATE TRIGGER`, `CREATE VIEW`, and `CREATE TYPE` (for table-valued parameters) must each be the only statement in their batch. SQL Server expresses this with `GO` — a separator that ends a batch.


`GO` is not part of the SQL language. It's a sqlcmd / SSMS directive. Tools that pass raw file content directly to the driver get back `Incorrect syntax near 'GO'`. noorm handles this for you: on MSSQL connections, the runner splits files on `GO` (anchored to its own line) and executes each batch in order.


```sql
-- sql/09_procedures/checkout.sql
CREATE PROCEDURE checkout_begin
    @CustomerId INT
AS
BEGIN
    SET NOCOUNT ON;
    INSERT INTO orders (customer_id, status) VALUES (@CustomerId, 'pending');
END
GO

CREATE PROCEDURE checkout_commit
    @OrderId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE orders SET status = 'paid' WHERE id = @OrderId;
END
GO

CREATE PROCEDURE checkout_cancel
    @OrderId INT
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE orders SET status = 'cancelled' WHERE id = @OrderId;
END
GO
```


Three related procedures, one file. If batch 2 fails, noorm reports `[batch 2 of 3]` in the error and skips batch 3 — so you know exactly which `CREATE PROCEDURE` blew up without re-reading the file in your head.


`GO` recognition is line-oriented: the literal token `GO` must be the entire trimmed content of a line (case-insensitive). `GO;`, `GOLANG`, or `GO` mid-line do not split. Keep `GO` tokens out of string literals and `/* ... */` block comments — the splitter does not parse SQL, so an inadvertent `GO` inside a string on its own line will still be treated as a separator. This matches sqlcmd behavior.


PostgreSQL runs a multi-statement file as-is, in one implicit transaction. SQLite gets its own splitter: its driver compiles the first statement of a string and discards the rest, so noorm splits on statement boundaries before handing anything over — semicolons inside string literals, quoted identifiers, comments, and trigger bodies are not treated as boundaries. MySQL's driver rejects multi-statement strings outright; put each statement in its own file, or use a dialect that supports them.


For the gory details on what the runner does under the hood, see [MSSQL Batch Handling](/dev/runner#mssql-batch-handling).


## Summary

| Command | Purpose |
|---------|---------|
| `noorm run build` | Execute entire schema directory |
| `noorm run file <path>` | Execute single file |
| `noorm run dir <path>` | Execute files in directory |
| `--force` | Re-run regardless of changes |
| `--dry-run` | Preview without executing |

The checksum system means you can run `noorm run build` as often as you want—only changed or new files execute. This is the foundation of noorm's approach to database schema management.


## What's Next?

- [Organization](/guide/sql-files/organization) - Structure your SQL files for predictable execution order
- [Templates](/guide/sql-files/templates) - Add dynamic content to `.sql.tmpl` files
- [Changes](/guide/changes/overview) - One-time operations with rollback support
