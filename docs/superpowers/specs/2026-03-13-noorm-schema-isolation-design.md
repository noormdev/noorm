# noorm Schema Isolation Design


## Problem

noorm's 6 internal tables (`__noorm_version__`, `__noorm_change__`, `__noorm_executions__`, `__noorm_lock__`, `__noorm_identities__`, `__noorm_vault__`) live in the same database and default schema as user tables. This causes:

1. **Clutter** -- users see noorm tables in GUI tools and `information_schema` queries
2. **Brittle filtering** -- explore, teardown, and UI code must check `isNoormTable()` everywhere to hide/preserve them
3. **Safety risk** -- users can accidentally drop/truncate noorm tables, and noorm operations could theoretically touch user tables


## Decision

Move noorm tables into a dedicated `noorm` schema for PostgreSQL and MSSQL. Keep the `__noorm_` prefix approach for SQLite and MySQL (no schema support / schema=database).

| Dialect | Strategy | Table Names |
|---------|----------|-------------|
| PostgreSQL | `noorm` schema | `noorm.version`, `noorm.change`, `noorm.executions`, `noorm.lock`, `noorm.identities`, `noorm.vault` |
| MSSQL | `noorm` schema | Same as PostgreSQL |
| MySQL | `__noorm_` prefix | `__noorm_version__`, `__noorm_change__`, etc. (unchanged) |
| SQLite | `__noorm_` prefix | `__noorm_version__`, `__noorm_change__`, etc. (unchanged) |

Auto-migration moves existing legacy tables into the schema on first connect for pg/mssql.


## Type System


### Intersection Interface

Kysely's type system ties table names to interface keys. Since pg/mssql use clean names (`change`) and sqlite/mysql use prefixed names (`__noorm_change__`), the `NoormDatabase` interface uses an intersection of both:

```typescript
interface NoormSchemaDb {
    version: NoormVersionTable;
    change: NoormChangeTable;
    executions: NoormExecutionsTable;
    lock: NoormLockTable;
    identities: NoormIdentitiesTable;
    vault: NoormVaultTable;
}

interface NoormPrefixDb {
    __noorm_version__: NoormVersionTable;
    __noorm_change__: NoormChangeTable;
    __noorm_executions__: NoormExecutionsTable;
    __noorm_lock__: NoormLockTable;
    __noorm_identities__: NoormIdentitiesTable;
    __noorm_vault__: NoormVaultTable;
}

type NoormDatabase = NoormSchemaDb & NoormPrefixDb;
```

Both `selectFrom('change')` and `selectFrom('__noorm_change__')` type-check. The correct one is chosen at runtime via `getNoormTables(dialect)`.

**Footgun warning:** With `db.withSchema('noorm')`, calling `selectFrom('__noorm_change__')` would produce `noorm.__noorm_change__` which does not exist. Consumers must only use values from `getNoormTables(dialect)` and never import the deprecated `NOORM_TABLES` constant for new code. The old constant gets a `@deprecated` JSDoc annotation.


## Core API


### `getNoormTables(dialect)`

Returns dialect-appropriate table name constants. Replaces the static `NOORM_TABLES` object.

```typescript
function getNoormTables(dialect: Dialect) {
    if (dialect === 'postgres' || dialect === 'mssql') {
        return {
            version: 'version',
            change: 'change',
            executions: 'executions',
            lock: 'lock',
            identities: 'identities',
            vault: 'vault',
        } as const;
    }
    return {
        version: '__noorm_version__',
        change: '__noorm_change__',
        executions: '__noorm_executions__',
        lock: '__noorm_lock__',
        identities: '__noorm_identities__',
        vault: '__noorm_vault__',
    } as const;
}
```


### `noormDb(db, dialect)`

Returns a Kysely instance scoped to the `noorm` schema for pg/mssql, or the plain instance for sqlite/mysql.

```typescript
function noormDb(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Kysely<NoormDatabase> {
    if (dialect === 'postgres' || dialect === 'mssql') {
        return db.withSchema('noorm');
    }
    return db;
}
```


### Consumer Pattern

All modules resolve db and table names once (constructor or function entry), then use them throughout:

```typescript
// Before
this.#db.selectFrom(NOORM_TABLES.change)...

// After
this.#ndb.selectFrom(this.#tables.change)...
```

**Join column references:** String-interpolated column references like `` `${tables.change}.id` `` in `innerJoin()` and `eb.ref()` calls need verification against actual pg/mssql databases with the `noorm` schema. Kysely's `withSchema` may not automatically prefix table names embedded in string literals. If it does not, switch to Kysely's expression builder API for joins.


## Migration v2


### Existing Databases (pg/mssql)

The migration must handle foreign key constraints and indexes carefully. Order of operations:

1. `CREATE SCHEMA IF NOT EXISTS noorm`
2. Drop FK constraint from `__noorm_executions__` referencing `__noorm_change__`
3. Move each table to the `noorm` schema:
    - PostgreSQL: `ALTER TABLE __noorm_change__ SET SCHEMA noorm`
    - MSSQL: `ALTER SCHEMA noorm TRANSFER dbo.__noorm_change__`
4. Rename tables to drop prefix:
    - PostgreSQL: `ALTER TABLE noorm.__noorm_change__ RENAME TO change`
    - MSSQL: `EXEC sp_rename 'noorm.__noorm_change__', 'change'`
5. Recreate FK constraint: `noorm.executions.change_id` references `noorm.change.id` with cascade delete
6. Drop old indexes and recreate with updated names in the `noorm` schema

Wrap all DDL steps in a transaction where possible (PostgreSQL and MSSQL both support transactional DDL) to avoid partial migration states.


### Existing Databases (sqlite/mysql)

No-op. Tables stay as-is.


### Fresh Installs

- pg/mssql: `CREATE SCHEMA noorm` + create tables with clean names inside the schema (using `db.schema.withSchema('noorm').createTable(...)`)
- sqlite/mysql: create tables with `__noorm_*` prefix (same as v1)

`bootstrapSchema()` becomes dialect-aware so fresh installs create the right structure directly without running v1 then v2.

`CURRENT_VERSIONS.schema` increments from `1` to `2`.


### Version Detection Bootstrap Order

The migration system itself queries `__noorm_version__` to determine the current schema version. After migration, this table moves to `noorm.version`. To avoid a chicken-and-egg problem:

1. `tablesExist()` first checks legacy location (`__noorm_version__` in default schema) via raw SQL
2. If not found, checks new location (`noorm.version`) via raw SQL
3. `getSchemaVersion()` follows the same two-step check
4. v2 migration only runs if legacy tables are found in the default schema
5. After migration, subsequent calls resolve to the new schema path


### Rollback (down)

The v2 `down` migration reverses the process:

1. Drop FK constraint from `noorm.executions`
2. Rename tables to re-add prefix: `noorm.change` -> `noorm.__noorm_change__`
3. Move tables back to default schema: `ALTER TABLE noorm.__noorm_change__ SET SCHEMA public` (postgres) / `ALTER SCHEMA dbo TRANSFER noorm.__noorm_change__` (mssql)
4. Recreate FK constraint with prefixed names
5. Recreate indexes with original names
6. `DROP SCHEMA noorm` (if empty)


## Explore & Teardown Simplification


### Explore

- pg/mssql: add `'noorm'` to `EXCLUDED_SCHEMAS` in `src/core/explore/dialects/postgres.ts` and `src/core/explore/dialects/mssql.ts`. The explore queries filter by `schema NOT IN (EXCLUDED_SCHEMAS)`, so this explicitly hides noorm tables. No `isNoormTable()` needed.
- sqlite/mysql: `isNoormTable()` prefix check stays as-is.
- `includeNoormTables` option queries the `noorm` schema explicitly when needed (overrides the exclusion).


### Teardown

- pg/mssql: teardown operates on the default schema. With `noorm` in `EXCLUDED_SCHEMAS`, noorm tables are excluded from the objects list. No `isNoormTable()` checks needed.
- sqlite/mysql: preservation logic stays as-is.
- New `includeNoormSchema: true` option enables `DROP SCHEMA noorm CASCADE` for full uninstall.


### What Gets Simplified

- `isNoormTable()` checks in explore/teardown only needed for sqlite/mysql
- `includeNoormTables: true` on `fetchList()` calls in teardown unnecessary for pg/mssql
- UI "(system)" markers not needed for pg/mssql


## Consumer Impact

Modules that need updates:

| Module | Change |
|--------|--------|
| `Tracker` | Add `dialect` to constructor, replace `NOORM_TABLES` with `getNoormTables()`, use `noormDb()` |
| `ChangeTracker` | Inherits from Tracker, pass `dialect` through |
| `ChangeHistory` | Add `dialect` to constructor, same pattern |
| `vault/storage.ts` | Add `dialect` to functions, replace hardcoded `'__noorm_identities__'` and `'__noorm_vault__'` literals |
| `vault/propagate.ts` | Add `dialect` to functions, replace `NOORM_TABLES.identities` references (lines 48, 101, 127, 151, 191, 211) |
| `identity/sync.ts` | Add `dialect` to functions, replace hardcoded `'__noorm_identities__'` string literals (lines 62, 88, 117, 172, 268) |
| `debug/operations.ts` | Add `dialect` to functions, use `getNoormTables()` |
| `LockManager` | Already has `dialect` -- update to use `noormDb()` and `getNoormTables()` |
| `version/schema/index.ts` | Already has `dialect` -- replace hardcoded `'__noorm_version__'` string literals (lines 55, 85, 171, 217, 335), update `tablesExist()` for two-step detection |
| `explore/dialects/postgres.ts` | Add `'noorm'` to `EXCLUDED_SCHEMAS` |
| `explore/dialects/mssql.ts` | Add `'noorm'` to `EXCLUDED_SCHEMAS` |
| `teardown/operations.ts` | Update `isNoormTable()` and `NOORM_TABLE_NAMES` to handle both naming schemes |
| `NoormTableName` type | Update to union of both clean and prefixed name literals |

All callers (CLI screens, SDK namespaces, headless handlers) already have `dialect` available from the active config connection. Threading it through is mechanical.

Each consumer resolves `noormDb()` and `getNoormTables()` once in the constructor, storing them as private fields (`this.#ndb`, `this.#tables`).


### Hardcoded String Literals

Several modules bypass `NOORM_TABLES` and use hardcoded table name strings. These must all be updated:

- `version/schema/index.ts`: `'__noorm_version__'` in `tablesExist()`, `getSchemaVersion()`, `bootstrapSchema()`, `updateVersionRecord()`, `migrateSchema()`
- `identity/sync.ts`: `'__noorm_identities__'` throughout
- `db/operations.ts`: hardcoded table name strings in observer event emission (cosmetic but displays stale names after migration)
- Raw SQL queries using `LIMIT 1` (e.g., `tablesExist()`) should switch to Kysely query builder for MSSQL portability (`LIMIT` is not valid MSSQL -- uses `TOP`)


## Legacy Compatibility

The old `NOORM_TABLES` constant stays exported with `@deprecated` JSDoc annotation. It maps to the prefixed names and is used only for:

- Auto-migration detection (checking if legacy tables exist in the default schema)
- sqlite/mysql paths via `getNoormTables()` (which returns the same values)

New code must use `getNoormTables(dialect)` exclusively.
