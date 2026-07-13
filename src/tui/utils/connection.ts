/**
 * Screen-level connection lifecycle helper.
 *
 * Wraps the connect + cast + try/finally destroy pattern
 * used by run and db screens for one-shot operations.
 *
 * @example
 * ```typescript
 * const [result, err] = await withScreenConnection(config, name, async (db) => {
 *     return await checkFilesStatus(context, files);
 * });
 * ```
 */
import { attempt } from '@logosdx/utils';

import type { Kysely } from 'kysely';

import type { ConnectionConfig, ConnectionResult } from '../../core/connection/types.js';
import type { NoormDatabase } from '../../core/shared/index.js';
import { createConnection, testConnection } from '../../core/connection/index.js';

/**
 * Execute a callback with a managed database connection.
 *
 * Tests connectivity, creates a connection, runs the callback,
 * and destroys the connection in a finally block. Returns a
 * Go-style error tuple.
 *
 * @example
 * ```typescript
 * const [status, err] = await withScreenConnection(
 *     activeConfig.connection, activeConfigName,
 *     (db) => lockManager.status(db, configName),
 * );
 * ```
 */
export async function withScreenConnection<T>(
    connectionConfig: ConnectionConfig,
    configName: string,
    fn: (db: Kysely<NoormDatabase>) => Promise<T>,
    options?: { onConnect?: (conn: ConnectionResult) => void },
): Promise<[T | null, Error | null]> {

    const testResult = await testConnection(connectionConfig);

    if (!testResult.ok) {

        return [null, new Error(`Connection failed: ${testResult.error}`)];

    }

    const [conn, connErr] = await attempt(() =>
        createConnection(connectionConfig, configName),
    );

    if (connErr || !conn) {

        return [null, new Error(`Connection failed: ${connErr?.message ?? 'Unknown error'}`)];

    }

    options?.onConnect?.(conn);

    const [result, err] = await attempt(async () => {

        const db = conn.db as Kysely<NoormDatabase>;

        return await fn(db);

    });

    await conn.destroy();

    if (err) {

        return [null, err];

    }

    return [result, null];

}
