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
import { sql, type Kysely } from 'kysely';
import { attempt } from '@logosdx/utils';

import { observer } from '../../observer.js';
import type { NoormDatabase } from '../../shared/tables.js';
import { getNoormTables, noormDb, NOORM_TABLES } from '../../shared/tables.js';
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
import { v3 } from './migrations/v3.js';

import { waitForIdentityToLoad } from '../../identity/index.js';
import { getCurrentVersion } from '../../update/checker.js';

/**
 * All schema migrations in order.
 * Add new migrations here as they're created.
 */
const MIGRATIONS: SchemaMigration[] = [v1, v2, v3];

/** Where the version table lives: under its legacy prefixed name, or moved into the `noorm` schema. */
type VersionTableLocation = 'legacy' | 'schema';

// Asks the catalog: a SELECT on a missing table fails like a dropped connection does, and the
// failure lands in the server's error log. `to_regclass` is avoided on postgres because it
// raises for a login without USAGE on the `noorm` schema.
async function locateVersionTable(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<VersionTableLocation | null> {

    const legacy = NOORM_TABLES.version;
    const probes = {
        sqlite: sql<{ legacy: number; moved: number }>`
            SELECT count(*) AS legacy, 0 AS moved FROM sqlite_master WHERE type = 'table' AND name = ${legacy}`,
        mysql: sql<{ legacy: number; moved: number }>`
            SELECT count(*) AS legacy, 0 AS moved FROM information_schema.tables
            WHERE table_schema = DATABASE() AND table_name = ${legacy}`,
        postgres: sql<{ legacy: number; moved: number }>`
            SELECT
                count(*) FILTER (WHERE table_schema = ANY (current_schemas(false)) AND table_name = ${legacy})::int AS legacy,
                count(*) FILTER (WHERE table_schema = 'noorm' AND table_name = 'version')::int AS moved
            FROM information_schema.tables`,
        mssql: sql<{ legacy: number; moved: number }>`
            SELECT IIF(OBJECT_ID(${legacy}, 'U') IS NULL, 0, 1) AS legacy, IIF(OBJECT_ID('noorm.version', 'U') IS NULL, 0, 1) AS moved`,
    };

    const { rows: [found] } = await probes[dialect].execute(db);

    if (Number(found?.legacy) > 0) return 'legacy';

    return Number(found?.moved) > 0 ? 'schema' : null;

}

/** The version table as a query source, or null when the database has no tracking tables. */
async function versionTable(db: Kysely<NoormDatabase>, dialect: Dialect) {

    const location = await locateVersionTable(db, dialect);

    if (!location) return null;

    const source = location === 'legacy' ? db : noormDb(db, dialect);
    const table = location === 'legacy' ? NOORM_TABLES.version : getNoormTables(dialect).version;

    return source.selectFrom(table as keyof NoormDatabase);

}

/**
 * Check if tracking tables exist, in either the legacy prefixed location or the `noorm` schema.
 *
 * A table this login cannot see reads as absent on every dialect; a failed probe throws.
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

    return (await locateVersionTable(db, dialect)) !== null;

}

async function readSchemaVersion(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<number | null> {

    const versions = await versionTable(db, dialect);

    if (!versions) return null;

    const latest = await versions.select('noorm_version').orderBy('id', 'desc').limit(1).executeTakeFirst();

    return latest?.noorm_version ?? 0;

}

/**
 * Get current schema version from database.
 * Returns 0 if tables don't exist.
 *
 * @example
 * ```typescript
 * const version = await getSchemaVersion(db, 'postgres')
 * // version = 3 (or 0 if not initialized)
 * ```
 */
export async function getSchemaVersion(db: Kysely<NoormDatabase>, dialect: Dialect): Promise<number> {

    return (await readSchemaVersion(db, dialect)) ?? 0;

}

/**
 * Check schema version status. `tablesExist` separates a database noorm never touched
 * from tracking tables whose version record is missing; both read as version 0.
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
): Promise<LayerVersionStatus & { tablesExist: boolean }> {

    const found = await readSchemaVersion(db, dialect);
    const current = found ?? 0;
    const expected = CURRENT_VERSIONS.schema;

    observer.emit('version:schema:checking', { current });

    return {
        current,
        expected,
        needsMigration: current < expected,
        isNewer: current > expected,
        tablesExist: found !== null,
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
 * Returns the most recent version record, or null if no tables exist.
 */
export async function getLatestVersionRecord(
    db: Kysely<NoormDatabase>,
    dialect: Dialect,
): Promise<{ stateVersion: number; settingsVersion: number } | null> {

    const versions = await versionTable(db, dialect);

    if (!versions) return null;

    const latest = await versions.select(['state_version', 'settings_version']).orderBy('id', 'desc').limit(1).executeTakeFirst();

    return latest ? { stateVersion: latest.state_version, settingsVersion: latest.settings_version } : null;

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
 * const record = await getFullVersionRecord(db, 'postgres');
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

    // Determine starting version
    let currentVersion = status.current;

    if (currentVersion === 0) {

        if (!status.tablesExist) {

            // Fresh install — no tables at all, bootstrap from scratch
            await bootstrapSchema(db, dialect, options);

            return;

        }

        // Tables exist but version record is missing (interrupted migration).
        // v1 tables were created but version record was never written.
        // Skip v1, run v2+ as pending migrations (every v2+ migration must be idempotent).
        currentVersion = 1;

    }

    const start = performance.now();

    observer.emit('version:schema:migrating', {
        from: currentVersion,
        to: CURRENT_VERSIONS.schema,
    });

    // Get existing versions to carry forward
    const existing = await getLatestVersionRecord(db, dialect);

    // Run pending migrations
    const pendingMigrations = MIGRATIONS.filter((m) => m.version > currentVersion);

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
        from: currentVersion,
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

