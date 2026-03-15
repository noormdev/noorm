/**
 * Connection worker — owns a Kysely instance and handles DB operations.
 *
 * Receives events via WorkerBridge and responds with correlation IDs.
 * Uses the dialect factory directly to avoid observer/manager side effects
 * that belong only in the main process.
 *
 * @example
 * ```typescript
 * const bridge = new WorkerBridge<ConnectionEvents>(CONNECTION_WORKER)
 * await bridge.request('connect', { dialect: 'sqlite', connectionString: ':memory:' })
 * const { rows } = await bridge.request('query', { sql: 'SELECT 1' })
 * ```
 */
import { attempt } from '@logosdx/utils';
import { CompiledQuery, type Kysely } from 'kysely';

import { WorkerBridge } from '../core/worker-bridge/bridge.js';
import type { ConnectionEvents, Correlated } from '../core/worker-bridge/types.js';
import type { Dialect } from '../core/connection/types.js';

// === Declarations ===

const bridge = new WorkerBridge<ConnectionEvents>();

let db: Kysely<unknown> | null = null;
let destroyFn: (() => Promise<void>) | null = null;

// === Helpers ===

/**
 * Create a Kysely instance from a dialect name and connection string.
 *
 * Bypasses the main-process factory to avoid observer emissions and
 * connection-manager tracking that don't belong inside a worker.
 */
async function createDialectConnection(dialect: Dialect, connectionString: string) {

    type DialectFactory = (config: { dialect: Dialect; database: string }) => {
        db: Kysely<unknown>;
        dialect: Dialect;
        destroy: () => Promise<void>;
    };

    let createFn: DialectFactory;

    if (dialect === 'sqlite') {

        if (typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined') {

            const mod = await import('../core/connection/dialects/sqlite-bun.js');
            createFn = mod.createBunSqliteConnection as unknown as DialectFactory;

        }
        else {

            const mod = await import('../core/connection/dialects/sqlite.js');
            createFn = mod.createSqliteConnection as unknown as DialectFactory;

        }

    }
    else if (dialect === 'postgres') {

        const mod = await import('../core/connection/dialects/postgres.js');
        createFn = mod.createPostgresConnection as unknown as DialectFactory;

    }
    else if (dialect === 'mysql') {

        const mod = await import('../core/connection/dialects/mysql.js');
        createFn = mod.createMysqlConnection as unknown as DialectFactory;

    }
    else if (dialect === 'mssql') {

        const mod = await import('../core/connection/dialects/mssql.js');
        createFn = mod.createMssqlConnection as unknown as DialectFactory;

    }
    else {

        throw new Error(`Unsupported dialect: ${dialect}`);

    }

    return createFn({ dialect, database: connectionString });

}

// === Event handlers ===

bridge.on('connect', async ({ data }) => {

    const { dialect, connectionString, __cid } = data as Correlated<ConnectionEvents['connect']>;

    if (db) {

        await destroyFn?.();
        db = null;
        destroyFn = null;

    }

    const [conn, err] = await attempt(() =>
        createDialectConnection(dialect as Dialect, connectionString),
    );

    if (err) {

        bridge.emit(`connect:res:${__cid}`, { success: false, error: err.message });

        return;

    }

    db = conn!.db;
    destroyFn = conn!.destroy;

    bridge.emit(`connect:res:${__cid}`, { success: true });

});

bridge.on('disconnect', async ({ data }) => {

    const { __cid } = data as Correlated<ConnectionEvents['disconnect']>;

    if (destroyFn) {

        await destroyFn();
        db = null;
        destroyFn = null;

    }

    bridge.emit(`disconnect:res:${__cid}`, {});

});

bridge.on('query', async ({ data }) => {

    const { sql, params, __cid } = data as Correlated<ConnectionEvents['query']>;

    if (!db) {

        bridge.emit(`query:res:${__cid}`, { rows: [], error: 'Not connected' });

        return;

    }

    const [result, err] = await attempt(() =>
        db!.executeQuery(CompiledQuery.raw(sql, params ?? [])),
    );

    if (err) {

        bridge.emit(`query:res:${__cid}`, { rows: [], error: err.message });

        return;

    }

    bridge.emit(`query:res:${__cid}`, { rows: result!.rows as unknown[] });

});

bridge.on('query:batch', async ({ data }) => {

    const { sql, params, batchSize, offset, __cid } = data as Correlated<ConnectionEvents['query:batch']>;

    if (!db) {

        bridge.emit(`query:batch:res:${__cid}`, {
            rows: [],
            offset,
            hasMore: false,
            error: 'Not connected',
        });

        return;

    }

    const [result, err] = await attempt(() =>
        db!.executeQuery(CompiledQuery.raw(sql, params ?? [])),
    );

    if (err) {

        bridge.emit(`query:batch:res:${__cid}`, {
            rows: [],
            offset,
            hasMore: false,
            error: err.message,
        });

        return;

    }

    const allRows = result!.rows as unknown[];
    const sliced = allRows.slice(offset, offset + batchSize);
    const hasMore = offset + batchSize < allRows.length;

    bridge.emit(`query:batch:res:${__cid}`, { rows: sliced, offset, hasMore });

});

bridge.on('execute', async ({ data }) => {

    const { sql, params, __cid } = data as Correlated<ConnectionEvents['execute']>;

    if (!db) {

        bridge.emit(`execute:res:${__cid}`, { affectedRows: 0, error: 'Not connected' });

        return;

    }

    const [result, err] = await attempt(() =>
        db!.executeQuery(CompiledQuery.raw(sql, params ?? [])),
    );

    if (err) {

        bridge.emit(`execute:res:${__cid}`, { affectedRows: 0, error: err.message });

        return;

    }

    const numAffectedRows = result!.numAffectedRows ?? BigInt(0);
    const affectedRows = typeof numAffectedRows === 'bigint'
        ? Number(numAffectedRows)
        : numAffectedRows;

    bridge.emit(`execute:res:${__cid}`, { affectedRows });

});
