/**
 * Connection factory with retry logic.
 *
 * Creates database connections with automatic retry for transient failures.
 * Uses lazy imports to avoid requiring all database drivers.
 */
import { accessSync, constants as fsConstants, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { sql } from 'kysely';
import { retry, attempt, attemptSync, runWithTimeout, isTimeoutError } from '@logosdx/utils';
import type { ConnectionConfig, ConnectionResult, Dialect } from './types.js';
import { observer } from '../observer.js';
import { OperationAbortedError, raceAbort, throwIfAborted } from '../shared/abort.js';
import { getConnectionManager } from './manager.js';
import { connectTimeoutFor } from './defaults.js';

type DialectFactory = (config: ConnectionConfig) => ConnectionResult | Promise<ConnectionResult>;

/**
 * Get the dialect factory function.
 *
 * Uses dynamic import to lazy-load dialect modules.
 * This allows the connection module to be imported even when
 * specific database drivers aren't installed.
 */
async function getDialectFactory(dialect: Dialect): Promise<DialectFactory> {

    switch (dialect) {

    case 'sqlite':
        if (typeof (globalThis as Record<string, unknown>)['Bun'] !== 'undefined') {

            return (await import('./dialects/sqlite-bun.js')).createBunSqliteConnection;

        }

        return (await import('./dialects/sqlite.js')).createSqliteConnection;

    case 'postgres':
        return (await import('./dialects/postgres.js')).createPostgresConnection;

    case 'mysql':
        return (await import('./dialects/mysql.js')).createMysqlConnection;

    case 'mssql':
        return (await import('./dialects/mssql.js')).createMssqlConnection;

    default:
        throw new Error(`Unsupported dialect: ${dialect}`);

    }

}

/**
 * Get the install command for a dialect's driver.
 */
function getInstallCommand(dialect: Dialect): string {

    const commands: Record<Dialect, string> = {
        postgres: 'npm install pg',
        mysql: 'npm install mysql2',
        sqlite: 'npm install better-sqlite3  (not needed with noorm binary)',
        mssql: 'npm install tedious tarn',
    };

    return commands[dialect];

}

/**
 * Retry/backoff behavior for a connection attempt.
 *
 * Defaults preserve the standard 3-attempt backoff connecting commands
 * rely on. A best-effort probe (e.g. resolving the vault tier for
 * `run preview`/`run inspect`, which are documented-offline commands)
 * opts out with `{ retries: 1, delay: 0 }` — one attempt, no wait — so an
 * unreachable database fails in milliseconds instead of the ~6-7s the
 * default policy adds.
 */
export interface ConnectionRetryOptions {
    /** Number of attempts before giving up. @default 3 */
    retries?: number;
    /** Delay in ms before each retry, before the backoff multiplier. @default 1000 */
    delay?: number;
    /** Multiplier applied to the delay on every retry. @default 2 */
    backoff?: number;
}

/**
 * Milliseconds a `destroy()` on an abandoned connection may take before it is
 * left to the garbage collector.
 *
 * Closing a pool whose socket is already dead can hang exactly the way opening
 * it did, which is why `ConnectionManager.closeAll` wraps its own destroys the
 * same way. Without the bound, the cleanup for a hang would be a second hang.
 */
const DISCARD_TIMEOUT_MS = 5_000;

/**
 * Milliseconds the liveness probe is allowed on top of the driver's own
 * connect timeout.
 *
 * The two deadlines would otherwise be identical and race, and the driver's
 * loss is the bad outcome: only it can tear down its socket, and only it knows
 * enough to say "Connection terminated due to connection timeout" instead of a
 * generic one. The grace lets the driver report first and leaves the probe as
 * the backstop for the case no driver option covers — a socket that opened and
 * then went silent.
 */
const PROBE_GRACE_MS = 2_000;

/**
 * Close a connection whose caller has stopped waiting for it.
 *
 * The window between "the user pressed Escape" and "the driver finally
 * connected" leaves a live pool with no reference to it anywhere. This is the
 * only thing that reclaims it.
 *
 * @example
 * // raceAbort hands the late arrival here rather than dropping it
 * return raceAbort(openConnection(config), signal, discardConnection);
 */
export async function discardConnection(
    conn: Pick<ConnectionResult, 'destroy'>,
    timeoutMs: number = DISCARD_TIMEOUT_MS,
): Promise<void> {

    const [, err] = await attempt(() =>
        runWithTimeout(() => conn.destroy(), { timeout: timeoutMs, throws: true }),
    );

    if (err) {

        observer.emit('error', { source: 'connection', error: err });

    }

}

/**
 * Open a connection, retrying transient failures.
 *
 * Split out from `createConnection` so the abort race wraps the whole thing:
 * the caller stops waiting at the boundary, while this keeps running to the
 * point where its result can be handed back for cleanup.
 */
async function openConnection(
    config: ConnectionConfig,
    configName: string,
    retryOptions: ConnectionRetryOptions,
    signal?: AbortSignal,
): Promise<ConnectionResult> {

    const { retries = 3, delay = 1000, backoff = 2 } = retryOptions;
    const connectTimeout = connectTimeoutFor(config);

    const [conn, err] = await attempt(() =>
        retry(
            async () => {

                const [createFn, importErr] = await attempt(() =>
                    getDialectFactory(config.dialect),
                );

                if (importErr) {

                    const message = importErr.message;
                    if (message.includes('Cannot find module')) {

                        throw new Error(
                            `Missing driver for ${config.dialect}. Install it with:\n` +
                                getInstallCommand(config.dialect),
                        );

                    }
                    throw importErr;

                }

                const conn = await createFn!(config);

                // The driver can hand back a live pool after the caller gave
                // up. Nothing else holds it at this point, so close it here.
                if (signal?.aborted) {

                    void discardConnection(conn);

                    throw new OperationAbortedError();

                }

                // A socket that opened and then went quiet is what a blackholed
                // network looks like from here, and no driver connect timeout
                // covers it — the connect already succeeded.
                const [, probeErr] = await attempt(() =>
                    runWithTimeout(() => sql`SELECT 1`.execute(conn.db), {
                        timeout: connectTimeout + PROBE_GRACE_MS,
                        throws: true,
                    }),
                );

                if (probeErr) {

                    void discardConnection(conn);

                    // "Function timed out" is what the wrapper says, and it
                    // would be the whole of what the user sees.
                    if (isTimeoutError(probeErr)) {

                        throw new Error(
                            `Database did not respond within ${connectTimeout + PROBE_GRACE_MS}ms`,
                        );

                    }

                    throw probeErr;

                }

                return conn;

            },
            {
                retries,
                delay,
                backoff,
                jitterFactor: 0.1,
                signal,
                shouldRetry: (err) => {

                    // Retrying something the caller walked away from would
                    // hold the pool open for another two rounds of backoff.
                    if (err instanceof OperationAbortedError) return false;

                    const msg = err.message.toLowerCase();

                    // Don't retry auth/config failures
                    if (msg.includes('authentication')) return false;
                    if (msg.includes('password')) return false;
                    if (msg.includes('missing driver')) return false;
                    if (msg.includes('login failed')) return false;
                    if (msg.includes('failed to open')) return false;
                    if (msg.includes('does not exist')) return false;
                    if (msg.includes('unknown database')) return false;
                    if (msg.includes('access denied')) return false;

                    // Retry transient connection issues
                    return (
                        msg.includes('econnrefused') ||
                        msg.includes('etimedout') ||
                        msg.includes('too many connections') ||
                        msg.includes('connection reset')
                    );

                },
            },
        ),
    );

    if (err) {

        observer.emit('connection:error', { configName, error: err.message });
        throw err;

    }

    // Track connection with manager for auto-cleanup on shutdown
    const manager = getConnectionManager();
    const trackId = manager.track(conn!, configName);

    // Wrap destroy to also untrack from manager
    const originalDestroy = conn!.destroy;
    const wrappedDestroy = async (): Promise<void> => {

        manager.untrack(trackId);
        await originalDestroy();
        observer.emit('connection:close', { configName });

    };

    const trackedConn: ConnectionResult = {
        db: conn!.db,
        dialect: conn!.dialect,
        destroy: wrappedDestroy,
    };

    // host/port/database remove the "which database was I actually talking
    // to" ambiguity (#51) -- never user/password.
    observer.emit('connection:open', {
        configName,
        dialect: config.dialect,
        host: config.host,
        port: config.port,
        database: config.database,
    });

    return trackedConn;

}

/**
 * Create a database connection with retry logic.
 *
 * Automatically retries on transient connection failures (ECONNREFUSED, ETIMEDOUT).
 * Does not retry authentication failures or missing drivers.
 *
 * Pass `signal` to be able to stop waiting. Aborting rejects with
 * `OperationAbortedError` right away; the driver is not obliged to notice, so
 * a connection that opens afterwards is closed rather than left half-open.
 * Omit it and nothing about the call changes.
 *
 * @example
 * ```typescript
 * const conn = await createConnection({
 *     dialect: 'postgres',
 *     host: 'localhost',
 *     database: 'myapp',
 *     user: 'postgres',
 *     password: 'secret',
 * })
 *
 * await sql`SELECT 1`.execute(conn.db)
 * await conn.destroy()
 * ```
 */
export async function createConnection(
    config: ConnectionConfig,
    configName: string = '__default__',
    retryOptions: ConnectionRetryOptions = {},
    signal?: AbortSignal,
): Promise<ConnectionResult> {

    throwIfAborted(signal);

    return raceAbort(
        openConnection(config, configName, retryOptions, signal),
        signal,
        discardConnection,
    );

}

/**
 * Default system databases by dialect.
 * Used for testing server connectivity without requiring the target database to exist.
 */
const SYSTEM_DATABASES: Record<Dialect, string | undefined> = {
    postgres: 'postgres',
    mysql: undefined, // MySQL allows connecting without a database
    sqlite: undefined, // SQLite creates the file on connect
    mssql: 'master',
};

/**
 * Test a connection config without keeping the connection open.
 *
 * Useful for validating config before saving or for health checks.
 *
 * @param config - Connection configuration to test
 * @param options - Test options
 * @param options.testServerOnly - If true, connects to system database instead of target.
 *                                  Useful when the target database doesn't exist yet.
 * @param options.signal - Abort to stop waiting. The result comes back with
 *                         `aborted: true` so a caller can say so honestly
 *                         instead of reporting a database error.
 *
 * @example
 * ```typescript
 * // Test full connection (database must exist)
 * const result = await testConnection(config)
 *
 * // Test server only (database doesn't need to exist)
 * const result = await testConnection(config, { testServerOnly: true })
 *
 * if (!result.ok) {
 *     console.error('Connection failed:', result.error)
 * }
 * ```
 */
export async function testConnection(
    config: ConnectionConfig,
    options: { testServerOnly?: boolean; signal?: AbortSignal } = {},
): Promise<{ ok: boolean; error?: string; aborted?: boolean }> {

    let testConfig = config;

    // If testing server only, swap to system database
    if (options.testServerOnly && config.dialect !== 'sqlite') {

        const systemDb = SYSTEM_DATABASES[config.dialect];

        testConfig = {
            ...config,
            database: systemDb ?? config.database,
        };

    }

    // SQLite has no system database to swap to, so the probe would open the
    // target — and the driver creates the file. Probe the directory that
    // would hold it instead: that is the SQLite equivalent of "can I reach
    // the server", and it leaves nothing behind. An existing target still
    // gets opened, so a corrupt or unreadable file is still reported.
    if (options.testServerOnly && config.dialect === 'sqlite') {

        const filename = config.filename ?? config.database;

        if (filename !== ':memory:' && !existsSync(filename)) {

            const [, dirErr] = attemptSync(() => accessSync(dirname(resolve(filename)), fsConstants.W_OK));

            if (dirErr) {

                return { ok: false, error: `Cannot reach SQLite target directory: ${dirErr.message}` };

            }

            return { ok: true };

        }

    }

    const [conn, err] = await attempt(() =>
        createConnection(testConfig, '__test__', {}, options.signal),
    );

    if (err) {

        if (err instanceof OperationAbortedError) {

            return { ok: false, error: err.message, aborted: true };

        }

        return { ok: false, error: err.message };

    }

    await conn!.destroy();

    return { ok: true };

}
