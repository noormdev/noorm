/**
 * Database lifecycle operations.
 *
 * High-level API for creating, destroying, and checking database status.
 * Delegates to dialect-specific implementations.
 */
import type { Kysely } from 'kysely';

import type { ConnectionConfig } from '../connection/types.js';
import type { NoormDatabase } from '../shared/index.js';
import type { DbStatus, DbOperationResult, CreateDbOptions, DestroyDbOptions } from './types.js';

import { createConnection, testConnection } from '../connection/factory.js';
import { bootstrapSchema, tablesExist } from '../version/index.js';
import { observer } from '../observer.js';
import { getDialectOperations } from './dialects/index.js';
import { attempt } from '@logosdx/utils';

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
    const ops = getDialectOperations(config.dialect);
    const [exists, existsErr] = await attempt(() => ops.databaseExists(config, config.database));

    if (existsErr) {

        return {
            serverOk: true,
            exists: false,
            trackingInitialized: false,
            error: existsErr.message,
        };

    }

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
        const hasNoormTables = await tablesExist(db);
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

    const { ifNotExists = true, initializeTracking = true } = options;

    const dbName = config.database;

    // Get dialect operations
    const ops = getDialectOperations(config.dialect);

    // Check current status
    const status = await checkDbStatus(config);

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

            observer.emit('db:bootstrap', {
                configName,
                tables: ['__noorm_version__', '__noorm_executions__', '__noorm_lock__'],
            });

            await bootstrapSchema(db, config.dialect, '1.0.0');
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
 * Drops the entire database by default. Use `trackingOnly: true`
 * to only reset tracking tables without dropping the database.
 *
 * @example
 * ```typescript
 * // Drop entire database
 * await destroyDb(config, 'myconfig')
 *
 * // Reset tracking only (keep database)
 * await destroyDb(config, 'myconfig', { trackingOnly: true })
 * ```
 */
export async function destroyDb(
    config: ConnectionConfig,
    configName: string,
    options: DestroyDbOptions = {},
): Promise<DbOperationResult> {

    const { trackingOnly = false } = options;

    const dbName = config.database;

    // Emit start event
    observer.emit('db:destroying', { configName, database: dbName });

    if (trackingOnly) {

        // Just reset tracking tables
        const [, resetErr] = await attempt(async () => {

            const conn = await createConnection(config, configName);
            const db = conn.db as Kysely<NoormDatabase>;

            // Clear tracking tables
            const hasNoormTables = await tablesExist(db);

            if (hasNoormTables) {

                await db.deleteFrom('__noorm_executions__').execute();

                // Try to clear change table (might not exist)
                try {

                    await db.deleteFrom('__noorm_change__').execute();

                }
                catch {
                    // Table might not exist
                }

            }

            await conn.destroy();

        });

        if (resetErr) {

            return { ok: false, error: resetErr.message };

        }

    }
    else {

        // Drop the entire database
        const ops = getDialectOperations(config.dialect);

        const [, dropErr] = await attempt(() => ops.dropDatabase(config, dbName));

        if (dropErr) {

            return { ok: false, error: dropErr.message };

        }

    }

    // Emit completion event
    observer.emit('db:destroyed', { configName, database: dbName });

    return { ok: true };

}
