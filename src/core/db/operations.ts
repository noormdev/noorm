/**
 * Database lifecycle operations.
 *
 * High-level API for creating, destroying, and checking database status.
 * Delegates to dialect-specific implementations.
 */
import type { Kysely } from 'kysely';

import { attempt, attemptSync } from '@logosdx/utils';

import type { ConnectionConfig } from '../connection/types.js';
import type { NoormDatabase } from '../shared/index.js';
import { getNoormTables } from '../shared/index.js';
import type { DbStatus, DbOperationResult, CreateDbOptions, DestroyDbOptions } from './types.js';

import { createConnection, testConnection } from '../connection/factory.js';
import { bootstrapSchema, tablesExist } from '../version/index.js';
import { observer } from '../observer.js';
import { getDialectOperations } from './dialects/index.js';
import { assertDbPolicy } from './policy.js';

/**
 * Check database status.
 *
 * Tests server connectivity, database existence, and tracking initialization.
 *
 * @example
 * ```typescript
 * const status = await checkDbStatus(config)
 * if (!status.exists) {
 *     await createDb(config)
 * }
 * ```
 */
export async function checkDbStatus(config: ConnectionConfig): Promise<DbStatus> {

    const ops = getDialectOperations(config.dialect);

    // SQLite's connectivity probe below connects directly to the target file
    // (factory.ts has no sqlite system database to swap to), which auto-creates
    // the file as a side effect. Capture existence before that happens so the
    // post-probe check below can't report a false positive for a fresh target.
    const sqlitePreProbeExists = config.dialect === 'sqlite'
        ? await ops.databaseExists(config, config.database)
        : undefined;

    // Test server connectivity first
    const serverTest = await testConnection(config, { testServerOnly: true });

    if (!serverTest.ok) {

        return {
            serverOk: false,
            exists: false,
            trackingInitialized: false,
            error: serverTest.error,
        };

    }

    // Check if database exists
    const [existsAfterProbe, existsErr] = await attempt(() => ops.databaseExists(config, config.database));

    if (existsErr) {

        return {
            serverOk: true,
            exists: false,
            trackingInitialized: false,
            error: existsErr.message,
        };

    }

    const exists = sqlitePreProbeExists ?? existsAfterProbe;

    if (!exists) {

        return {
            serverOk: true,
            exists: false,
            trackingInitialized: false,
        };

    }

    // Check if tracking tables exist
    const [hasTracking, trackingErr] = await attempt(async () => {

        const conn = await createConnection(config, '__check__');
        const db = conn.db as Kysely<NoormDatabase>;
        const hasNoormTables = await tablesExist(db, config.dialect);
        await conn.destroy();

        return hasNoormTables;

    });

    if (trackingErr) {

        return {
            serverOk: true,
            exists: true,
            trackingInitialized: false,
            error: trackingErr.message,
        };

    }

    return {
        serverOk: true,
        exists: true,
        trackingInitialized: hasTracking ?? false,
    };

}

/**
 * Create a database.
 *
 * Creates the database if it doesn't exist and optionally initializes
 * noorm tracking tables.
 *
 * @example
 * ```typescript
 * const result = await createDb(config, 'myconfig')
 * if (result.ok) {
 *     console.log('Database ready')
 * }
 * ```
 */
export async function createDb(
    config: ConnectionConfig,
    configName: string,
    options: CreateDbOptions = {},
): Promise<DbOperationResult> {

    const { ifNotExists = true, initializeTracking = true, precheckedStatus } = options;

    const dbName = config.database;

    // Get dialect operations
    const ops = getDialectOperations(config.dialect);

    const [, policyErr] = attemptSync(() => assertDbPolicy(options.policy, 'db:create', 'create the database'));

    if (policyErr) {

        return { ok: false, error: policyErr.message };

    }

    // Reuse the caller's status when supplied, instead of re-deriving it —
    // a second checkDbStatus call for SQLite would see the caller's own
    // probe having already auto-created the target file.
    const status = precheckedStatus ?? await checkDbStatus(config);

    if (!status.serverOk) {

        return { ok: false, error: status.error };

    }

    // Emit start event
    observer.emit('db:creating', { configName, database: dbName });

    const start = Date.now();
    let created = false;
    let trackingInitialized = false;

    // Create database if needed
    if (!status.exists) {

        const [, createErr] = await attempt(() => ops.createDatabase(config, dbName));

        if (createErr) {

            return { ok: false, error: createErr.message };

        }

        created = true;

    }
    else if (!ifNotExists) {

        return { ok: false, error: `Database "${dbName}" already exists` };

    }

    // Initialize tracking if needed
    if (initializeTracking && !status.trackingInitialized) {

        const [, bootstrapErr] = await attempt(async () => {

            const conn = await createConnection(config, configName);
            const db = conn.db as Kysely<NoormDatabase>;

            const tables = getNoormTables(config.dialect);

            observer.emit('db:bootstrap', {
                configName,
                tables: [tables.version, tables.executions, tables.lock],
            });

            await bootstrapSchema(db, config.dialect);
            await conn.destroy();

        });

        if (bootstrapErr) {

            return { ok: false, error: bootstrapErr.message };

        }

        trackingInitialized = true;

    }

    const durationMs = Date.now() - start;

    // Emit completion event
    observer.emit('db:created', { configName, database: dbName, durationMs });

    return { ok: true, created, trackingInitialized };

}

/**
 * Destroy a database.
 *
 * Reports `dropped: false` when the target was already absent, mirroring
 * `createDb`'s `created` contract. Every dialect's drop is `IF EXISTS`, so
 * without the existence check a CI job that names the wrong database gets a
 * green "dropped" and never learns its target was wrong.
 *
 * @example
 * ```typescript
 * const result = await destroyDb(config, 'myconfig')
 * if (result.ok && !result.dropped) console.log('nothing to drop')
 * ```
 */
export async function destroyDb(
    config: ConnectionConfig,
    configName: string,
    options: DestroyDbOptions = {},
): Promise<DbOperationResult> {

    const dbName = config.database;
    const ops = getDialectOperations(config.dialect);

    const [, policyErr] = attemptSync(() => assertDbPolicy(options.policy, 'db:destroy', 'drop the database'));

    if (policyErr) {

        return { ok: false, error: policyErr.message };

    }

    observer.emit('db:destroying', { configName, database: dbName });

    // Existence is checked before the drop, not inferred from it — the drop
    // itself is IF EXISTS on every dialect and so cannot tell the two apart.
    // A probe failure is not fatal: fall through and let the drop decide.
    const [existed] = await attempt(() => ops.databaseExists(config, dbName));

    if (existed === false) {

        return { ok: true, dropped: false };

    }

    const [, dropErr] = await attempt(() => ops.dropDatabase(config, dbName));

    if (dropErr) {

        return { ok: false, error: dropErr.message };

    }

    observer.emit('db:destroyed', { configName, database: dbName });

    return { ok: true, dropped: true };

}
