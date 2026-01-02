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
import { sql } from 'kysely';
import { attempt } from '@logosdx/utils';

import { observer } from '../../observer.js';
import type { NoormDatabase } from '../../shared/tables.js';

import {
    CURRENT_VERSIONS,
    MigrationError,
    VersionMismatchError,
    type LayerVersionStatus,
    type SchemaMigration,
} from '../types.js';

// Import migrations
import { v1 } from './migrations/v1.js';

/**
 * All schema migrations in order.
 * Add new migrations here as they're created.
 */
const MIGRATIONS: SchemaMigration[] = [v1];

/**
 * Check if tracking tables exist.
 *
 * @example
 * ```typescript
 * const exists = await tablesExist(db)
 * if (!exists) {
 *     await bootstrap(db)
 * }
 * ```
 */
export async function tablesExist(db: Kysely<NoormDatabase>): Promise<boolean> {

    const [result, err] = await attempt(async () => {

        await sql`SELECT 1 FROM __noorm_version__ LIMIT 1`.execute(db);

        return true;

    });

    if (err) return false;

    return result;

}

/**
 * Get current schema version from database.
 * Returns 0 if tables don't exist.
 *
 * @example
 * ```typescript
 * const version = await getSchemaVersion(db)
 * // version = 3 (or 0 if not initialized)
 * ```
 */
export async function getSchemaVersion(db: Kysely<NoormDatabase>): Promise<number> {

    const exists = await tablesExist(db);
    if (!exists) return 0;

    const [result, err] = await attempt(async () => {

        return db
            .selectFrom('__noorm_version__')
            .select('schema_version')
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst();

    });

    if (err) return 0;

    return result?.schema_version ?? 0;

}

/**
 * Check schema version status.
 *
 * @example
 * ```typescript
 * const status = await checkSchemaVersion(db)
 * if (status.needsMigration) {
 *     await migrateSchema(db)
 * }
 * ```
 */
export async function checkSchemaVersion(db: Kysely<NoormDatabase>): Promise<LayerVersionStatus> {

    const current = await getSchemaVersion(db);
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
    /** CLI semver */
    cliVersion: string;

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
    cliVersion: string,
    options?: { stateVersion?: number; settingsVersion?: number },
): Promise<void> {

    const start = performance.now();

    observer.emit('version:schema:migrating', {
        from: 0,
        to: CURRENT_VERSIONS.schema,
    });

    // Run all migrations in order
    for (const migration of MIGRATIONS) {

        const [, err] = await attempt(() => migration.up(db as Kysely<unknown>));

        if (err) {

            throw new MigrationError('schema', migration.version, err);

        }

    }

    // Insert initial version record with all versions
    await db
        .insertInto('__noorm_version__')
        .values({
            cli_version: cliVersion,
            schema_version: CURRENT_VERSIONS.schema,
            state_version: options?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version: options?.settingsVersion ?? CURRENT_VERSIONS.settings,
        })
        .execute();

    const durationMs = performance.now() - start;

    observer.emit('version:schema:migrated', {
        from: 0,
        to: CURRENT_VERSIONS.schema,
        durationMs,
    });

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
 * await updateVersionRecord(db, {
 *     cliVersion: '1.0.0',
 *     stateVersion: CURRENT_VERSIONS.state,
 *     settingsVersion: CURRENT_VERSIONS.settings,
 * })
 * ```
 */
export async function updateVersionRecord(
    db: Kysely<NoormDatabase>,
    options: VersionRecordOptions,
): Promise<void> {

    const now = new Date().toISOString();

    await db
        .insertInto('__noorm_version__')
        .values({
            cli_version: options.cliVersion,
            schema_version: CURRENT_VERSIONS.schema,
            state_version: options.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version: options.settingsVersion ?? CURRENT_VERSIONS.settings,
            upgraded_at: now as unknown as Date,
        })
        .execute();

}

/**
 * Get the latest version record.
 *
 * Returns the most recent version record, or null if no tables exist.
 */
export async function getLatestVersionRecord(
    db: Kysely<NoormDatabase>,
): Promise<{ stateVersion: number; settingsVersion: number } | null> {

    const exists = await tablesExist(db);
    if (!exists) return null;

    const [result, err] = await attempt(async () => {

        return db
            .selectFrom('__noorm_version__')
            .select(['state_version', 'settings_version'])
            .orderBy('id', 'desc')
            .limit(1)
            .executeTakeFirst();

    });

    if (err || !result) return null;

    return {
        stateVersion: result.state_version,
        settingsVersion: result.settings_version,
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
 * await migrateSchema(db, packageVersion)
 * ```
 */
export async function migrateSchema(
    db: Kysely<NoormDatabase>,
    cliVersion: string,
    options?: { stateVersion?: number; settingsVersion?: number },
): Promise<void> {

    const status = await checkSchemaVersion(db);

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

        await bootstrapSchema(db, cliVersion, options);

        return;

    }

    const start = performance.now();

    observer.emit('version:schema:migrating', {
        from: status.current,
        to: CURRENT_VERSIONS.schema,
    });

    // Get existing versions to carry forward
    const existing = await getLatestVersionRecord(db);

    // Run pending migrations
    const pendingMigrations = MIGRATIONS.filter((m) => m.version > status.current);

    for (const migration of pendingMigrations) {

        const [, err] = await attempt(() => migration.up(db as Kysely<unknown>));

        if (err) {

            throw new MigrationError('schema', migration.version, err);

        }

    }

    // Update version record (carry forward existing versions or use provided)
    await db
        .insertInto('__noorm_version__')
        .values({
            cli_version: cliVersion,
            schema_version: CURRENT_VERSIONS.schema,
            state_version:
                options?.stateVersion ?? existing?.stateVersion ?? CURRENT_VERSIONS.state,
            settings_version:
                options?.settingsVersion ?? existing?.settingsVersion ?? CURRENT_VERSIONS.settings,
        })
        .execute();

    const durationMs = performance.now() - start;

    observer.emit('version:schema:migrated', {
        from: status.current,
        to: CURRENT_VERSIONS.schema,
        durationMs,
    });

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
    cliVersion: string,
    options?: { stateVersion?: number; settingsVersion?: number },
): Promise<void> {

    await migrateSchema(db, cliVersion, options);

}

