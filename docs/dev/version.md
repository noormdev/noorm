# Version


## The Problem

Software evolves. Your state file gains a `globalSecrets` field. Settings need a new `strict` mode. The database tracking tables need an extra column.

But users don't upgrade in lockstep. Someone running noorm 1.5 shouldn't corrupt data created by 1.3. And if they downgrade, they need a clear error—not silent data loss.

noorm solves this with layered versioning. Three independent version numbers—schema, state, and settings—track changes to their respective storage formats. Each layer migrates independently, so a database schema change doesn't force a state file upgrade.


## Three Layers

| Layer | Storage | Format | Migration Type |
|-------|---------|--------|----------------|
| Schema | Target database | SQL tables | Kysely DDL |
| State | `.noorm/state/state.enc` | Encrypted JSON | Object transform |
| Settings | `.noorm/settings.yml` | YAML | Object transform |

Each layer has its own version number in `CURRENT_VERSIONS`:

```typescript
import { CURRENT_VERSIONS } from './core/version'

console.log(CURRENT_VERSIONS)
// { schema: 2, state: 3, settings: 1 }
```

These are independent of the package version, and of each other. State has moved three times while settings has not moved at all.


## Quick Start

```typescript
import { VersionManager, getVersionManager } from './core/version'

const version = getVersionManager(process.cwd())

// Check status of all layers
const status = await version.check(db, 'postgres', state, settings)
console.log('Schema needs migration:', status.schema.needsMigration)
console.log('State needs migration:', status.state.needsMigration)
console.log('Settings needs migration:', status.settings.needsMigration)

// Migrate everything at once
const result = await version.ensureCompatible(db, 'postgres', state, settings)
// Schema is migrated in-place (database)
// State and settings are returned as new objects
const migratedState = result.state
const migratedSettings = result.settings
```

Every `VersionManager` method that touches the database takes the dialect as its second argument—the schema layer needs it to know whether the tracking tables live in a `noorm` schema or under `__noorm_*__` prefixes. The CLI version is not a parameter: it is read from `getCurrentVersion()` when the version record is written.


## Version Status

Check versions without modifying anything:

```typescript
const status = await version.check(db, dialect, state, settings)

// Each layer has the same structure
interface LayerVersionStatus {
    current: number     // Version in storage
    expected: number    // Version CLI expects
    needsMigration: boolean  // current < expected
    isNewer: boolean    // current > expected (error case)
}
```

Helper methods for common checks:

```typescript
// Any layer need upgrading?
const needsUpgrade = await version.needsMigration(db, dialect, state, settings)

// Any layer newer than CLI supports?
const tooNew = await version.hasNewerVersion(db, dialect, state, settings)
```


## Handling Version Mismatch

When storage is newer than the CLI supports, migration throws `VersionMismatchError`:

```typescript
import { attempt } from '@logosdx/utils'

import { VersionMismatchError } from './core/version'

const [, err] = await attempt(() => version.ensureCompatible(db, dialect, state, settings))

if (err instanceof VersionMismatchError) {

    console.error(`${err.layer} version ${err.current} is newer than CLI supports (${err.expected})`)
    console.error('Please upgrade noorm')
    process.exit(1)
}

if (err) throw err
```

`MigrationError` is the other error these calls throw—it carries `layer`, `version`, and the underlying `cause`.

This protects against data corruption when running an old CLI against newer data.


## Writing Schema Migrations

Schema migrations use Kysely's dialect-agnostic schema builder. Never write raw SQL—Kysely handles dialect differences.

Create a new migration in `src/core/version/schema/migrations/`:

`up` and `down` both receive the dialect, and they need it: since v2 the tracking tables live in a `noorm` schema on PostgreSQL and SQL Server, so neither the table name nor the schema is the same everywhere.

```typescript
// src/core/version/schema/migrations/v3.ts
import type { Kysely } from 'kysely'

import type { SchemaMigration } from '../../types.js'
import type { Dialect } from '../../../connection/types.js'
import { getNoormTables } from '../../../shared/tables.js'

/**
 * Resolve the schema builder for wherever this dialect keeps its tables.
 */
function noormSchema(db: Kysely<unknown>, dialect: Dialect) {

    return dialect === 'postgres' || dialect === 'mssql'
        ? db.withSchema('noorm').schema
        : db.schema;
}

export const v3: SchemaMigration = {
    version: 3,
    description: 'Add tags column to change table',

    async up(db: Kysely<unknown>, dialect: Dialect): Promise<void> {
        const tables = getNoormTables(dialect);

        await noormSchema(db, dialect)
            .alterTable(tables.change)
            .addColumn('tags', 'varchar(500)', col => col.notNull().defaultTo(''))
            .execute()
    },

    async down(db: Kysely<unknown>, dialect: Dialect): Promise<void> {
        const tables = getNoormTables(dialect);

        await noormSchema(db, dialect)
            .alterTable(tables.change)
            .dropColumn('tags')
            .execute()
    }
}
```

Hardcoding `__noorm_change__` here would appear to work, because the migration runs without error on MySQL and SQLite. On PostgreSQL and SQL Server it targets a table that no longer exists at that name, and you find out later.

Then register it and bump the version:

```typescript
// src/core/version/schema/index.ts
import { v3 } from './migrations/v3.js'

const MIGRATIONS: SchemaMigration[] = [v1, v2, v3]

// src/core/version/types.ts
export const CURRENT_VERSIONS = Object.freeze({
    schema: 3,  // Bumped from 2
    state: 3,
    settings: 1,
})
```

Only the layer you touched moves. The other two keep whatever they were at.


### Schema Migration Guidelines

1. **Use Kysely schema builder** - Never raw SQL. Let Kysely handle dialect differences.
2. **Make migrations reversible** - Implement both `up` and `down`.
3. **Default new columns** - Use `.defaultTo()` so existing rows don't break.
4. **Drop in reverse order** - Foreign key constraints require child tables dropped first.
5. **Create indexes separately** - Use `createIndex()` after table creation.

```typescript
// Good: dialect-agnostic column addition, dialect-resolved table name
await noormSchema(db, dialect)
    .alterTable(getNoormTables(dialect).change)
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .execute()

// Bad: raw SQL for one dialect, and a table name that is wrong on two others
await sql`ALTER TABLE __noorm_change__ ADD COLUMN metadata JSONB DEFAULT '{}'`.execute(db)
```


## Writing State Migrations

State migrations transform the decrypted JSON object. They run synchronously and should be idempotent.

Create a new migration in `src/core/version/state/migrations/`:

```typescript
// src/core/version/state/migrations/v4.ts
import type { StateMigration } from '../../types.js'

export const v4: StateMigration = {
    version: 4,
    description: 'Add lastUsed timestamp to configs',

    up(state: Record<string, unknown>): Record<string, unknown> {
        const configs = (state['configs'] ?? {}) as Record<string, unknown>

        // Add lastUsed to each config
        const updatedConfigs: Record<string, unknown> = {}
        for (const [name, config] of Object.entries(configs)) {
            updatedConfigs[name] = {
                ...(config as object),
                lastUsed: (config as Record<string, unknown>)['lastUsed'] ?? null,
            }
        }

        return {
            ...state,
            schemaVersion: 4,
            configs: updatedConfigs,
        }
    },

    down(state: Record<string, unknown>): Record<string, unknown> {
        const configs = (state['configs'] ?? {}) as Record<string, unknown>

        // Remove lastUsed from each config
        const updatedConfigs: Record<string, unknown> = {}
        for (const [name, config] of Object.entries(configs)) {
            const { lastUsed, ...rest } = config as Record<string, unknown>
            updatedConfigs[name] = rest
        }

        return {
            ...state,
            schemaVersion: 3,
            configs: updatedConfigs,
        }
    }
}
```

Register and bump:

```typescript
// src/core/version/state/index.ts
import { v4 } from './migrations/v4.js'

const MIGRATIONS: StateMigration[] = [v1, v2, v3, v4]

// src/core/version/types.ts
export const CURRENT_VERSIONS = Object.freeze({
    schema: 2,
    state: 4,  // Bumped from 3
    settings: 1,
})
```

`migrateState` sets `schemaVersion` to `CURRENT_VERSIONS.state` after the last migration runs, so a migration that forgets to set it still ends up correct—but set it anyway, so a partial run is still coherent.


### State Migration Guidelines

1. **Don't mutate input** - Return a new object, don't modify the original.
2. **Use nullish coalescing** - Handle missing fields gracefully with `??`.
3. **Always update schemaVersion** - Set it to the migration's version number.
4. **Make idempotent** - Running twice should produce the same result.

```typescript
// Good: Non-mutating, handles missing fields
up(state: Record<string, unknown>): Record<string, unknown> {
    return {
        ...state,
        schemaVersion: 2,
        newField: state['newField'] ?? defaultValue,
    }
}

// Bad: Mutates input
up(state: Record<string, unknown>): Record<string, unknown> {
    state['schemaVersion'] = 2
    state['newField'] = state['newField'] ?? defaultValue
    return state
}
```


## Writing Settings Migrations

Settings migrations work exactly like state migrations—transform the parsed YAML object.

Create a new migration in `src/core/version/settings/migrations/`:

```typescript
// src/core/version/settings/migrations/v2.ts
import type { SettingsMigration } from '../../types.js'

export const v2: SettingsMigration = {
    version: 2,
    description: 'Add hooks configuration',

    up(settings: Record<string, unknown>): Record<string, unknown> {
        return {
            ...settings,
            schemaVersion: 2,
            hooks: settings['hooks'] ?? {
                preBuild: [],
                postBuild: [],
            },
        }
    },

    down(settings: Record<string, unknown>): Record<string, unknown> {
        const { hooks, ...rest } = settings
        return {
            ...rest,
            schemaVersion: 1,
        }
    }
}
```


### Settings Migration Guidelines

Same as state migrations:

1. **Don't mutate input** - Return a new object.
2. **Use nullish coalescing** - Handle missing fields.
3. **Always update schemaVersion** - Set to migration version.
4. **Make idempotent** - Safe to run multiple times.


## Referring to Tracking Tables

Never hardcode a tracking table name, and do not reach for `NOORM_TABLES` either. That constant is deprecated: it only ever returns the prefixed names, so a query built from it targets a table that does not exist on PostgreSQL or SQL Server, where migration v2 moved everything into a `noorm` schema.

Two helpers replace it, and they are used together.

```typescript
import { getNoormTables, noormDb } from './core/shared/tables'

const tables = getNoormTables(dialect);   // the right names for this dialect
const ndb = noormDb(db, dialect);         // the right schema for this dialect

await ndb.selectFrom(tables.change).selectAll().execute();
```

`getNoormTables(dialect)` returns clean names (`change`, `executions`, `lock`) on PostgreSQL and SQL Server, and the `__noorm_*__` prefixed names on MySQL and SQLite.

`noormDb(db, dialect)` wraps the Kysely instance in `withSchema('noorm')` on PostgreSQL and SQL Server, and returns it untouched on MySQL and SQLite.

Neither one is sufficient alone. The names without the schema wrapper resolve against the default schema; the wrapper without the right names looks for `noorm.__noorm_change__`. Take both from the dialect and the same code works everywhere.

```typescript
// pg / mssql  → SELECT * FROM "noorm"."change"
// mysql / sqlite → SELECT * FROM `__noorm_change__`
```

The `NoormDatabase` type is the intersection of both key sets, so either name typechecks.


## Version Record Tracking

The version table (`__noorm_version__` on MySQL/SQLite, `noorm.version` on PostgreSQL/SQL Server) tracks all three version numbers—not just schema, but also state and settings:

| Column | Description |
|--------|-------------|
| `cli_version` | noorm package version (e.g., "1.2.3") |
| `noorm_version` | Database tracking tables version |
| `state_version` | State file schema version |
| `settings_version` | Settings file schema version |
| `installed_at` | First installation timestamp |
| `upgraded_at` | Last upgrade timestamp |

This provides a central record in the database of what versions are in use.

```typescript
import { getLatestVersionRecord, updateVersionRecord } from './core/version'

// Get current versions from database
const record = await getLatestVersionRecord(db, dialect)
// { stateVersion: 3, settingsVersion: 1 } — or null if no tracking tables

// Update after state/settings migration
await updateVersionRecord(db, dialect, {
    stateVersion: CURRENT_VERSIONS.state,
    settingsVersion: CURRENT_VERSIONS.settings,
})
```

`VersionRecordOptions` carries only `stateVersion` and `settingsVersion`, both optional and both defaulting to `CURRENT_VERSIONS`. `cli_version` and `noorm_version` are not callers' to set—the former comes from `getCurrentVersion()`, the latter from `CURRENT_VERSIONS.schema`.

Both reads (`getLatestVersionRecord`, `getSchemaVersion`, `tablesExist`) are two-step: they try the legacy `__noorm_version__` location first, then the schema-qualified `noorm.version` on PostgreSQL and SQL Server. That is what lets a pre-v2 database be recognized before the v2 migration has moved anything.


## Layer-Specific Functions

Each layer has dedicated functions for fine-grained control:

```typescript
import {
    // Schema
    checkSchemaVersion,
    migrateSchema,
    ensureSchemaVersion,
    bootstrapSchema,
    tablesExist,
    getSchemaVersion,
    updateVersionRecord,
    getLatestVersionRecord,

    // State
    checkStateVersion,
    migrateState,
    ensureStateVersion,
    needsStateMigration,
    createEmptyVersionedState,
    getStateVersion,

    // Settings
    checkSettingsVersion,
    migrateSettings,
    ensureSettingsVersion,
    needsSettingsMigration,
    createEmptyVersionedSettings,
    getSettingsVersion,
} from './core/version'
```


### Schema Functions

Every schema function takes the dialect as its second argument.

```typescript
// Check if tracking tables exist
const exists = await tablesExist(db, dialect)

// Get current schema version (0 if no tables)
const version = await getSchemaVersion(db, dialect)

// Check status
const status = await checkSchemaVersion(db, dialect)
// { current: 0, expected: 2, needsMigration: true, isNewer: false }

// Bootstrap from scratch (creates tables + version record)
await bootstrapSchema(db, dialect)

// Bootstrap with specific state/settings versions
await bootstrapSchema(db, dialect, { stateVersion: 3, settingsVersion: 1 })

// Migrate existing schema
await migrateSchema(db, dialect)

// Ensure at current version (migrates if needed) — thin alias for migrateSchema
await ensureSchemaVersion(db, dialect)

// Get latest version record (state/settings versions)
const record = await getLatestVersionRecord(db, dialect)
// { stateVersion: 3, settingsVersion: 1 } or null

// Update version record after state/settings migration
await updateVersionRecord(db, dialect, {
    stateVersion: 3,
    settingsVersion: 1,
})
```


### State Functions

```typescript
// Get version from state object
const version = getStateVersion(state)  // 0 if missing

// Check status
const status = checkStateVersion(state)

// Check if migration needed
if (needsStateMigration(state)) {
    const migrated = migrateState(state)
    await saveState(migrated)
}

// Create fresh versioned state
const fresh = createEmptyVersionedState()
// { schemaVersion: 3, knownUsers: {}, activeConfig: null, configs: {}, ... }
// Runs every migration against {}, so it always lands on CURRENT_VERSIONS.state

// Ensure at current version
const current = ensureStateVersion(state)
```


### Settings Functions

```typescript
// Get version from settings object
const version = getSettingsVersion(settings)  // 0 if missing

// Check status
const status = checkSettingsVersion(settings)

// Check if migration needed
if (needsSettingsMigration(settings)) {
    const migrated = migrateSettings(settings)
    await saveSettings(migrated)
}

// Create fresh versioned settings
const fresh = createEmptyVersionedSettings()
// { schemaVersion: 1 }

// Ensure at current version
const current = ensureSettingsVersion(settings)
```


## Observer Events

Version operations emit events for monitoring and logging:

```typescript
import { observer } from './core/observer'

// Version checking
observer.on('version:schema:checking', ({ current }) => {
    console.log(`Checking schema version: ${current}`)
})

// Schema migration (includes durationMs in migrated event)
observer.on('version:schema:migrating', ({ from, to }) => {
    console.log(`Migrating schema from v${from} to v${to}`)
})

observer.on('version:schema:migrated', ({ from, to, durationMs }) => {
    console.log(`Schema migrated from v${from} to v${to} (${durationMs}ms)`)
})

// State migration (no durationMs)
observer.on('version:state:migrating', ({ from, to }) => {
    console.log(`Migrating state from v${from} to v${to}`)
})

observer.on('version:state:migrated', ({ from, to }) => {
    console.log(`State migrated from v${from} to v${to}`)
})

// Settings migration (no durationMs)
observer.on('version:settings:migrating', ({ from, to }) => {
    console.log(`Migrating settings from v${from} to v${to}`)
})

observer.on('version:settings:migrated', ({ from, to }) => {
    console.log(`Settings migrated from v${from} to v${to}`)
})

// Version mismatch error
observer.on('version:mismatch', ({ layer, current, expected }) => {
    console.error(`${layer} version ${current} is newer than expected ${expected}`)
})
```


## Database Table Types

The version module exports Kysely table types for type-safe queries:

```typescript
import type {
    NoormDatabase,
    NoormVersion,
    NoormChange,
    NoormExecution,
    NoormLock,
    NoormIdentity,
    NewNoormVersion,
    NewNoormChange,
    NewNoormExecution,
    NewNoormLock,
    NewNoormIdentity,
} from './core/version'
import { getNoormTables, noormDb } from './core/shared/tables'

// Use with Kysely
const db = new Kysely<NoormDatabase>({ dialect })

// Resolve names and schema from the dialect — see "Referring to Tracking Tables"
const tables = getNoormTables(dialect)
const ndb = noormDb(db, dialect)

// Type-safe queries
const changes = await ndb
    .selectFrom(tables.change)
    .selectAll()
    .where('status', '=', 'success')
    .execute()

// Type-safe inserts
const newChange: NewNoormChange = {
    name: 'add-users-table',
    change_type: 'change',
    direction: 'change',
    status: 'pending',
}
await ndb.insertInto(tables.change).values(newChange).execute()
```

The vault table's types (`NoormVaultTable`, `NoormVault`, `NewNoormVault`) are not re-exported from `./core/version`—import them from `./core/shared` directly.


## Singleton Pattern

For convenience, use the singleton getter:

```typescript
import { getVersionManager, resetVersionManager } from './core/version'

// Get singleton (creates if needed)
const manager = getVersionManager(process.cwd())

// In tests, reset between tests
beforeEach(() => {
    resetVersionManager()
})
```


## Integration

`VersionManager.ensureCompatible` is the all-three-layers entry point, but nothing in the CLI calls it. The layers are migrated where each one is loaded, which means no caller has to hold all three at once:

| Layer | Migrated by | Where |
|-------|-------------|-------|
| state | `migrateState` (schema-version), then the package-semver migration | `StateManager.load()` |
| settings | `migrateSettings` | Settings load path |
| schema | `ensureSchemaVersion(db, dialect)` | After connect, in the CLI/TUI bootstrap |

Order matters inside `StateManager.load()`: the schema-version migrations run **first**, on the raw record. The package-semver migration only knows `State`'s own top-level fields and would silently drop anything schema-version-owned—including `schemaVersion` itself—if it ran first.

The schema step is what the CLI does after a connection is established:

```typescript
import { attempt } from '@logosdx/utils'

import { ensureSchemaVersion } from './core/version'

const [, schemaError] = await attempt(() => ensureSchemaVersion(ctx.kysely, ctx.dialect))

if (schemaError) {

    outputError(args, `Failed to initialize database schema: ${schemaError.message}`, logger)
    await attempt(() => ctx.disconnect())

    return [null, schemaError]
}
```

`ensureSchemaVersion` covers the fresh-install case too: `migrateSchema` sees version 0, finds no tables, and bootstraps from scratch. If tables exist but the version record is missing—an interrupted migration—it assumes v1 and runs v2 onward, which is safe because v2 is idempotent.
