/**
 * Schema Version Manager.
 *
 * Manages database tracking table versions using Kysely migrations.
 * The schema version is independent of the CLI package version.
 *
 * WHY: Using Kysely migrations instead of raw SQL means:
 * - Dialect-agnostic DDL (works with postgres, mysql, sqlite, mssql)
 * - Type-safe schema definitions
 * - No SQL injection risks
 */
import type { Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import { observer } from '../../observer.js';
import type { NoormDatabase } from '../../shared/tables.js';
import { getNoormTables, noormDb } from '../../shared/tables.js';
import type { Dialect } from '../../connection/types.js';

import {
    CURRENT_VERSIONS,
    MigrationError,
    VersionMismatchError,
    type LayerVersionStatus,
    type SchemaMigration,
} from '../types.js';

// Import migrations
import { v1 } from './migrations/v1.js';
import { v2 } from './migrations/v2.js';

import { waitForIdentityToLoad } from '../../identity/index.js';
import { getCurrentVersion } from '../../update/checker.js';

/**
 * All schema migrations in order.
 * Add new migrations here as they're created.
 */
const MIGRATIONS: SchemaMigration[] = [v1, v2];

/**
 * Check if tracking tables exist.
 *
 * Two-step detection: checks legacy prefixed location first,
 * then for pg/mssql checks schema-qualified location (noorm.version).
 *
 * @example
 * ```typescript
 * const exists = await tablesExist(db, 'postgres')
 * if (!exists) {
 *     await bootstrap(db, 'postgres')
 * }
 * ```
 */
export async function tablesExist(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<boolean> {

    // Step 1: Check legacy prefixed location
    const [legacyResult] = await attempt(async () => {

        await db
            .selectFrom('__noorm_version__')
            .select('id')
            .limit(1)
            .executeTakeFirst();

        return true;

    });

    if (legacyResult) return true;

    // Step 2: For pg/mssql, check schema-qualified location
    if (dialect === 'postgres' || dialect === 'mssql') {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);

        const [schemaResult] = await attempt(async () => {

            await ndb
                .selectFrom(tables.version as keyof NoormDatabase)
                .select('id')
                .limit(1)
                .executeTakeFirst();

            return true;

        });

        if (schemaResult) return true;

    }

    return false;

}

/**
 * Get current schema version from database.
 * Returns 0 if tables don't exist.
 *
 * Two-step: tries legacy location first, then schema location for pg/mssql.
 *
 * @example
 * ```typescript
 * const version = await getSchemaVersion(db, 'postgres')
 * // version = 3 (or 0 if not initialized)
 * ```
 */
export async function getSchemaVersion(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<number> {

    const exists = await tablesExist(db, dialect);
    if (!exists) return 0;

    // Step 1: Try legacy prefixed location
    const [legacyResult] = await attempt(async () => {

        return db
            .selectFrom('__noorm_version__')
            .select('noorm_version')
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst();

    });

    if (legacyResult) return legacyResult.noorm_version ?? 0;

    // Step 2: For pg/mssql, try schema-qualified location
    if (dialect === 'postgres' || dialect === 'mssql') {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);

        const [schemaResult] = await attempt(async () => {

            return ndb
                .selectFrom(tables.version as keyof NoormDatabase)
                .select('noorm_version')
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst();

        });

        if (schemaResult) return schemaResult.noorm_version ?? 0;

    }

    return 0;

}

/**
 * Check schema version status.
 *
 * @example
 * ```typescript
 * const status = await checkSchemaVersion(db, 'postgres')
 * if (status.needsMigration) {
 *     await migrateSchema(db, 'postgres')
 * }
 * ```
 */
export async function checkSchemaVersion(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<LayerVersionStatus> {

    const current = await getSchemaVersion(db, dialect);
    const expected = CURRENT_VERSIONS.schema;

    observer.emit('version:schema:checking', { current });

    return {
        current,
        expected,
        needsMigration: current < expected,
        isNewer: current > expected,
    };

}

/**
 * Options for bootstrap and version record operations.
 */
export interface VersionRecordOptions {
    /** State schema version (defaults to CURRENT_VERSIONS.state) */
    stateVersion?: number;

    /** Settings schema version (defaults to CURRENT_VERSIONS.settings) */
    settingsVersion?: number;
}

/**
 * Bootstrap tracking tables from scratch.
 *
 * Runs all migrations and inserts initial version record.
 * Called when no tracking tables exist.
 */
export async function bootstrapSchema(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    const start = performance.now();

    observer.emit('version:schema:migrating', {
        from: 0,
        to: CURRENT_VERSIONS.schema,
    });

    // Run all migrations in order
    for (const migration of MIGRATIONS) {

        const [, err] = await attempt(() => migration.up(db as Kysely<unknown>, dialect));

        if (err) {

            throw new MigrationError('schema', migration.version, err);

        }

    }

    // Insert initial version record with all versions
    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    await ndb
        .insertInto(tables.version as keyof NoormDatabase)
        .values({
            cli_version: getCurrentVersion(),
            noorm_version: CURRENT_VERSIONS.schema,
            state_version: options?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version: options?.settingsVersion ?? CURRENT_VERSIONS.settings,
        } as never)
        .execute();

    const durationMs = performance.now() - start;

    observer.emit('version:schema:migrated', {
        from: 0,
        to: CURRENT_VERSIONS.schema,
        durationMs,
    });

    // Ensure identity is registered in the new schema
    await waitForIdentityToLoad(db, dialect);

}

/**
 * Update the version record with current versions.
 *
 * Call this after state or settings migrations to keep the database
 * record in sync with actual file versions.
 *
 * @example
 * ```typescript
 * // After migrating state and settings
 * await updateVersionRecord(db, 'postgres', {
 *     stateVersion: CURRENT_VERSIONS.state,
 *     settingsVersion: CURRENT_VERSIONS.settings,
 * })
 * ```
 */
export async function updateVersionRecord(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    const now = new Date().toISOString();
    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    await ndb
        .insertInto(tables.version as keyof NoormDatabase)
        .values({
            cli_version: getCurrentVersion(),
            noorm_version: CURRENT_VERSIONS.schema,
            state_version: options?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version: options?.settingsVersion ?? CURRENT_VERSIONS.settings,
            upgraded_at: now as unknown as Date,
        } as never)
        .execute();

}

/**
 * Get the latest version record.
 *
 * Two-step lookup: tries legacy location first, then schema location for pg/mssql.
 * Returns the most recent version record, or null if no tables exist.
 */
export async function getLatestVersionRecord(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<{ stateVersion: number; settingsVersion: number } | null> {

    const exists = await tablesExist(db, dialect);
    if (!exists) return null;

    // Step 1: Try legacy prefixed location
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

    // Step 2: For pg/mssql, try schema-qualified location
    if (dialect === 'postgres' || dialect === 'mssql') {

        const ndb = noormDb(db, dialect);
        const tables = getNoormTables(dialect);

        const [schemaResult] = await attempt(async () => {

            return ndb
                .selectFrom(tables.version as keyof NoormDatabase)
                .select(['state_version', 'settings_version'])
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst();

        });

        if (schemaResult) {

            return {
                stateVersion: schemaResult.state_version,
                settingsVersion: schemaResult.settings_version,
            };

        }

    }

    return null;

}

/**
 * Full version record for metadata display.
 *
 * Combines data from the first and latest version rows:
 * - installedAt from the first row (initial bootstrap)
 * - All other fields from the latest row (most recent state)
 */
export interface FullVersionRecord {
    /** CLI semver from latest row */
    cliVersion: string;

    /** Database tracking tables version */
    noormVersion: number;

    /** State file schema version */
    stateVersion: number;

    /** Settings file schema version */
    settingsVersion: number;

    /** When noorm was first installed (from first row) */
    installedAt: Date;

    /** When noorm was last upgraded (from latest row) */
    upgradedAt: Date;
}

/**
 * Get full version record for metadata display.
 *
 * Combines the first row's installed_at with the latest row's
 * remaining fields. Returns null if no tracking tables exist.
 *
 * @example
 * ```typescript
 * const record = await getFullVersionRecord(db);
 * if (record) {
 *     console.log(`noorm v${record.cliVersion}, schema v${record.noormVersion}`);
 *     console.log(`installed: ${record.installedAt}`);
 * }
 * ```
 */
export async function getFullVersionRecord(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<FullVersionRecord | null> {

    const exists = await tablesExist(db, dialect);
    if (!exists) return null;

    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    const [results, err] = await attempt(() =>
        Promise.all([
            // Latest row: all fields + upgraded_at
            ndb
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .selectFrom(tables.version as any)
                .select([
                    'cli_version',
                    'noorm_version',
                    'state_version',
                    'settings_version',
                    'upgraded_at',
                ])
                .orderBy('id', 'desc')
                .limit(1)
                .executeTakeFirst(),
            // First row: installed_at only
            ndb
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                .selectFrom(tables.version as any)
                .select('installed_at')
                .orderBy('id', 'asc')
                .limit(1)
                .executeTakeFirst(),
        ]),
    );

    if (err) return null;

    const [latest, first] = results;
    if (!latest || !first) return null;

    return {
        cliVersion: latest.cli_version,
        noormVersion: latest.noorm_version,
        stateVersion: latest.state_version,
        settingsVersion: latest.settings_version,
        installedAt: first.installed_at,
        upgradedAt: latest.upgraded_at,
    };

}

/**
 * Migrate schema from current version to latest.
 *
 * Only runs migrations that haven't been applied yet.
 * Carries forward existing state/settings versions.
 *
 * @throws VersionMismatchError if schema is newer than CLI supports
 * @throws MigrationError if a migration fails
 *
 * @example
 * ```typescript
 * await migrateSchema(db, 'postgres')
 * ```
 */
export async function migrateSchema(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    const status = await checkSchemaVersion(db, dialect);

    // Schema is newer than CLI supports
    if (status.isNewer) {

        observer.emit('version:mismatch', {
            layer: 'schema',
            current: status.current,
            expected: status.expected,
        });

        throw new VersionMismatchError('schema', status.current, status.expected);

    }

    // No migration needed
    if (!status.needsMigration) return;

    // Bootstrap if no tables exist
    if (status.current === 0) {

        await bootstrapSchema(db, dialect, options);

        return;

    }

    const start = performance.now();

    observer.emit('version:schema:migrating', {
        from: status.current,
        to: CURRENT_VERSIONS.schema,
    });

    // Get existing versions to carry forward
    const existing = await getLatestVersionRecord(db, dialect);

    // Run pending migrations
    const pendingMigrations = MIGRATIONS.filter((m) => m.version > status.current);

    for (const migration of pendingMigrations) {

        const [, err] = await attempt(() => migration.up(db as Kysely<unknown>, dialect));

        if (err) {

            throw new MigrationError('schema', migration.version, err);

        }

    }

    // Update version record (carry forward existing versions or use provided)
    const ndb = noormDb(db, dialect);
    const tables = getNoormTables(dialect);

    await ndb
        .insertInto(tables.version as keyof NoormDatabase)
        .values({
            cli_version: getCurrentVersion(),
            noorm_version: CURRENT_VERSIONS.schema,
            state_version:
                options?.stateVersion ?? existing?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version:
                options?.settingsVersion ?? existing?.settingsVersion ?? CURRENT_VERSIONS.settings,
        } as never)
        .execute();

    const durationMs = performance.now() - start;

    observer.emit('version:schema:migrated', {
        from: status.current,
        to: CURRENT_VERSIONS.schema,
        durationMs,
    });

    await waitForIdentityToLoad(db, dialect);

}

/**
 * Ensure schema is at current version.
 *
 * Combines check and migrate into a single call.
 *
 * @throws VersionMismatchError if schema is newer than CLI supports
 * @throws MigrationError if a migration fails
 */
export async function ensureSchemaVersion(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
    options?: VersionRecordOptions,
): Promise<void> {

    await migrateSchema(db, dialect, options);

}

