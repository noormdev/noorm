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
// { schema: 1, state: 1, settings: 1 }
```

These are independent of the package version. Bumping `schema` to 2 doesn't require bumping `state` or `settings`.


## Quick Start

```typescript
import { VersionManager, getVersionManager } from './core/version'

const version = getVersionManager(process.cwd())

// Check status of all layers
const status = await version.check(db, state, settings)
console.log('Schema needs migration:', status.schema.needsMigration)
console.log('State needs migration:', status.state.needsMigration)
console.log('Settings needs migration:', status.settings.needsMigration)

// Migrate everything at once
const result = await version.ensureCompatible(db, state, settings, '1.0.0')
// Schema is migrated in-place (database)
// State and settings are returned as new objects
const migratedState = result.state
const migratedSettings = result.settings
```


## Version Status

Check versions without modifying anything:

```typescript
const status = await version.check(db, state, settings)

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
const needsUpgrade = await version.needsMigration(db, state, settings)

// Any layer newer than CLI supports?
const tooNew = await version.hasNewerVersion(db, state, settings)
```


## Handling Version Mismatch

When storage is newer than the CLI supports, migration throws `VersionMismatchError`:

```typescript
import { VersionMismatchError } from './core/version'

try {
    await version.ensureCompatible(db, state, settings, cliVersion)
}
catch (err) {
    if (err instanceof VersionMismatchError) {
        console.error(`${err.layer} version ${err.current} is newer than CLI supports (${err.expected})`)
        console.error('Please upgrade noorm')
        process.exit(1)
    }
    throw err
}
```

This protects against data corruption when running an old CLI against newer data.


## Writing Schema Migrations

Schema migrations use Kysely's dialect-agnostic schema builder. Never write raw SQL—Kysely handles dialect differences.

Create a new migration in `src/core/version/schema/migrations/`:

```typescript
// src/core/version/schema/migrations/v2.ts
import type { Kysely } from 'kysely'
import type { SchemaMigration } from '../../types.js'

export const v2: SchemaMigration = {
    version: 2,
    description: 'Add tags column to change table',

    async up(db: Kysely<unknown>): Promise<void> {
        await db.schema
            .alterTable('__noorm_change__')
            .addColumn('tags', 'varchar(500)', col => col.notNull().defaultTo(''))
            .execute()
    },

    async down(db: Kysely<unknown>): Promise<void> {
        await db.schema
            .alterTable('__noorm_change__')
            .dropColumn('tags')
            .execute()
    }
}
```

Then register it and bump the version:

```typescript
// src/core/version/schema/index.ts
import { v2 } from './migrations/v2.js'

const MIGRATIONS: SchemaMigration[] = [v1, v2]

// src/core/version/types.ts
export const CURRENT_VERSIONS = Object.freeze({
    schema: 2,  // Bumped from 1
    state: 1,
    settings: 1,
})
```


### Schema Migration Guidelines

1. **Use Kysely schema builder** - Never raw SQL. Let Kysely handle dialect differences.
2. **Make migrations reversible** - Implement both `up` and `down`.
3. **Default new columns** - Use `.defaultTo()` so existing rows don't break.
4. **Drop in reverse order** - Foreign key constraints require child tables dropped first.
5. **Create indexes separately** - Use `createIndex()` after table creation.

```typescript
// Good: Dialect-agnostic column addition
await db.schema
    .alterTable('__noorm_change__')
    .addColumn('metadata', 'text', col => col.notNull().defaultTo('{}'))
    .execute()

// Bad: Raw SQL for specific dialect
await sql`ALTER TABLE __noorm_change__ ADD COLUMN metadata JSONB DEFAULT '{}'`.execute(db)
```


## Writing State Migrations

State migrations transform the decrypted JSON object. They run synchronously and should be idempotent.

Create a new migration in `src/core/version/state/migrations/`:

```typescript
// src/core/version/state/migrations/v2.ts
import type { StateMigration } from '../../types.js'

export const v2: StateMigration = {
    version: 2,
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
            schemaVersion: 2,
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
            schemaVersion: 1,
            configs: updatedConfigs,
        }
    }
}
```

Register and bump:

```typescript
// src/core/version/state/index.ts
import { v2 } from './migrations/v2.js'

const MIGRATIONS: StateMigration[] = [v1, v2]

// src/core/version/types.ts
export const CURRENT_VERSIONS = Object.freeze({
    schema: 1,
    state: 2,  // Bumped from 1
    settings: 1,
})
```


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


## Table Name Constants

Use `NOORM_TABLES` instead of hardcoding table names:

```typescript
import { NOORM_TABLES } from './core/version'

console.log(NOORM_TABLES)
// {
//     version: '__noorm_version__',
//     change: '__noorm_change__',
//     executions: '__noorm_executions__',
//     lock: '__noorm_lock__',
//     identities: '__noorm_identities__',
// }

// Use in queries
await db.selectFrom(NOORM_TABLES.version).selectAll().execute()
await db.selectFrom(NOORM_TABLES.change).where('status', '=', 'success').execute()
```


## Version Record Tracking

The `__noorm_version__` table tracks all three version numbers—not just schema, but also state and settings:

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
const record = await getLatestVersionRecord(db)
// { stateVersion: 1, settingsVersion: 1 }

// Update after state/settings migration
await updateVersionRecord(db, {
    cliVersion: '1.1.0',
    stateVersion: 2,
    settingsVersion: 1,
})
```


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

```typescript
// Check if tracking tables exist
const exists = await tablesExist(db)

// Get current schema version (0 if no tables)
const version = await getSchemaVersion(db)

// Check status
const status = await checkSchemaVersion(db)
// { current: 0, expected: 1, needsMigration: true, isNewer: false }

// Bootstrap from scratch (creates tables + version record)
await bootstrapSchema(db, '1.0.0')

// Bootstrap with specific state/settings versions
await bootstrapSchema(db, '1.0.0', { stateVersion: 2, settingsVersion: 1 })

// Migrate existing schema
await migrateSchema(db, '1.0.0')

// Ensure at current version (migrates if needed)
await ensureSchemaVersion(db, '1.0.0')

// Get latest version record (state/settings versions)
const record = await getLatestVersionRecord(db)
// { stateVersion: 1, settingsVersion: 1 } or null

// Update version record after state/settings migration
await updateVersionRecord(db, {
    cliVersion: '1.1.0',
    stateVersion: 2,
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
// { schemaVersion: 1, identity: null, knownUsers: {}, ... }

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

// Use with Kysely
const db = new Kysely<NoormDatabase>({ dialect })

// Type-safe queries
const changes = await db
    .selectFrom('__noorm_change__')
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
await db.insertInto('__noorm_change__').values(newChange).execute()
```


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


## Integration Example

Typical initialization flow:

```typescript
import { getVersionManager, VersionMismatchError } from './core/version'
import { getStateManager } from './core/state'
import { getSettingsManager } from './core/settings'
import { createConnection } from './core/connection'

async function initialize(projectRoot: string): Promise<void> {

    // Load current state and settings
    const stateManager = getStateManager(projectRoot)
    const settingsManager = getSettingsManager(projectRoot)

    await stateManager.load()
    await settingsManager.load()

    // Connect to database
    const config = stateManager.getActiveConfig()
    const db = await createConnection(config)

    // Check and migrate versions
    const version = getVersionManager(projectRoot)

    try {
        const result = await version.ensureCompatible(
            db,
            stateManager.getRawState(),
            settingsManager.getRawSettings(),
            getPackageVersion()
        )

        // Save migrated state if changed
        if (result.state !== stateManager.getRawState()) {
            await stateManager.saveRawState(result.state)
        }

        // Save migrated settings if changed
        if (result.settings !== settingsManager.getRawSettings()) {
            await settingsManager.saveRawSettings(result.settings)
        }
    }
    catch (err) {
        if (err instanceof VersionMismatchError) {
            console.error('Your data was created by a newer version of noorm.')
            console.error(`Please upgrade: npm install -g @noormdev/cli`)
            process.exit(1)
        }
        throw err
    }
}
```
