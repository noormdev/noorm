# Teardown


Database cleanup that handles the tedious parts. Foreign key constraints, drop order, identity resets. Two operations, one goal: a clean slate.


## When You Need This

Development databases accumulate debris. Half-applied migrations, test data from last week, orphaned tables from abandoned features. Dropping and recreating the entire database works, but it is slow. Filesystem operations, permission grants, connection pool resets. What should take milliseconds becomes 5-10 seconds.

noorm provides controlled reset operations that complete in milliseconds while handling the complexity for you.


## Two Operations

| Operation | What happens | When to use |
|-----------|--------------|-------------|
| `truncate` | Delete all rows, keep tables | Test resets, re-seeding data |
| `teardown` | Drop all database objects | Full rebuild, migration testing |

::: danger Destructive Operations
Both operations permanently destroy data. `truncate` wipes all rows. `teardown` drops tables, views, functions, and types. There is no undo. These commands require explicit confirmation.
:::


## Truncate: Wipe Data, Keep Schema

Truncate removes all data while preserving table structure. Fast reset for test cycles.

```bash
noorm -H -y db truncate
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
noorm -H -y db teardown
```

::: warning Protected Configs
`db teardown` is blocked on protected configs. Use `--force` to override, but consider whether you really want to drop everything from production.
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

After teardown, noorm can still track what was applied previously. Changes are marked as `stale`, meaning they'll re-run on the next [fast-forward](/guide/migrations/forward-revert). See [History](/guide/migrations/history) for how this affects your execution log.


## Protected Configs

[Configs](/guide/environments/configs) marked as `protected: true` block destructive operations. This prevents accidentally wiping production data. You can also set protection at the [stage level](/guide/environments/stages).

```yaml
# .noorm/settings.yml
stages:
    prod:
        defaults:
            protected: true
```

When you attempt teardown on a protected config:

```
Cannot teardown on protected config "prod"
```

### Overriding Protection

**CLI**: Use `--force` flag (with `--yes` to skip confirmation)

```bash
noorm -H -y --force db teardown --config prod
```

**SDK**: Pass `allowProtected: true`

```typescript
const ctx = await createContext({
    config: 'prod',
    allowProtected: true,
})

await ctx.teardown()  // Now allowed
```

::: danger
Overriding protection on production databases should be exceedingly rare. If you find yourself doing this regularly, reconsider your deployment workflow.
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
import { createContext, RequireTestError } from 'noorm/sdk'

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
        await ctx.truncate()
        await ctx.runFile('./seeds/test-data.sql')
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
    await ctx.reset()
})
```

The `reset()` method combines `teardown()` and `build({ force: true })` for complete schema reconstruction.


## Headless Usage

For CI/CD pipelines, use headless mode with explicit confirmation flags.

### Basic Commands

```bash
# Truncate all data
noorm -H -y db truncate

# Full teardown
noorm -H -y db teardown

# Preview what would be dropped
noorm -H --dry-run db teardown
```

### JSON Output

```bash
noorm -H --json db teardown
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
        npx noorm -H run build
        npx noorm -H change ff

    - name: Run tests
      run: npm test
```

### Test Database Reset Script

```bash
#!/bin/bash
set -e

# Reset to clean state before test run
noorm -H -y db teardown --config test
noorm -H run build --config test
noorm -H change ff --config test

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

**Check protected status.** The protected flag exists for a reason. Think twice before overriding.

```bash
# Safe teardown pattern
noorm -H --dry-run db teardown  # Preview first
noorm -H -y db teardown         # Execute after review
```


## What's Next?

- [Execution](/guide/sql-files/execution) - Rebuild schema after teardown
- [Changes](/guide/migrations/changes) - How changes work with teardown
- [Schema Explorer](/guide/database/explore) - Verify what was dropped
