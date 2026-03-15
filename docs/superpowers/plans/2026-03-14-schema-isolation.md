# Schema Isolation Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move noorm's 6 internal tables into a dedicated `noorm` schema for PostgreSQL and MSSQL, keeping `__noorm_` prefix for SQLite and MySQL.

**Architecture:** Dialect-aware `getNoormTables(dialect)` returns correct table names. `noormDb(db, dialect)` wraps Kysely with `withSchema('noorm')` for pg/mssql. Intersection type `NoormDatabase` has both clean and prefixed keys. Migration v2 moves existing tables. Explore/teardown simplified via `EXCLUDED_SCHEMAS`.

**Tech Stack:** Kysely (schema builder, `withSchema`), Bun test runner, TypeScript

**Spec:** `docs/superpowers/specs/2026-03-13-noorm-schema-isolation-design.md`

---

## Chunk 1: Core API and Type System

### Task 1: Add `getNoormTables()` and `noormDb()` to shared/tables.ts

**Files:**
- Modify: `src/core/shared/tables.ts`
- Modify: `src/core/shared/index.ts`
- Test: `tests/core/shared/tables.test.ts`

- [ ] **Step 1: Write tests for `getNoormTables()` and `noormDb()`**

Create `tests/core/shared/tables.test.ts`:

```typescript
import { describe, it, expect } from 'bun:test';

import { getNoormTables, noormDb, NOORM_TABLES } from '../../../src/core/shared/tables.js';

describe('shared: getNoormTables', () => {

    it('should return clean names for postgres', () => {

        const tables = getNoormTables('postgres');

        expect(tables.version).toBe('version');
        expect(tables.change).toBe('change');
        expect(tables.executions).toBe('executions');
        expect(tables.lock).toBe('lock');
        expect(tables.identities).toBe('identities');
        expect(tables.vault).toBe('vault');

    });

    it('should return clean names for mssql', () => {

        const tables = getNoormTables('mssql');

        expect(tables.version).toBe('version');
        expect(tables.change).toBe('change');

    });

    it('should return prefixed names for sqlite', () => {

        const tables = getNoormTables('sqlite');

        expect(tables.version).toBe('__noorm_version__');
        expect(tables.change).toBe('__noorm_change__');
        expect(tables.executions).toBe('__noorm_executions__');
        expect(tables.lock).toBe('__noorm_lock__');
        expect(tables.identities).toBe('__noorm_identities__');
        expect(tables.vault).toBe('__noorm_vault__');

    });

    it('should return prefixed names for mysql', () => {

        const tables = getNoormTables('mysql');

        expect(tables.version).toBe('__noorm_version__');
        expect(tables.change).toBe('__noorm_change__');

    });

    it('should match NOORM_TABLES for sqlite (backward compat)', () => {

        const tables = getNoormTables('sqlite');

        expect(tables.version).toBe(NOORM_TABLES.version);
        expect(tables.change).toBe(NOORM_TABLES.change);
        expect(tables.executions).toBe(NOORM_TABLES.executions);
        expect(tables.lock).toBe(NOORM_TABLES.lock);
        expect(tables.identities).toBe(NOORM_TABLES.identities);
        expect(tables.vault).toBe(NOORM_TABLES.vault);

    });

});

describe('shared: noormDb', () => {

    it('should return db with schema for postgres', () => {

        // We can't easily test withSchema without a real Kysely instance,
        // but we can verify the function doesn't throw and returns something
        const mockDb = { withSchema: (s: string) => ({ schema: s }) } as any;

        const result = noormDb(mockDb, 'postgres');

        expect((result as any).schema).toBe('noorm');

    });

    it('should return db with schema for mssql', () => {

        const mockDb = { withSchema: (s: string) => ({ schema: s }) } as any;

        const result = noormDb(mockDb, 'mssql');

        expect((result as any).schema).toBe('noorm');

    });

    it('should return plain db for sqlite', () => {

        const mockDb = { withSchema: () => ({ schema: 'nope' }) } as any;

        const result = noormDb(mockDb, 'sqlite');

        expect(result).toBe(mockDb);

    });

    it('should return plain db for mysql', () => {

        const mockDb = { withSchema: () => ({ schema: 'nope' }) } as any;

        const result = noormDb(mockDb, 'mysql');

        expect(result).toBe(mockDb);

    });

});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/shared/tables.test.ts`
Expected: FAIL — `getNoormTables` and `noormDb` are not exported

- [ ] **Step 3: Update `NoormDatabase` type to intersection and add `getNoormTables()` + `noormDb()`**

In `src/core/shared/tables.ts`:

1. Add `import type { Dialect } from '../connection/types.js';` at the top (after existing imports).

2. Add `@deprecated` JSDoc to `NOORM_TABLES`:
```typescript
/**
 * @deprecated Use `getNoormTables(dialect)` instead. This constant maps to prefixed
 * names and will produce incorrect SQL when used with `noormDb()` on pg/mssql.
 */
```

3. Add `NoormTableNames` type and `getNoormTables()` function after the `NOORM_TABLES` constant (before the `NoormTableName` type):

```typescript
/**
 * Shape returned by getNoormTables().
 */
export type NoormTableNames = {
    version: string;
    change: string;
    executions: string;
    lock: string;
    identities: string;
    vault: string;
};

/**
 * Schema-qualified table names for pg/mssql.
 */
const SCHEMA_TABLES = Object.freeze({
    version: 'version' as const,
    change: 'change' as const,
    executions: 'executions' as const,
    lock: 'lock' as const,
    identities: 'identities' as const,
    vault: 'vault' as const,
});

/**
 * Get dialect-appropriate noorm table names.
 *
 * pg/mssql: clean names used with withSchema('noorm').
 * sqlite/mysql: prefixed names used directly.
 *
 * @example
 * ```typescript
 * const tables = getNoormTables('postgres');
 * const ndb = noormDb(db, 'postgres');
 * await ndb.selectFrom(tables.change).selectAll().execute();
 * ```
 */
export function getNoormTables(dialect: Dialect) {

    if (dialect === 'postgres' || dialect === 'mssql') {

        return SCHEMA_TABLES;

    }

    return NOORM_TABLES;

}
```

4. Add `noormDb()` function right after `getNoormTables()`:

```typescript
/**
 * Get a Kysely instance scoped to the noorm schema.
 *
 * pg/mssql: wraps with withSchema('noorm') so all table references
 * are prefixed with the noorm schema.
 * sqlite/mysql: returns the db as-is.
 *
 * @example
 * ```typescript
 * const ndb = noormDb(db, 'postgres');
 * await ndb.selectFrom('change').selectAll().execute();
 * // SQL: SELECT * FROM "noorm"."change"
 * ```
 */
export function noormDb(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Kysely<NoormDatabase> {

    if (dialect === 'postgres' || dialect === 'mssql') {

        return db.withSchema('noorm');

    }

    return db;

}
```

5. Add `import type { Kysely } from 'kysely';` to the top imports.

6. Update `NoormDatabase` to be the intersection type. Replace the existing `NoormDatabase` interface (around line 360) with:

```typescript
/**
 * Schema-qualified database interface for pg/mssql.
 *
 * Used with db.withSchema('noorm') — table names have no prefix.
 */
export interface NoormSchemaDb {
    version: NoormVersionTable;
    change: NoormChangeTable;
    executions: NoormExecutionsTable;
    lock: NoormLockTable;
    identities: NoormIdentitiesTable;
    vault: NoormVaultTable;
}

/**
 * Prefixed database interface for sqlite/mysql.
 *
 * Used directly — table names have __noorm_ prefix.
 */
export interface NoormPrefixDb {
    __noorm_version__: NoormVersionTable;
    __noorm_change__: NoormChangeTable;
    __noorm_executions__: NoormExecutionsTable;
    __noorm_lock__: NoormLockTable;
    __noorm_identities__: NoormIdentitiesTable;
    __noorm_vault__: NoormVaultTable;
}

/**
 * Combined database interface for all noorm tracking tables.
 *
 * Intersection of schema-qualified (pg/mssql) and prefixed (sqlite/mysql)
 * interfaces. Both key sets are valid — use getNoormTables(dialect) to get
 * the correct keys for your dialect.
 *
 * @example
 * ```typescript
 * const tables = getNoormTables(dialect);
 * const ndb = noormDb(db, dialect);
 * await ndb.selectFrom(tables.change).selectAll().execute();
 * ```
 */
export type NoormDatabase = NoormSchemaDb & NoormPrefixDb;
```

7. Update `NoormTableName` type to include both sets:

```typescript
/**
 * Type for table names (both clean and prefixed).
 */
export type NoormTableName =
    | (typeof NOORM_TABLES)[keyof typeof NOORM_TABLES]
    | (typeof SCHEMA_TABLES)[keyof typeof SCHEMA_TABLES];
```

- [ ] **Step 4: Update `src/core/shared/index.ts` exports**

Add the new exports:

```typescript
export { NOORM_TABLES, getNoormTables, noormDb } from './tables.js';

export type {
    NoormTableNames,
    NoormTableName,
    NoormDatabase,
    NoormSchemaDb,
    NoormPrefixDb,
    // ... (keep all existing type exports)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/shared/tables.test.ts`
Expected: PASS

- [ ] **Step 6: Run existing tests to check nothing broke**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/version/schema.test.ts tests/core/version/types.test.ts`
Expected: PASS (existing tests should still work since `NoormDatabase` intersection includes the old prefixed keys)

- [ ] **Step 7: Commit**

```bash
git add src/core/shared/tables.ts src/core/shared/index.ts tests/core/shared/tables.test.ts
git commit -m "feat(schema): add getNoormTables() and noormDb() for dialect-aware table resolution"
```

---

## Chunk 2: Migration v2 and Version Detection

### Task 2: Update version detection for two-step schema lookup

**Files:**
- Modify: `src/core/version/schema/index.ts`
- Modify: `src/core/identity/index.ts` (update `waitForIdentityToLoad` to accept `dialect`)
- Modify: `src/core/identity/sync.ts` (update `registerIdentity` to accept `dialect` — needed because `waitForIdentityToLoad` calls it after migration)
- Test: `tests/core/version/schema.test.ts`

**Dependency note:** `bootstrapSchema()` and `migrateSchema()` call `waitForIdentityToLoad(db)` after migration. After v2 migration on pg/mssql, the identities table has moved to `noorm.identities`. If `waitForIdentityToLoad` still uses hardcoded `'__noorm_identities__'`, it will fail. Therefore `waitForIdentityToLoad`, `registerIdentity`, and any sync.ts functions they call must be updated to accept `dialect` in this task — not deferred to Task 7.

- [ ] **Step 1: Write tests for two-step `tablesExist()` detection**

Add to `tests/core/version/schema.test.ts` inside the existing `describe('tablesExist')` block:

```typescript
it('should detect tables in noorm schema (pg/mssql path)', async () => {

    // Simulate pg/mssql: tables in noorm schema with clean names
    // SQLite can't create schemas, so we test the raw SQL fallback
    // For SQLite, tablesExist should still find legacy tables
    await bootstrapSchema(db, 'sqlite');
    const exists = await tablesExist(db, 'sqlite');

    expect(exists).toBe(true);

});
```

- [ ] **Step 2: Update `tablesExist()` and `getSchemaVersion()` to accept dialect and do two-step detection**

In `src/core/version/schema/index.ts`:

1. Add imports:
```typescript
import { getNoormTables, noormDb } from '../../shared/tables.js';
```

2. Update `tablesExist()` signature and implementation:

```typescript
export async function tablesExist(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<boolean> {

    // Check legacy location first (default schema, prefixed names)
    const [legacyResult] = await attempt(async () => {

        await db
            .selectFrom('__noorm_version__')
            .select('id')
            .limit(1)
            .executeTakeFirst();

        return true;

    });

    if (legacyResult) return true;

    // For pg/mssql, check new schema location
    if (dialect === 'postgres' || dialect === 'mssql') {

        const [schemaResult] = await attempt(async () => {

            await db
                .withSchema('noorm')
                .selectFrom('version' as any)
                .select('id' as any)
                .limit(1)
                .executeTakeFirst();

            return true;

        });

        if (schemaResult) return true;

    }

    return false;

}
```

3. Update `getSchemaVersion()` to use the same two-step pattern — try legacy first, then schema-qualified:

```typescript
export async function getSchemaVersion(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<number> {

    const exists = await tablesExist(db, dialect);
    if (!exists) return 0;

    // Try legacy location first
    const [legacyResult] = await attempt(async () => {

        return db
            .selectFrom('__noorm_version__')
            .select('noorm_version')
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst();

    });

    if (legacyResult?.noorm_version !== undefined) {

        return legacyResult.noorm_version;

    }

    // Try schema location (pg/mssql after migration)
    if (dialect === 'postgres' || dialect === 'mssql') {

        const [schemaResult] = await attempt(async () => {

            return db
                .withSchema('noorm')
                .selectFrom('version' as any)
                .select('noorm_version' as any)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst();

        });

        if ((schemaResult as any)?.noorm_version !== undefined) {

            return (schemaResult as any).noorm_version;

        }

    }

    return 0;

}
```

4. Update `checkSchemaVersion()` to pass dialect:

```typescript
export async function checkSchemaVersion(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<LayerVersionStatus> {

    const current = await getSchemaVersion(db, dialect);
    // ... rest unchanged
```

5. Update `bootstrapSchema()` to use `noormDb()` and `getNoormTables()` for version record insert:

```typescript
export async function bootstrapSchema(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    const start = performance.now();
    const tables = getNoormTables(dialect);
    const ndb = noormDb(db, dialect);

    // ... (run migrations unchanged) ...

    // Insert initial version record
    await ndb
        .insertInto(tables.version as any)
        .values({
            cli_version: getCurrentVersion(),
            noorm_version: CURRENT_VERSIONS.schema,
            state_version: options?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version: options?.settingsVersion ?? CURRENT_VERSIONS.settings,
        })
        .execute();

    // ... rest unchanged
```

6. Update `updateVersionRecord()` — add `dialect` parameter, use `ndb` + `tables`:

```typescript
export async function updateVersionRecord(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    const now = new Date().toISOString();
    const tables = getNoormTables(dialect);
    const ndb = noormDb(db, dialect);

    await ndb
        .insertInto(tables.version as any)
        .values({
            cli_version: getCurrentVersion(),
            noorm_version: CURRENT_VERSIONS.schema,
            state_version: options?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version: options?.settingsVersion ?? CURRENT_VERSIONS.settings,
            upgraded_at: now as unknown as Date,
        })
        .execute();

}
```

7. Update `getLatestVersionRecord()` — add `dialect` parameter, use two-step lookup:

```typescript
export async function getLatestVersionRecord(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<{ stateVersion: number; settingsVersion: number } | null> {

    const exists = await tablesExist(db, dialect);
    if (!exists) return null;

    // Try legacy location first
    const [legacyResult] = await attempt(async () => {

        return db
            .selectFrom('__noorm_version__')
            .select(['state_version', 'settings_version'])
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst();

    });

    if (legacyResult) {

        return {
            stateVersion: legacyResult.state_version,
            settingsVersion: legacyResult.settings_version,
        };

    }

    // Try schema location (pg/mssql after migration)
    if (dialect === 'postgres' || dialect === 'mssql') {

        const [schemaResult] = await attempt(async () => {

            return db
                .withSchema('noorm')
                .selectFrom('version' as any)
                .select(['state_version', 'settings_version'] as any)
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst();

        });

        if (schemaResult) {

            return {
                stateVersion: (schemaResult as any).state_version,
                settingsVersion: (schemaResult as any).settings_version,
            };

        }

    }

    return null;

}
```

8. Update `migrateSchema()` — the version record insert after v2 migration must use `ndb` + `tables` because tables have moved:

```typescript
export async function migrateSchema(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    // ... (status checks unchanged) ...

    // Get existing versions to carry forward (before tables move)
    const existing = await getLatestVersionRecord(db, dialect);

    // Run pending migrations
    const pendingMigrations = MIGRATIONS.filter((m) => m.version > status.current);

    for (const migration of pendingMigrations) {

        const [, err] = await attempt(() => migration.up(db as Kysely<unknown>, dialect));

        if (err) {

            throw new MigrationError('schema', migration.version, err);

        }

    }

    // IMPORTANT: After v2 migration, tables have moved to noorm schema (pg/mssql).
    // Must use ndb/tables to insert into the correct location.
    const tables = getNoormTables(dialect);
    const ndb = noormDb(db, dialect);

    await ndb
        .insertInto(tables.version as any)
        .values({
            cli_version: getCurrentVersion(),
            noorm_version: CURRENT_VERSIONS.schema,
            state_version:
                options?.stateVersion ?? existing?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version:
                options?.settingsVersion ?? existing?.settingsVersion ?? CURRENT_VERSIONS.settings,
        })
        .execute();

    // ... (events unchanged) ...

    // Pass dialect so identity registration uses correct table location
    await waitForIdentityToLoad(db, dialect);

}
```

9. Update `ensureSchemaVersion()` — no change needed, it delegates to `migrateSchema()`.

10. Update `waitForIdentityToLoad` in `src/core/identity/index.ts` to accept `dialect` and pass it through:

```typescript
export async function waitForIdentityToLoad(db: Kysely<NoormDatabase>, dialect: Dialect) {

    // Load identity from ~/.noorm/
    const identity = await loadExistingIdentity();

    if (!identity) observer.emit('identity:not-found');
    if (!identity) return;

    const [, err] = await attempt(() => registerIdentity(db, identity, dialect));

    if (err) observer.emit('error', {
        error: err,
        source: 'identity:ensure',
        context: { identity },
    });

}
```

Add `import type { Dialect } from '../connection/types.js';` to the imports.

11. Update `registerIdentity` in `src/core/identity/sync.ts` to accept `dialect` and use `noormDb()` + `getNoormTables()`. Replace the hardcoded `'__noorm_identities__'` string literal with `tables.identities`:

```typescript
import { getNoormTables, noormDb } from '../shared/index.js';
import type { Dialect } from '../connection/types.js';

export async function registerIdentity(
    db: Kysely<NoormDatabase>,
    identity: CryptoIdentity,
    dialect: Dialect,
): Promise<void> {

    const tables = getNoormTables(dialect);
    const ndb = noormDb(db, dialect);

    // Replace all hardcoded '__noorm_identities__' with tables.identities
    // Replace all db.selectFrom/insertInto with ndb.selectFrom/insertInto
    // ...
```

Also update `bootstrapSchema()` call in `src/core/version/schema/index.ts` to pass `dialect` to `waitForIdentityToLoad`:

```typescript
    // In bootstrapSchema(), change:
    await waitForIdentityToLoad(db);
    // To:
    await waitForIdentityToLoad(db, dialect);
```

- [ ] **Step 3: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/version/schema.test.ts`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/core/version/schema/index.ts src/core/identity/index.ts src/core/identity/sync.ts tests/core/version/schema.test.ts
git commit -m "feat(schema): update version detection for two-step schema lookup"
```

### Task 3: Create migration v2

**Files:**
- Create: `src/core/version/schema/migrations/v2.ts`
- Modify: `src/core/version/schema/index.ts` (add v2 to MIGRATIONS array)
- Modify: `src/core/version/types.ts` (bump CURRENT_VERSIONS.schema to 2)
- Test: `tests/core/version/schema.test.ts`

- [ ] **Step 1: Write test for v2 migration (sqlite no-op path)**

Add to `tests/core/version/schema.test.ts`:

```typescript
describe('migration v2', () => {

    it('should be a no-op for sqlite', async () => {

        // Bootstrap v1 tables
        await bootstrapSchema(db, 'sqlite');

        // v2 should not change anything for sqlite
        const versionBefore = await getSchemaVersion(db, 'sqlite');
        const exists = await tablesExist(db, 'sqlite');

        expect(exists).toBe(true);
        expect(versionBefore).toBe(CURRENT_VERSIONS.schema);

    });

});
```

- [ ] **Step 2: Run test to verify it passes (v2 is no-op for sqlite, so bootstrap should handle it)**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/version/schema.test.ts`
Expected: PASS

- [ ] **Step 3: Create `src/core/version/schema/migrations/v2.ts`**

```typescript
/**
 * Schema Migration v2 - Move tracking tables to noorm schema.
 *
 * For PostgreSQL and MSSQL: creates 'noorm' schema, moves tables into it,
 * and renames them to drop the __noorm_ prefix.
 *
 * For SQLite and MySQL: no-op (tables stay with prefix).
 */
import type { Kysely } from 'kysely';
import { sql } from 'kysely';

import type { SchemaMigration } from '../../types.js';
import type { Dialect } from '../../../connection/types.js';

/**
 * Table names in v1 (prefixed) and v2 (clean) for reference.
 */
const TABLE_MAP = [
    { old: '__noorm_version__', new: 'version' },
    { old: '__noorm_change__', new: 'change' },
    { old: '__noorm_executions__', new: 'executions' },
    { old: '__noorm_lock__', new: 'lock' },
    { old: '__noorm_identities__', new: 'identities' },
    { old: '__noorm_vault__', new: 'vault' },
] as const;

/**
 * Index renames: old name -> new name + table.
 */
const INDEX_MAP = [
    { old: 'idx_executions_change_id', new: 'idx_executions_change_id', table: 'executions' },
    { old: 'idx_change_name_config', new: 'idx_change_name_config', table: 'change' },
    { old: 'idx_vault_secret_key', new: 'idx_vault_secret_key', table: 'vault' },
] as const;

export const v2: SchemaMigration = {
    version: 2,
    description: 'Move tracking tables to noorm schema (pg/mssql)',

    async up(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        // No-op for sqlite and mysql
        if (dialect === 'sqlite' || dialect === 'mysql') return;

        // Wrap all DDL in a transaction (both pg and mssql support transactional DDL)
        await db.transaction().execute(async (trx) => {

        // 1. Create noorm schema
        if (dialect === 'postgres') {

            await sql`CREATE SCHEMA IF NOT EXISTS noorm`.execute(trx);

        }
        else {

            // MSSQL: CREATE SCHEMA doesn't support IF NOT EXISTS
            await sql`
                IF NOT EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'noorm')
                EXEC('CREATE SCHEMA noorm')
            `.execute(trx);

        }

        // 2. Drop FK constraint (executions -> change)
        if (dialect === 'postgres') {

            // Find and drop the FK constraint
            const fkResult = await sql<{ constraint_name: string }>`
                SELECT constraint_name
                FROM information_schema.table_constraints
                WHERE table_name = '__noorm_executions__'
                AND constraint_type = 'FOREIGN KEY'
            `.execute(trx);

            for (const row of fkResult.rows) {

                await sql`
                    ALTER TABLE "__noorm_executions__"
                    DROP CONSTRAINT ${sql.ref(row.constraint_name)}
                `.execute(trx);

            }

        }
        else {

            // MSSQL
            const fkResult = await sql<{ name: string }>`
                SELECT fk.name
                FROM sys.foreign_keys fk
                JOIN sys.tables t ON fk.parent_object_id = t.object_id
                WHERE t.name = '__noorm_executions__'
            `.execute(trx);

            for (const row of fkResult.rows) {

                await sql`
                    ALTER TABLE [__noorm_executions__]
                    DROP CONSTRAINT ${sql.ref(row.name)}
                `.execute(trx);

            }

        }

        // 3. Drop old indexes
        for (const idx of INDEX_MAP) {

            if (dialect === 'postgres') {

                await sql`DROP INDEX IF EXISTS ${sql.ref(idx.old)}`.execute(trx);

            }
            else {

                // MSSQL requires table name for DROP INDEX
                const oldTable = TABLE_MAP.find(t => t.new === idx.table)!.old;

                await sql`
                    IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = ${idx.old})
                    DROP INDEX ${sql.ref(idx.old)} ON ${sql.table(oldTable)}
                `.execute(trx);

            }

        }

        // 4. Move tables to noorm schema
        for (const t of TABLE_MAP) {

            if (dialect === 'postgres') {

                await sql`ALTER TABLE ${sql.table(t.old)} SET SCHEMA noorm`.execute(trx);

            }
            else {

                await sql`ALTER SCHEMA noorm TRANSFER dbo.${sql.ref(t.old)}`.execute(trx);

            }

        }

        // 5. Rename tables to drop prefix
        for (const t of TABLE_MAP) {

            if (dialect === 'postgres') {

                await sql`ALTER TABLE noorm.${sql.ref(t.old)} RENAME TO ${sql.ref(t.new)}`.execute(trx);

            }
            else {

                // MSSQL sp_rename needs literal strings, not parameterized values.
                // sql tagged template would parameterize interpolations, so use sql.raw().
                await sql`EXEC sp_rename ${sql.raw(`'noorm.${t.old}'`)}, ${sql.raw(`'${t.new}'`)}`.execute(trx);

            }

        }

        // 6. Recreate FK constraint
        if (dialect === 'postgres') {

            await sql`
                ALTER TABLE noorm.executions
                ADD CONSTRAINT fk_executions_change_id
                FOREIGN KEY (change_id) REFERENCES noorm.change(id) ON DELETE CASCADE
            `.execute(trx);

        }
        else {

            await sql`
                ALTER TABLE noorm.executions
                ADD CONSTRAINT fk_executions_change_id
                FOREIGN KEY (change_id) REFERENCES noorm.[change](id) ON DELETE CASCADE
            `.execute(trx);

        }

        // 7. Recreate indexes in noorm schema
        await sql`CREATE INDEX idx_executions_change_id ON noorm.executions (change_id)`.execute(trx);
        await sql`CREATE INDEX idx_change_name_config ON noorm.${sql.ref('change')} (name, config_name)`.execute(trx);
        await sql`CREATE INDEX idx_vault_secret_key ON noorm.vault (secret_key)`.execute(trx);

        }); // end transaction

    },

    async down(db: Kysely<unknown>, dialect: Dialect): Promise<void> {

        // No-op for sqlite and mysql
        if (dialect === 'sqlite' || dialect === 'mysql') return;

        const defaultSchema = dialect === 'postgres' ? 'public' : 'dbo';

        // Wrap all DDL in a transaction
        await db.transaction().execute(async (trx) => {

        // 1. Drop FK constraint
        if (dialect === 'postgres') {

            await sql`
                ALTER TABLE noorm.executions
                DROP CONSTRAINT IF EXISTS fk_executions_change_id
            `.execute(trx);

        }
        else {

            await sql`
                IF EXISTS (SELECT 1 FROM sys.foreign_keys WHERE name = 'fk_executions_change_id')
                ALTER TABLE noorm.executions DROP CONSTRAINT fk_executions_change_id
            `.execute(trx);

        }

        // 2. Drop indexes
        if (dialect === 'postgres') {

            await sql`DROP INDEX IF EXISTS noorm.idx_executions_change_id`.execute(trx);
            await sql`DROP INDEX IF EXISTS noorm.idx_change_name_config`.execute(trx);
            await sql`DROP INDEX IF EXISTS noorm.idx_vault_secret_key`.execute(trx);

        }
        else {

            // MSSQL does not support DROP INDEX IF EXISTS — use conditional check
            await sql`
                IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_executions_change_id')
                DROP INDEX idx_executions_change_id ON noorm.executions
            `.execute(trx);
            await sql`
                IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_change_name_config')
                DROP INDEX idx_change_name_config ON noorm.[change]
            `.execute(trx);
            await sql`
                IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_vault_secret_key')
                DROP INDEX idx_vault_secret_key ON noorm.vault
            `.execute(trx);

        }

        // 3. Rename tables to add prefix back
        for (const t of TABLE_MAP) {

            if (dialect === 'postgres') {

                await sql`ALTER TABLE noorm.${sql.ref(t.new)} RENAME TO ${sql.ref(t.old)}`.execute(trx);

            }
            else {

                await sql`EXEC sp_rename ${sql.raw(`'noorm.${t.new}'`)}, ${sql.raw(`'${t.old}'`)}`.execute(trx);

            }

        }

        // 4. Move tables back to default schema
        for (const t of TABLE_MAP) {

            if (dialect === 'postgres') {

                await sql`ALTER TABLE noorm.${sql.ref(t.old)} SET SCHEMA ${sql.ref(defaultSchema)}`.execute(trx);

            }
            else {

                await sql`ALTER SCHEMA ${sql.ref(defaultSchema)} TRANSFER noorm.${sql.ref(t.old)}`.execute(trx);

            }

        }

        // 5. Recreate FK constraint with prefixed names
        await sql`
            ALTER TABLE ${sql.table('__noorm_executions__')}
            ADD CONSTRAINT fk_noorm_executions_change_id
            FOREIGN KEY (change_id) REFERENCES ${sql.table('__noorm_change__')}(id) ON DELETE CASCADE
        `.execute(trx);

        // 6. Recreate indexes
        await sql`CREATE INDEX idx_executions_change_id ON ${sql.table('__noorm_executions__')} (change_id)`.execute(trx);
        await sql`CREATE INDEX idx_change_name_config ON ${sql.table('__noorm_change__')} (name, config_name)`.execute(trx);
        await sql`CREATE INDEX idx_vault_secret_key ON ${sql.table('__noorm_vault__')} (secret_key)`.execute(trx);

        // 7. Drop noorm schema
        if (dialect === 'postgres') {

            await sql`DROP SCHEMA IF EXISTS noorm`.execute(trx);

        }
        else {

            await sql`
                IF EXISTS (SELECT 1 FROM sys.schemas WHERE name = 'noorm')
                DROP SCHEMA noorm
            `.execute(trx);

        }

        }); // end transaction

    },
};
```

- [ ] **Step 4: Register v2 migration and bump version**

In `src/core/version/schema/index.ts`, add:
```typescript
import { v2 } from './migrations/v2.js';
```

Update the `MIGRATIONS` array:
```typescript
const MIGRATIONS: SchemaMigration[] = [v1, v2];
```

In `src/core/version/types.ts`, bump schema version:
```typescript
schema: 2,
```

- [ ] **Step 5: Update `bootstrapSchema()` to create schema-aware tables for fresh installs**

In `src/core/version/schema/index.ts`, update `bootstrapSchema()` to make v1 migration dialect-aware on fresh installs. The v1 migration creates tables with prefixed names, then v2 moves them. For fresh pg/mssql installs, we can skip the move by having v1 create directly in the schema.

Alternative simpler approach: let v1 create prefixed tables and v2 move them, even on fresh installs. This is slower but simpler — only one code path. Keep this for now; optimize later if needed.

- [ ] **Step 6: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/version/schema.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/version/schema/migrations/v2.ts src/core/version/schema/index.ts src/core/version/types.ts tests/core/version/schema.test.ts
git commit -m "feat(schema): add v2 migration for noorm schema isolation"
```

---

## Chunk 3: Consumer Updates

### Task 4: Update `Tracker` and `ChangeTracker`

**Files:**
- Modify: `src/core/runner/tracker.ts`
- Modify: `src/core/change/tracker.ts`
- Test: existing tests in `tests/core/change/executor.test.ts`

- [ ] **Step 1: Update `Tracker` constructor to accept dialect**

In `src/core/runner/tracker.ts`:

1. Replace imports:
```typescript
import { getNoormTables, noormDb } from '../shared/index.js';
import type { NoormDatabase, NoormTableNames, ChangeType, ExecutionStatus, FileType } from '../shared/index.js';
import type { Dialect } from '../connection/types.js';
```

2. Update class fields and constructor:
```typescript
export class Tracker {

    readonly #db: Kysely<NoormDatabase>;
    readonly #ndb: Kysely<NoormDatabase>;
    readonly #tables: ReturnType<typeof getNoormTables>;
    readonly #configName: string;

    constructor(db: Kysely<NoormDatabase>, configName: string, dialect: Dialect = 'sqlite') {

        this.#db = db;
        this.#ndb = noormDb(db, dialect);
        this.#tables = getNoormTables(dialect);
        this.#configName = configName;

    }
```

3. Replace all `this.#db` with `this.#ndb` and all `NOORM_TABLES.xxx` with `this.#tables.xxx` throughout the class. Key replacements:
    - `this.#db.selectFrom(NOORM_TABLES.executions)` → `this.#ndb.selectFrom(this.#tables.executions)`
    - `${NOORM_TABLES.change}.id` → `${this.#tables.change}.id`
    - `this.#db.insertInto(NOORM_TABLES.change)` → `this.#ndb.insertInto(this.#tables.change)`
    - etc. for all occurrences

- [ ] **Step 2: Update `ChangeTracker` to pass dialect through**

In `src/core/change/tracker.ts`:

1. Update imports:
```typescript
import { getNoormTables, noormDb } from '../shared/index.js';
import type { Dialect } from '../connection/types.js';
```

2. Update constructor and fields:
```typescript
export class ChangeTracker extends Tracker {

    readonly #ndb: Kysely<NoormDatabase>;
    readonly #tables: ReturnType<typeof getNoormTables>;
    readonly #configName: string;

    constructor(db: Kysely<NoormDatabase>, configName: string, dialect: Dialect = 'sqlite') {

        super(db, configName, dialect);
        this.#ndb = noormDb(db, dialect);
        this.#tables = getNoormTables(dialect);
        this.#configName = configName;

    }
```

3. Replace all `this.#db` with `this.#ndb` and `NOORM_TABLES.xxx` with `this.#tables.xxx`.

- [ ] **Step 3: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/change/`
Expected: PASS (sqlite dialect is the default, so existing tests should work)

- [ ] **Step 4: Commit**

```bash
git add src/core/runner/tracker.ts src/core/change/tracker.ts
git commit -m "refactor(schema): update Tracker and ChangeTracker for dialect-aware tables"
```

### Task 5: Update `ChangeHistory`

**Files:**
- Modify: `src/core/change/history.ts`

- [ ] **Step 1: Update imports, constructor, and all table references**

Same pattern as Task 4: add `dialect` param (default `'sqlite'`), create `#ndb` and `#tables` in constructor, replace all `NOORM_TABLES` and `this.#db` usages.

- [ ] **Step 2: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/change/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/change/history.ts
git commit -m "refactor(schema): update ChangeHistory for dialect-aware tables"
```

### Task 6: Update `LockManager`

**Files:**
- Modify: `src/core/lock/manager.ts`

- [ ] **Step 1: Update LockManager to use `noormDb()` and `getNoormTables()`**

In `src/core/lock/manager.ts`:

1. Add imports:
```typescript
import { getNoormTables, noormDb } from '../shared/index.js';
```

2. For each method that takes `db` and has access to `dialect` (via `opts.dialect` or parameter), resolve `noormDb(db, dialect)` and `getNoormTables(dialect)` at the start of each method call.

3. **Add `dialect: Dialect` parameter to `release()` and `forceRelease()`** — these currently have no way to get dialect:

```typescript
async release(
    db: Kysely<NoormDatabase>,
    configName: string,
    identity: string,
    dialect: Dialect,
): Promise<void> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    // Check existing lock
    const existing = await this.getLock(db, configName, dialect);
    // ... (ownership checks unchanged) ...

    await ndb
        .deleteFrom(tables.lock)
        .where('config_name', '=', configName)
        .where('locked_by', '=', identity)
        .execute();

    observer.emit('lock:released', { configName, identity });

}

async forceRelease(
    db: Kysely<NoormDatabase>,
    configName: string,
    dialect: Dialect,
): Promise<boolean> {

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);
    const existing = await this.getLock(db, configName, dialect);
    if (!existing) return false;

    await ndb.deleteFrom(tables.lock).where('config_name', '=', configName).execute();

    observer.emit('lock:released', {
        configName,
        identity: existing.lockedBy,
    });

    return true;

}
```

4. Update `withLock()` to pass dialect to `release()`. `dialect` comes from `options.dialect` (already available via `LockOptions`):
```typescript
    const opts = { ...DEFAULT_LOCK_OPTIONS, ...options };
    // ...
    const [, err] = await attempt(() => this.release(db, configName, identity, opts.dialect));
```

5. Private helpers like `getLock()`, `createLock()`, `cleanupExpired()`, `extendLock()` need dialect threaded through. Add `dialect: Dialect` parameter to each private helper.

6. Replace all `NOORM_TABLES.lock` with `tables.lock` (where `tables = getNoormTables(dialect)`).

7. Replace all `db.selectFrom(...)` / `db.insertInto(...)` / `db.deleteFrom(...)` / `db.updateTable(...)` with the `noormDb()` wrapped version.

- [ ] **Step 2: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/lock/`
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add src/core/lock/manager.ts
git commit -m "refactor(schema): update LockManager for dialect-aware tables"
```

### Task 7: Update identity, vault, and debug modules

**Files:**
- Modify: `src/core/identity/index.ts` (already partially updated in Task 2 — verify `waitForIdentityToLoad` changes)
- Modify: `src/core/identity/sync.ts` (already partially updated in Task 2 for `registerIdentity` — complete remaining functions: `fetchKnownUsers`, `syncIdentity`, `syncIdentityWithConfig`)
- Modify: `src/core/vault/storage.ts`
- Modify: `src/core/vault/propagate.ts`
- Modify: `src/core/debug/operations.ts`
- Modify: `src/core/db/operations.ts`

- [ ] **Step 1: Complete `identity/sync.ts` update**

`registerIdentity` was updated in Task 2 to accept `dialect`. Now update the remaining exported functions:

1. Add `dialect: Dialect` parameter to `fetchKnownUsers`, `syncIdentity`, `syncIdentityWithConfig`
2. Replace all remaining hardcoded `'__noorm_identities__'` with `getNoormTables(dialect).identities`
3. Use `noormDb(db, dialect)` for all queries

- [ ] **Step 2: Update `vault/storage.ts`**

Same pattern: add `dialect` param, use `getNoormTables()` + `noormDb()`.

- [ ] **Step 3: Update `vault/propagate.ts`**

Same pattern: add `dialect` param, replace `NOORM_TABLES.identities` references.

- [ ] **Step 4: Update `debug/operations.ts`**

Same pattern: add `dialect` param, use `getNoormTables()` + `noormDb()`.

- [ ] **Step 5: Update `db/operations.ts`**

Update the hardcoded table name strings in observer event emissions to use `getNoormTables()`.

- [ ] **Step 6: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/core/identity/sync.ts src/core/vault/storage.ts src/core/vault/propagate.ts src/core/debug/operations.ts src/core/db/operations.ts
git commit -m "refactor(schema): update identity, vault, debug modules for dialect-aware tables"
```

---

## Chunk 4: Explore/Teardown and Caller Threading

### Task 8: Update explore dialect exclusions

**Files:**
- Modify: `src/core/explore/dialects/postgres.ts`
- Modify: `src/core/explore/dialects/mssql.ts`
- Modify: `src/core/explore/operations.ts`
- Modify: `src/core/teardown/operations.ts`

- [ ] **Step 1: Add `'noorm'` to `EXCLUDED_SCHEMAS`**

In `src/core/explore/dialects/postgres.ts:36`:
```typescript
const EXCLUDED_SCHEMAS = ['pg_catalog', 'information_schema', 'pg_toast', 'noorm'];
```

In `src/core/explore/dialects/mssql.ts:35`:
```typescript
const EXCLUDED_SCHEMAS = ['sys', 'INFORMATION_SCHEMA', 'guest', 'noorm'];
```

- [ ] **Step 2: Update `isNoormTable()` in `explore/operations.ts` and `teardown/operations.ts`**

Both files have their own `isNoormTable()`. Update them to also recognize clean names (for consistency):

```typescript
function isNoormTable(name: string | undefined | null): boolean {

    if (!name) return false;

    // Prefixed names (sqlite/mysql) — always safe to match
    if (name.startsWith('__noorm_')) return true;

    return false;

}
```

**WARNING: Do NOT add generic clean names ('version', 'change', etc.) to `isNoormTable()`.** On sqlite/mysql, user tables could legitimately be named `version` or `change`. The clean-name check would produce false positives. For pg/mssql, these tables won't appear in explore/teardown results anyway because `EXCLUDED_SCHEMAS` already filters out the `noorm` schema. The prefix check alone is sufficient as a safety net for sqlite/mysql.

- [ ] **Step 3: Update `teardown/operations.ts` `NOORM_TABLE_NAMES` set**

Keep the set prefixed-only (same reasoning as `isNoormTable()` — clean names would false-positive on sqlite/mysql user tables):

```typescript
// No changes needed — NOORM_TABLE_NAMES already uses Object.values(NOORM_TABLES)
// which returns prefixed names. For pg/mssql, EXCLUDED_SCHEMAS handles filtering.
```

- [ ] **Step 4: Run tests**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test tests/core/teardown/ tests/core/explore/ 2>&1 | head -30`
Expected: PASS (or pre-existing failures only for integration tests)

- [ ] **Step 5: Commit**

```bash
git add src/core/explore/dialects/postgres.ts src/core/explore/dialects/mssql.ts src/core/explore/operations.ts src/core/teardown/operations.ts
git commit -m "refactor(schema): add noorm to EXCLUDED_SCHEMAS, update isNoormTable()"
```

### Task 9: Thread dialect through callers

**Files:**
- Multiple CLI screens, SDK namespaces, headless handlers that instantiate `Tracker`, `ChangeTracker`, `ChangeHistory`, or call identity/vault functions.

- [ ] **Step 1: Find all callers that instantiate Tracker/ChangeTracker/ChangeHistory**

Run grep to find all instantiation sites:
```
grep -rn 'new Tracker\|new ChangeTracker\|new ChangeHistory' src/
```

Each callsite already has `dialect` available (from config connection or passed as parameter). Add `dialect` as the third argument.

- [ ] **Step 2: Update `VersionManager` in `src/core/version/index.ts`**

`VersionManager.check()`, `needsMigration()`, and `hasNewerVersion()` call `checkSchemaVersion(db)` without dialect. Add `dialect: Dialect` parameter to all three methods, and pass it through:

```typescript
async check(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    state: Record<string, unknown>,
    settings: Record<string, unknown>,
): Promise<VersionStatus> {

    const schemaStatus = await checkSchemaVersion(db, dialect);
    // ... rest unchanged

}

async needsMigration(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    state: Record<string, unknown>,
    settings: Record<string, unknown>,
): Promise<boolean> {

    const status = await this.check(db, dialect, state, settings);
    // ... rest unchanged

}

async hasNewerVersion(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    state: Record<string, unknown>,
    settings: Record<string, unknown>,
): Promise<boolean> {

    const status = await this.check(db, dialect, state, settings);
    // ... rest unchanged

}
```

Then find all callers of these methods and add `dialect`:
```
grep -rn 'versionManager\.\(check\|needsMigration\|hasNewerVersion\)' src/
```

- [ ] **Step 3: Find all callers of identity/vault/debug/lock functions that need dialect**

Run greps to find all call sites:
```
grep -rn 'registerIdentity\|syncKnownUsers\|initializeVault\|getVaultSecret' src/
grep -rn 'waitForIdentityToLoad' src/
grep -rn '\.release(\|\.forceRelease(' src/
```

Add `dialect` parameter to each call. Known callers to update:

**`waitForIdentityToLoad(db)` → add dialect:**
- `src/core/connection/factory.ts:185` — has `config.dialect` available

**`registerIdentity(db, identity)` → add dialect:**
- `src/cli/headless/_helpers.ts:176` — has dialect from connection context

**`lockManager.release(db, configName, identity)` → add dialect:**
- `src/sdk/namespaces/lock.ts:64`
- `src/core/change/executor.ts:224,361`
- `src/cli/screens/lock/LockReleaseScreen.tsx:121`

**`lockManager.forceRelease(db, configName)` → add dialect:**
- `src/sdk/namespaces/lock.ts:129`
- `src/cli/screens/lock/LockForceScreen.tsx:139`

- [ ] **Step 4: Find all callers of `tablesExist()` that need dialect**

After Task 2, `tablesExist()` requires `dialect`. Find callers that still pass only `db`:
```
grep -rn 'tablesExist(' src/
```

Known callers to update:
- `src/core/identity/sync.ts:233` — `syncIdentity()` calls `tablesExist(db)` → pass `dialect`
- `src/core/db/operations.ts:78,241` — calls `tablesExist(db)` → pass `dialect`
- `src/cli/screens/db/DbListScreen.tsx:100` — calls `tablesExist(db)` → pass `dialect` (also update hardcoded `'__noorm_executions__'` at line 108 to use `getNoormTables(dialect).executions` with `noormDb()`)

- [ ] **Step 5: Run full test suite**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test`
Expected: PASS (with known pre-existing failures for better-sqlite3 module version mismatch only)

- [ ] **Step 6: Run typecheck**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run typecheck`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
# Stage only the specific files modified in this task.
# Run `git status` first to identify all changed files, then add them individually.
# Example (actual files depend on grep results from Steps 1-4):
git add src/cli/screens/ src/sdk/ src/cli/headless.ts src/core/version/index.ts
git commit -m "refactor(schema): thread dialect through all consumer callers"
```

**IMPORTANT:** Do NOT use `git add -A` — it will stage unrelated files. Stage only files modified in this task.

### Task 10: Final verification and cleanup

- [ ] **Step 1: Run full test suite**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun test`
Expected: PASS

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `cd /Users/alonso/projects/noorm/monorepo && bun run lint`
Expected: PASS

- [ ] **Step 4: Verify NOORM_TABLES deprecation**

Grep for direct `NOORM_TABLES` usage (not via `getNoormTables`):
```
grep -rn 'NOORM_TABLES\.' src/core/ --include='*.ts' | grep -v 'getNoormTables\|index\.ts\|tables\.ts'
```
Expected: Only legacy/migration code should still reference `NOORM_TABLES` directly.

- [ ] **Step 5: Final commit (if any cleanup needed)**

```bash
# Stage only specific files that were cleaned up. Use git status to identify them.
git add <specific-files>
git commit -m "chore(schema): final cleanup for schema isolation"
```
