/**
 * Dual connection infrastructure.
 *
 * Generic infrastructure for cross-database operations.
 * Provides a safe way to work with two database connections simultaneously,
 * with proper lifecycle management and cleanup.
 *
 * Used by:
 * - vault cp (copy secrets between configs)
 * - Future: db transfer, db backup/restore, etc.
 */
import type { Kysely } from 'kysely';

import { attempt } from '@logosdx/utils';

import type { ConnectionResult, Dialect } from '../connection/types.js';
import type { Config } from '../config/types.js';
import type { NoormDatabase } from '../shared/tables.js';
import { createConnection } from '../connection/factory.js';
import { observer } from '../observer.js';
import { ensureSchemaVersion } from '../version/schema/index.js';

/**
 * Connection info for dual connection context.
 */
export interface DualConnectionEntry {
    config: Config;
    db: Kysely<NoormDatabase>;
    dialect: Dialect;
}

/**
 * Context passed to dual connection operations.
 */
export interface DualConnectionContext {
    source: DualConnectionEntry;
    destination: DualConnectionEntry;
}

/**
 * Options for dual connection operations.
 */
export interface DualConnectionOptions {
    /** Source config object */
    sourceConfig: Config;

    /** Destination config object */
    destConfig: Config;

    /** Bootstrap noorm tables on destination if needed (default: true) */
    ensureSchema?: boolean;
}

/**
 * Execute an operation with two database connections.
 *
 * Handles connection lifecycle for both databases, ensuring proper
 * cleanup even on failure. This is foundational infrastructure for
 * all cross-database operations.
 *
 * @param options - Source and destination config objects
 * @param fn - Function to execute with both connections
 * @returns Tuple of [result, error]
 *
 * @example
 * ```typescript
 * const [result, err] = await withDualConnection(
 *     { sourceConfig, destConfig, cliVersion: '1.0.0' },
 *     async (ctx) => {
 *         // Copy data from source to destination
 *         const rows = await ctx.source.db.selectFrom('table').execute();
 *         for (const row of rows) {
 *             await ctx.destination.db.insertInto('table').values(row).execute();
 *         }
 *         return { copiedCount: rows.length };
 *     },
 * );
 *
 * if (err) {
 *     console.error('Copy failed:', err.message);
 * }
 * ```
 */
export async function withDualConnection<T>(
    options: DualConnectionOptions,
    fn: (ctx: DualConnectionContext) => Promise<T>,
): Promise<[T | null, Error | null]> {

    const { sourceConfig, destConfig, ensureSchema = true } = options;

    let sourceConn: ConnectionResult | null = null;
    let destConn: ConnectionResult | null = null;

    observer.emit('db:dual:connecting', {
        source: sourceConfig.name,
        destination: destConfig.name,
    });

    const [result, err] = await attempt(async () => {

        // Connect to source database
        sourceConn = await createConnection(sourceConfig.connection, sourceConfig.name);

        // Connect to destination database
        destConn = await createConnection(destConfig.connection, destConfig.name);

        observer.emit('db:dual:connected', {
            source: sourceConfig.name,
            destination: destConfig.name,
        });

        // Optionally bootstrap noorm schema on destination
        if (ensureSchema) {

            await ensureSchemaVersion(
                destConn.db as Kysely<NoormDatabase>,
                destConn.dialect,
            );

        }

        // Execute the operation
        return fn({
            source: {
                config: sourceConfig,
                db: sourceConn.db as Kysely<NoormDatabase>,
                dialect: sourceConn.dialect,
            },
            destination: {
                config: destConfig,
                db: destConn.db as Kysely<NoormDatabase>,
                dialect: destConn.dialect,
            },
        });

    });

    // ALWAYS cleanup - even if one fails, try to close the other
    const cleanupErrors: Error[] = [];

    observer.emit('db:dual:disconnecting', {
        source: sourceConfig.name,
        destination: destConfig.name,
    });

    if (sourceConn) {

        const [, closeErr] = await attempt(() => sourceConn!.destroy());
        if (closeErr) cleanupErrors.push(closeErr);

    }

    if (destConn) {

        const [, closeErr] = await attempt(() => destConn!.destroy());
        if (closeErr) cleanupErrors.push(closeErr);

    }

    observer.emit('db:dual:disconnected', {
        source: sourceConfig.name,
        destination: destConfig.name,
    });

    // If main operation succeeded but cleanup failed, log but don't fail
    if (!err && cleanupErrors.length > 0) {

        observer.emit('db:dual:cleanup-warning', { errors: cleanupErrors.map((e) => e.message) });

    }

    return [result, err];

}
