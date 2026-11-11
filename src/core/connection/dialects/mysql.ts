/**
 * MySQL dialect adapter.
 *
 * Uses the 'mysql2' package for MySQL connections.
 * Install with: npm install mysql2
 */
import net, { isIP } from 'node:net';
import type { Duplex } from 'node:stream';

import { attempt } from '@logosdx/utils';
import { Kysely, MysqlDialect } from 'kysely';
import type { MysqlPool, MysqlPoolConnection } from 'kysely';
import type { Connection } from 'mysql2';
import type { ConnectionConfig, ConnectionResult, RuntimeConnectionOptions } from '../types.js';
import { observer } from '../../observer.js';
import { DEFAULT_PORTS, connectTimeoutFor } from '../defaults.js';
import { guardPasswordCallback, trackPoolLogins } from '../login.js';
import { assertConnectionOptions, driverOptionsFor, ipTlsServerNameMessage, tarnPoolOptions } from '../options.js';
import { trackPinnedConnections } from '../pinned.js';

function resolveMysqlSsl(config: ConnectionConfig) {

    const name = config.tlsServerName;

    if (name && isIP(name) !== 0) {

        throw new Error(ipTlsServerNameMessage(name));

    }
    if (name && !config.ssl) {

        throw new Error('MySQL TLS identity options require ssl to be enabled explicitly');

    }
    if (name && typeof config.ssl === 'object' && config.ssl.rejectUnauthorized === false) {

        throw new Error('MySQL TLS identity options require certificate verification');

    }

    if (!config.ssl) return undefined;

    const { ca, cert, key, rejectUnauthorized } = typeof config.ssl === 'object' ? config.ssl : {};

    return {
        ...(ca === undefined ? {} : { ca }),
        ...(cert === undefined ? {} : { cert }),
        ...(key === undefined ? {} : { key }),
        ...(rejectUnauthorized === undefined ? {} : { rejectUnauthorized }),
        ...(name ? { verifyIdentity: true } : {}),
    };

}

type ResolvedKeepAlive = { enableKeepAlive?: boolean; keepAliveInitialDelay?: number };

// mysql2 skips no-delay and keepalive on a caller-supplied socket.
function dialMysqlStream(target: { host: string; port: number }, keepAlive: ResolvedKeepAlive): net.Socket {

    const socket = net.connect({ host: target.host, port: target.port });

    socket.setNoDelay(true);

    if (keepAlive.enableKeepAlive !== false) {

        socket.setKeepAlive(true, keepAlive.keepAliveInitialDelay);

    }

    return socket;

}

/**
 * Build the mysql2 connection options and the Tarn pool options.
 *
 * Later entries win: flat fields, `driver`, then the keys noorm owns. The
 * password is absent on purpose: each physical connection resolves its own.
 * With `tlsServerName`, mysql2 gets that name as `host` (it derives the TLS
 * name from `host` alone) and a `stream` that dials the real host.
 *
 * @example
 * const { connection, pool } = buildMysqlOptions(config, runtime);
 */
export function buildMysqlOptions(config: ConnectionConfig, runtime?: RuntimeConnectionOptions) {

    const keepAliveDelay = config.keepAliveInitialDelayMs;
    const enableKeepAlive = config.keepAlive ?? (keepAliveDelay === undefined ? undefined : true);
    const host = config.host ?? 'localhost';
    const port = config.port ?? DEFAULT_PORTS.mysql;

    assertConnectionOptions(config);

    const ssl = resolveMysqlSsl(config);
    const name = config.tlsServerName;

    return {
        connection: {
            enableKeepAlive,
            keepAliveInitialDelay: keepAliveDelay,
            ...driverOptionsFor('mysql', runtime),
            host: name || host,
            port,
            user: config.user,
            database: config.database,
            ssl,
            stream: name
                ? ({ config: resolved }: { config: ResolvedKeepAlive }) => dialMysqlStream({ host, port }, resolved)
                : undefined,
            connectTimeout: connectTimeoutFor(config),
        },
        pool: tarnPoolOptions(config),
    };

}

/**
 * Close a mysql2 connection without a goodbye.
 *
 * mysql2's `destroy()` only ends the stream. A server that is not reading
 * never sees that, and the socket would stay open.
 *
 * @example
 * closeMysqlConnection(connection);
 */
export function closeMysqlConnection(connection: Connection): void {

    connection.destroy();
    // mysql2's typings omit `stream`, the socket every connection holds.
    (connection as Connection & { stream: Duplex }).stream.destroy();

}

/**
 * Create a MySQL connection.
 *
 * The pool is Tarn for a string password and a password callback alike:
 * mysql2's own pool creates connections synchronously from one shared config,
 * so it cannot await a credential, and it has no `min`.
 *
 * @example
 * ```typescript
 * const conn = createMysqlConnection({
 *     dialect: 'mysql',
 *     host: 'localhost',
 *     database: 'myapp',
 *     user: 'root',
 *     password: 'secret',
 * })
 * ```
 */
export async function createMysqlConnection(
    config: ConnectionConfig,
    runtime?: RuntimeConnectionOptions,
    configName = '__default__',
): Promise<ConnectionResult> {

    const options = buildMysqlOptions(config, runtime);
    // Dynamic import to avoid compile-time dependency
    const mysql2 = await import('mysql2');
    const TarnImport = await import('tarn');
    const Tarn = TarnImport.default ?? TarnImport;
    const createConnection = mysql2.default?.createConnection ?? mysql2.createConnection;
    const password = runtime?.password ? guardPasswordCallback(runtime.password) : () => config.password;
    const failed = new WeakSet<object>();
    const checkedOut = new WeakSet<Connection>();
    const established = new WeakSet<Connection>();
    const pins = trackPinnedConnections();
    const logins = trackPoolLogins(configName, 'MySQL');

    const login = async () => {

        const credential = await password();
        const connection = createConnection({ ...options.connection, password: credential });
        connection.on('error', () => {

            const wasIdle = established.has(connection) && !checkedOut.has(connection);
            failed.add(connection);
            established.delete(connection);

            if (wasIdle) {

                observer.emit('connection:error', {
                    configName,
                    phase: 'idle',
                    error: 'MySQL idle pool connection failed',
                });

            }

        });

        await new Promise<void>((resolve, reject) => {

            connection.connect((err) => {

                if (err) {

                    closeMysqlConnection(connection);
                    reject(err);

                    return;

                }

                resolve();

            });

        });

        established.add(connection);

        return connection;

    };

    const physical = new Tarn.Pool<Connection>({
        ...options.pool,
        create: async () => {

            const [connection, err] = await attempt(login);

            if (err) {

                logins.failed();

                throw err;

            }

            logins.opened();

            return connection;

        },
        validate: (connection) => !failed.has(connection) && connection.state === 'authenticated',
        destroy: (connection) => {

            if (failed.has(connection) || connection.state !== 'authenticated') {

                closeMysqlConnection(connection);

                return Promise.resolve();

            }

            return new Promise<void>((resolve, reject) => {

                connection.end((err) => err ? reject(err) : resolve());

            });

        },
    });

    const pool: MysqlPool = {
        getConnection(callback) {

            const pinTo = pins.claim();

            physical.acquire().promise.then(
                (connection) => {

                    pinTo(connection);
                    checkedOut.add(connection);
                    callback(null, {
                        query: connection.query.bind(connection) as MysqlPoolConnection['query'],
                        release: () => {

                            checkedOut.delete(connection);

                            if (pins.isDiscarded(connection)) {

                                // No goodbye: a dead session would never answer it.
                                // Tarn drops it at the next checkout, where `validate` fails.
                                failed.add(connection);
                                established.delete(connection);
                                closeMysqlConnection(connection);

                            }

                            physical.release(connection);

                        },
                    });

                },
                (err) => callback(err, undefined as unknown as MysqlPoolConnection),
            );

        },
        end(callback) {

            physical.destroy().then(() => callback(null), callback);

        },
    };

    const db = new Kysely<unknown>({
        dialect: new MysqlDialect({ pool }),
    });

    return {
        db,
        dialect: 'mysql',
        destroy: () => db.destroy(),
        withConnection: pins.withConnection(db),
    };

}
