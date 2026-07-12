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
Both operations permanently destroy data. `truncate` wipes all rows. `teardown` drops tables, views, functions, and types. There is no undo. These commands require explicit confirmation.
:::


## Truncate: Wipe Data, Keep Schema

Truncate removes all data while preserving table structure. Fast reset for test cycles.

```bash
noorm -y db truncate
```

### What Gets Truncated

- All user tables (rows deleted)
- Identity/auto-increment sequences reset to 1
- Foreign key constraints temporarily disabled during operation

### What Stays

- Table definitions and indexes
- Views, functions, stored procedures
- noorm internal tables (`__noorm_*`)


## Teardown: Drop Everything

Teardown removes all database objects. Clean slate for full rebuilds.

```bash
noorm -y db teardown
```

::: warning Access Roles
`db teardown` is gated by the config's `db:reset` access role: `viewer` is denied outright, `operator` must confirm (`yes-<config>`, or `NOORM_YES=1` in CI), `admin` runs unconfirmed — see [Access Roles](#access-roles) below.
:::

### Drop Order

Objects are removed in dependency-safe order:

1. **Foreign key constraints** - Must go first to allow table drops
2. **Views** - May depend on tables
3. **Tables** - Core schema objects
4. **Functions/Procedures** - May depend on types
5. **Types** - Enum and composite types last

You do not need to manage this ordering. noorm handles it automatically.

### What Stays

noorm internal tables are always preserved:

- `__noorm_change__` - Change execution history
- `__noorm_executions__` - File execution records
- `__noorm_locks__` - Active operation locks

After teardown, noorm can still track what was applied previously. Changes are marked as `stale`, meaning they'll re-run on the next [fast-forward](/guide/changes/forward-revert). See [History](/guide/changes/history) for how this affects your execution log.


## Access Roles

[Configs](/guide/environments/configs) declare an `access.user` role — `viewer`, `operator`, or `admin` — that gates `db teardown` (and `truncate`, `reset`) via the `db:reset` permission. This prevents accidentally wiping production data. You can also cap it at the [stage level](/guide/environments/stages): a stage with `protected: true` clamps every linked config's resolved access to at most `operator`/`viewer`.

```yaml
# .noorm/settings.yml
stages:
    prod:
        defaults:
            protected: true   # access ceiling: at most operator/viewer
```

When you attempt teardown on a `viewer`-role config:

```
Cannot teardown on config "prod": "db:reset" is not allowed on config "prod" (role: viewer)
```

An `operator`-role config doesn't refuse teardown — it asks for confirmation instead (see below).

### Confirming on `operator`

**CLI/TUI**: Type the confirmation phrase, or pass `--yes` (`NOORM_YES=1` in CI) to skip the prompt:

```bash
NOORM_YES=1 noorm db teardown --config prod
```

**SDK**: There is no prompt to answer. `ctx.noorm.db.teardown()` throws `ProtectedConfigError` on an `operator`-role config unless `NOORM_YES=1` is set in the environment — the same variable the CLI honors:

```typescript
const ctx = await createContext({ config: 'prod' })

await ctx.noorm.db.teardown()  // Throws ProtectedConfigError on operator; run via CLI/TUI or set NOORM_YES=1
```

A `viewer`-role config denies `db teardown` outright — no flag, environment variable, or SDK option overrides that. Give the config `admin` access if it genuinely needs frictionless teardown.

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

The `reset()` method combines `ctx.noorm.db.teardown()` and `ctx.noorm.run.build({ force: true })` for complete schema reconstruction.


## Scripted Usage

For CI/CD pipelines, drive the same teardown commands non-interactively. Always pair them with `-y` to skip the confirmation prompt — the CLI refuses to wipe data otherwise.

### Basic Commands

```bash
# Truncate all data
noorm -y db truncate

# Full teardown
noorm -y db teardown

# Preview what would be dropped
noorm --dry-run db teardown
```

### JSON Output

```bash
noorm --json db teardown
```

```json
{
    "status": "success",
    "dropped": {
        "tables": ["users", "posts", "comments"],
        "views": ["active_users"],
        "functions": [],
        "types": []
    },
    "preserved": ["countries", "app_settings"],
    "durationMs": 45
}
```

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
noorm -y db teardown --config test
noorm run build --config test
noorm change ff --config test

echo "Test database ready"
```


## Dialect Differences

noorm generates appropriate SQL for each database:

| Feature | PostgreSQL | MySQL | MSSQL | SQLite |
|---------|------------|-------|-------|--------|
| Truncate | `TRUNCATE TABLE` | `TRUNCATE TABLE` | `TRUNCATE TABLE` | `DELETE FROM` |
| Reset identity | `RESTART IDENTITY` | `AUTO_INCREMENT = 1` | `DBCC CHECKIDENT RESEED` | N/A |
| Disable FKs | `SET session_replication_role` | `SET FOREIGN_KEY_CHECKS=0` | `NOCHECK CONSTRAINT` | `PRAGMA foreign_keys=OFF` |
| Drop cascade | `CASCADE` | Manual order | Manual order | Manual order |

SQLite uses DELETE instead of TRUNCATE because SQLite does not support TRUNCATE.


## Best Practices

**Preview first.** Run with `--dry-run` before executing, especially in shared environments.

**Preserve audit tables.** If you have logging or audit tables, add them to `preserveTables`.

**Use truncate for test cycles.** Faster than teardown + rebuild when schema has not changed.

**Use postScript for seeds.** Re-insert required data automatically after teardown.

**Check the config's access role.** A `viewer`/`operator` role exists for a reason. Think twice before switching a config to `admin` just to skip the confirmation.

```bash
# Safe teardown pattern
noorm --dry-run db teardown  # Preview first
noorm -y db teardown         # Execute after review
```


## What's Next?

- [Execution](/guide/sql-files/execution) - Rebuild schema after teardown
- [Changes](/guide/changes/overview) - How changes work with teardown
- [Schema Explorer](/guide/database/explore) - Verify what was dropped
