# Teardown


Database cleanup that handles the tedious parts. Foreign key constraints, drop order, identity resets. Two operations, one goal: a clean slate.


## When You Need This

Development databases accumulate debris. Half-applied changes, test data from last week, orphaned tables from abandoned features. Dropping and recreating the entire database works, but it is slow. Filesystem operations, permission grants, connection pool resets. What should take milliseconds becomes 5-10 seconds.

noorm provides controlled reset operations that complete in milliseconds while handling the complexity for you.


## Two Operations

| Operation | What happens | When to use |
|-----------|--------------|-------------|
| `truncate` | Delete all rows, keep tables | Test resets, re-seeding data |
| `teardown` | Drop all database objects | Full rebuild, change testing |

::: danger Destructive Operations
Both operations permanently destroy data. `truncate` wipes all rows. `teardown` drops tables, views, functions, procedures, types, and foreign key constraints. There is no undo. These commands require explicit confirmation.
:::


## Truncate: Wipe Data, Keep Schema

Truncate removes all data while preserving table structure. Fast reset for test cycles.

```bash
noorm db truncate -y
```

### What Gets Truncated

- All user tables (rows deleted)
- Identity/auto-increment counters restarted, on every dialect except SQLite
- Foreign key constraints temporarily disabled during operation

Foreign key enforcement is re-enabled even when the truncate itself fails partway through, so a failed run never leaves the database with constraints switched off.

### What Stays

- Table definitions and indexes
- Views, functions, stored procedures
- noorm internal tracking tables (the `noorm` schema, or `__noorm_*__` tables)


## Teardown: Drop Everything

Teardown removes all database objects. Clean slate for full rebuilds.

```bash
noorm db teardown -y
```

::: warning Access Roles
`db teardown` is gated by the config's `db:teardown` permission: `viewer` and `operator` are both denied outright, and even `admin` must confirm (`yes-<config>`, or `NOORM_YES=1` in CI). Only an `admin`-role config can tear down at all. See [Access Roles](#access-roles) below.
:::

### Drop Order

Objects are removed in dependency-safe order:

1. **Foreign key constraints** - Must go first to allow table drops
2. **CHECK constraints** - MSSQL only, and only when functions are being dropped: a scalar UDF referenced by a CHECK constraint cannot be dropped while its table stands
3. **Procedures** - Dropped early so they hold no references to the functions, views, and tables below
4. **Functions** - Must precede table drops so schema-bound UDFs release their dependency locks
5. **Views** - Schema-bound views also lock the tables they reference
6. **Tables** - Safe once every schema-bound dependent is gone
7. **Types** - Table types first, then the rest

Procedures, functions, and views all go before tables, not after. A `WITH SCHEMABINDING` object on MSSQL holds a dependency lock on the table it references, and dropping the table first fails with "Cannot DROP TABLE ... because it is being referenced by object ...".

You do not need to manage this ordering. noorm handles it automatically.

Pass `--preserve-schemas <a,b>` to leave whole schemas untouched. Teardown reaches every non-system schema, so this is the way to protect one it did not create.

### What Stays

noorm internal tables are always preserved:

- `change` - Change execution history
- `executions` - File execution records
- `lock` - Active operation locks

On PostgreSQL and SQL Server these live in a dedicated `noorm` schema, so they read as `noorm.change`, `noorm.executions`, and `noorm.lock`. MySQL and SQLite have no schemas, so they keep the prefixed forms in the default schema: `__noorm_change__`, `__noorm_executions__`, `__noorm_lock__`.

After teardown, noorm can still track what was applied previously. Changes are marked as `stale`, meaning they'll re-run on the next [fast-forward](/guide/changes/forward-revert). See [History](/guide/changes/history) for how this affects your execution log.


## Access Roles

[Configs](/guide/environments/configs) declare an `access.user` role — `viewer`, `operator`, or `admin` — and each destructive operation resolves against its own permission, not one shared one. This prevents accidentally wiping production data. You can also cap it at the [stage level](/guide/environments/stages): a stage with `protected: true` clamps every linked config's resolved access to at most `operator`/`viewer`.

```yaml
# .noorm/settings.yml
stages:
    prod:
        defaults:
            protected: true   # access ceiling: at most operator/viewer
```

The three permissions in this family resolve differently:

| Operation | Permission | `viewer` | `operator` | `admin` |
|-----------|------------|----------|------------|---------|
| `db teardown` | `db:teardown` | Denied | Denied | Confirm |
| `db truncate` | `db:truncate` | Denied | Confirm | Confirm |
| `db reset` / `ctx.noorm.db.reset()` | `db:reset` | Denied | Confirm | Allowed |

Teardown is the strictest of the three: it is the only one an `operator` cannot reach at all, and the only one that still asks an `admin` to confirm. `reset` is the loosest, because it rebuilds the schema it just dropped.

When you attempt teardown on a `viewer`- or `operator`-role config:

```
Cannot teardown on config "prod": "db:teardown" is not allowed on config "prod" (role: operator)
```

No flag, environment variable, or SDK option overrides a denial. Give the config `admin` access if it genuinely needs to be torn down.

### Confirming on `admin`

**CLI/TUI**: Type the confirmation phrase, or pass `--yes` (`NOORM_YES=1` in CI) to skip the prompt:

```bash
NOORM_YES=1 noorm db teardown --config prod
```

**SDK**: There is no prompt to answer. `ctx.noorm.db.teardown()` throws `ProtectedConfigError` on any config whose confirmation the caller has not pre-supplied. Pass `yes: true` to `createContext`, or set `NOORM_YES=1` in the environment, the same variable the CLI honors:

```typescript
const ctx = await createContext({ config: 'prod', yes: true })

await ctx.noorm.db.teardown()  // Throws ProtectedConfigError without `yes` (or NOORM_YES=1)
```

Neither `yes: true` nor `NOORM_YES=1` unblocks a denial. On a `viewer`- or `operator`-role config, `teardown()` throws no matter what you pass.

A dry run is checked against the role but never against the confirmation: any role allowed to tear down can preview one without `--yes`. Previewing is the safety mechanism, so it stays reachable.

Contexts created on the `agent` channel (MCP, or an AI agent driving the CLI) never satisfy a confirmation at all. `confirm` collapses to `deny` before `yes` is consulted, so an agent cannot walk through a gate a human was meant to answer.

::: danger
Running teardown against production should be exceedingly rare. If you find yourself doing this regularly, reconsider your deployment workflow.
:::


## Preserving Tables

Some tables should survive resets. Lookup tables, configuration tables, audit logs. Configure these in settings:

```yaml
# .noorm/settings.yml
teardown:
    preserveTables:
        - countries
        - currencies
        - app_settings
        - audit_log
```

These tables will be skipped during both truncate and teardown operations. Their data and structure remain intact.

`ctx.noorm.db.reset()` is the exception: it ignores `preserveTables` on purpose. Reset rebuilds the whole schema from `sql/`, so any table left standing would collide with the build's `CREATE TABLE` and abort the rebuild.


## Post-Teardown Scripts

Re-seed essential data after teardown completes:

```yaml
# .noorm/settings.yml
teardown:
    postScript: sql/teardown/seed.sql
```

The `postScript` runs immediately after teardown finishes. Use it to:

- Insert required lookup data
- Create default admin accounts
- Set up test fixtures

```sql
-- sql/teardown/seed.sql
INSERT INTO countries (code, name) VALUES
    ('US', 'United States'),
    ('CA', 'Canada'),
    ('MX', 'Mexico');

INSERT INTO app_settings (key, value) VALUES
    ('version', '1.0.0'),
    ('maintenance_mode', 'false');
```


## Using in Tests

The SDK provides teardown methods with test-oriented safety guards.

### Basic Test Setup

```typescript
import { createContext, RequireTestError } from '@noormdev/sdk'

describe('user service', () => {

    let ctx

    beforeAll(async () => {
        // requireTest: true prevents accidents with real databases
        ctx = await createContext({
            config: 'test',
            requireTest: true,
        })
        await ctx.connect()
    })

    beforeEach(async () => {
        // Fast reset between tests
        await ctx.noorm.db.truncate()
        await ctx.noorm.run.file('./seeds/test-data.sql')
    })

    afterAll(async () => {
        await ctx.disconnect()
    })

    it('creates a user', async () => {
        // Clean database, ready for test
    })

})
```

### The `requireTest` Guard

When `requireTest: true`, the SDK throws if the config does not have `isTest: true`:

```typescript
// If 'staging' does not have isTest: true, this throws
const ctx = await createContext({
    config: 'staging',
    requireTest: true,  // RequireTestError: Config "staging" does not have isTest: true
})
```

This catches configuration mistakes before tests run against the wrong database.

### Full Reset for Integration Tests

When schema changes are involved:

```typescript
beforeAll(async () => {
    ctx = await createContext({ config: 'test', requireTest: true })
    await ctx.connect()

    // Full teardown + rebuild
    await ctx.noorm.db.reset()
})
```

The `reset()` method combines a full teardown with `run.build({ force: true })` for complete schema reconstruction. It is gated by `db:reset`, which an `admin`-role config satisfies without confirmation.


## Scripted Usage

For CI/CD pipelines, drive the same teardown commands non-interactively. Always pair them with `-y` to skip the confirmation prompt — the CLI refuses to wipe data otherwise.

### Basic Commands

```bash
# Truncate all data
noorm db truncate -y

# Full teardown
noorm db teardown -y

# Preview what would be dropped
noorm db teardown --dry-run
```

### JSON Output

```bash
noorm db teardown --json --yes
```

```json
{
    "success": true,
    "dropped": {
        "tables": ["users", "posts", "comments"],
        "views": ["active_users"],
        "functions": [],
        "procedures": [],
        "types": [],
        "foreignKeys": ["posts_user_id_fkey"]
    },
    "count": 4
}
```

`count` sums tables, views, functions, and types, but not procedures or foreign keys. A dry run adds `"dryRun": true`, and a configured post-script adds `postScriptResult`. When a post-script fails, the objects are still gone but the command exits non-zero, because a teardown whose seeding step never ran is half-finished.

`noorm db truncate --json` reports `truncated`, `preserved`, and `count`, plus `statements` on a dry run.

### CI/CD Pattern

```yaml
# GitHub Actions example
test:
  runs-on: ubuntu-latest
  services:
    postgres:
      image: postgres:16
      env:
        POSTGRES_PASSWORD: test
        POSTGRES_DB: test_db
      ports:
        - 5432:5432

  steps:
    - uses: actions/checkout@v4
    - uses: actions/setup-node@v4

    - name: Setup test database
      env:
        NOORM_CONNECTION_DIALECT: postgres
        NOORM_CONNECTION_HOST: localhost
        NOORM_CONNECTION_DATABASE: test_db
        NOORM_CONNECTION_USER: postgres
        NOORM_CONNECTION_PASSWORD: test
      run: |
        npx noorm run build
        npx noorm change ff

    - name: Run tests
      run: npm test
```

### Test Database Reset Script

```bash
#!/bin/bash
set -e

# Reset to clean state before test run
noorm db teardown --config test -y
noorm run build --config test
noorm change ff --config test

echo "Test database ready"
```


## Dialect Differences

noorm generates appropriate SQL for each database:

| Feature | PostgreSQL | MySQL | MSSQL | SQLite |
|---------|------------|-------|-------|--------|
| Truncate | `TRUNCATE TABLE ... CASCADE` | `TRUNCATE TABLE` | `DELETE FROM` | `DELETE FROM` |
| Reset identity | `RESTART IDENTITY` | Automatic with `TRUNCATE` | `DBCC CHECKIDENT ... RESEED` | N/A |
| Disable FKs | `SET session_replication_role` | `SET FOREIGN_KEY_CHECKS=0` | Per-table `NOCHECK CONSTRAINT` | `PRAGMA foreign_keys=OFF` |
| Drop cascade | `CASCADE` | Manual order | Manual order | Manual order |

Two dialects use DELETE rather than TRUNCATE, for different reasons. SQLite has no TRUNCATE statement. MSSQL has one, but it refuses to run against a table referenced by a foreign key even with constraints set to NOCHECK, so noorm issues a DELETE and reseeds the identity separately.

MSSQL also has no session-level foreign key switch, so noorm emits one `ALTER TABLE ... NOCHECK CONSTRAINT ALL` per table rather than using `sp_MSforeachtable`, whose parallel workers deadlock on schema locks.


## Best Practices

**Preview first.** Run with `--dry-run` before executing, especially in shared environments.

**Preserve audit tables.** If you have logging or audit tables, add them to `preserveTables`.

**Use truncate for test cycles.** Faster than teardown + rebuild when schema has not changed.

**Use postScript for seeds.** Re-insert required data automatically after teardown.

**Check the config's access role.** A `viewer`/`operator` role exists for a reason. Switching a config to `admin` is what makes teardown possible at all, so think twice before doing it to get past a denial.

```bash
# Safe teardown pattern
noorm db teardown --dry-run  # Preview first
noorm db teardown -y         # Execute after review
```


## What's Next?

- [Execution](/guide/sql-files/execution) - Rebuild schema after teardown
- [Changes](/guide/changes/overview) - How changes work with teardown
- [Schema Explorer](/guide/database/explore) - Verify what was dropped
