/**
 * PostgreSQL dialect adapter.
 *
 * Uses the 'pg' package for PostgreSQL connections.
 * Install with: npm install pg @types/pg
 */
import { checkServerIdentity } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import { Kysely, PostgresDialect } from 'kysely';
import type { Client as PgClient, PoolClient as PgPoolClient } from 'pg';
import type { ConnectionConfig, ConnectionResult, RuntimeConnectionOptions } from '../types.js';
import { observer } from '../../observer.js';
import { DEFAULT_PORTS, connectTimeoutFor } from '../defaults.js';
import { guardPasswordCallback, trackPoolLogins } from '../login.js';
import { assertConnectionOptions, driverOptionsFor, pgPoolOptions } from '../options.js';
import { trackPinnedConnections } from '../pinned.js';

function resolveSsl(config: ConnectionConfig, runtime?: RuntimeConnectionOptions) {

    const name = config.tlsServerName;
    const verifier = runtime?.checkServerIdentity;

    if ((name || verifier) && !config.ssl) {

        throw new Error('PostgreSQL TLS identity options require ssl to be enabled explicitly');

    }
    if ((name || verifier) && typeof config.ssl === 'object' && config.ssl.rejectUnauthorized === false) {

        throw new Error('PostgreSQL TLS identity options require certificate verification');

    }

    if (!name && !verifier) return config.ssl;

    return {
        ...(typeof config.ssl === 'object' ? config.ssl : {}),
        ...(name ? { servername: name } : {}),
        // pg overwrites servername with the dial host for DNS hosts. Verify
        // the configured identity explicitly, irrespective of that override.
        checkServerIdentity: (host: string, cert: PeerCertificate) =>
            (verifier ?? checkServerIdentity)(name ?? host, cert),
    };

}

/**
 * Build the `pg` Pool config from noorm config and runtime options.
 *
 * Later entries win: flat fields, the typed `pool`, `driver`, then the keys
 * noorm owns, so `driver` cannot move the connection or resize the pool.
 * Kept separate from the pool so that order can be asserted without a server.
 *
 * @example
 * const pool = new Pool({ ...buildPostgresPoolOptions(config, runtime), Client });
 */
export function buildPostgresPoolOptions(config: ConnectionConfig, runtime?: RuntimeConnectionOptions) {

    assertConnectionOptions(config);

    return {
        statement_timeout: config.statementTimeoutMs,
        query_timeout: config.queryTimeoutMs,
        application_name: config.applicationName,
        keepAlive: config.keepAlive ?? (config.keepAliveInitialDelayMs === undefined ? undefined : true),
        keepAliveInitialDelayMillis: config.keepAliveInitialDelayMs,
        ...pgPoolOptions(config.pool),
        ...driverOptionsFor('postgres', runtime),
        host: config.host ?? 'localhost',
        port: config.port ?? DEFAULT_PORTS.postgres,
        user: config.user,
        password: runtime?.password ? guardPasswordCallback(runtime.password) : config.password,
        database: config.database,
        min: config.pool?.min ?? 0,
        max: config.pool?.max ?? 10,
        ssl: resolveSsl(config, runtime),
        // pg's own default is 0, meaning wait forever: an unreachable host
        // never comes back without this.
        connectionTimeoutMillis: connectTimeoutFor(config),
    };

}

/**
 * Create a PostgreSQL connection.
 *
 * @example
 * ```typescript
 * const conn = createPostgresConnection({
 *     dialect: 'postgres',
 *     host: 'localhost',
 *     database: 'myapp',
 *     user: 'postgres',
 *     password: 'secret',
 * })
 * ```
 */
export async function createPostgresConnection(
    config: ConnectionConfig,
    runtime?: RuntimeConnectionOptions,
    configName = '__default__',
): Promise<ConnectionResult> {

    const options = buildPostgresPoolOptions(config, runtime);
    // Dynamic import to avoid compile-time dependency
    const pg = await import('pg');
    const Pool = pg.default?.Pool ?? pg.Pool;
    const Client = pg.default?.Client ?? pg.Client;
    const logins = trackPoolLogins(configName, 'PostgreSQL');

    // pg-pool drops failed clients without closing password-auth sockets.
    // Close them before returning the error; pool.end() cannot reclaim them.
    class ConnectionClient extends Client {

        override connect(): Promise<PgClient>;
        override connect(
            callback: ((error: Error) => void) | ((error: null, client: PgClient) => void),
        ): void;
        override connect(
            callback?: ((error: Error) => void) | ((error: null, client: PgClient) => void),
        ): Promise<PgClient> | void {

            if (!callback) {

                const { promise, resolve, reject } = Promise.withResolvers<PgClient>();
                this.connect((error: Error | null) => {

                    if (error) reject(error);
                    else resolve(this);

                });

                return promise;

            }

            const done = callback as (error: Error | null, client?: PgClient) => void;
            let settled = false;

            super.connect((error: Error | null) => {

                // pg calls back again when a password callback rejects after
                // the connect timeout already failed the same connect.
                if (settled) return;

                settled = true;

                if (error) {

                    logins.failed();
                    this.end(() => done(error));
                    // Failed authentication must not wait for the peer to
                    // finish a graceful protocol shutdown.
                    this.connection.stream.destroy();

                    return;

                }

                logins.opened();
                done(null, this);

            });

        }

    }

    const pool = new Pool({ ...options, Client: ConnectionClient });

    const checkedOut = new WeakSet<PgPoolClient>();
    const reportedFailures = new WeakSet<PgPoolClient>();

    // pg-pool removes its client error listener while a client is checked out.
    // Keep ours through release and disposal, without replacing pg's cleanup.
    pool.on('connect', (client) => {

        client.on('error', () => {

            if (!checkedOut.has(client) || reportedFailures.has(client)) return;
            reportedFailures.add(client);
            observer.emit('connection:error', {
                configName,
                phase: 'checked-out',
                error: 'PostgreSQL checked-out connection failed',
            });

        });

    });
    pool.on('acquire', (client) => checkedOut.add(client));
    pool.on('release', (_error, client) => checkedOut.delete(client));
    pool.on('remove', (client) => checkedOut.delete(client));

    // Driver errors can contain arbitrary secrets. Query errors still propagate
    // unchanged; report a failed client only once, including during its disposal.
    pool.on('error', (_error, client) => {

        if (reportedFailures.has(client)) return;
        reportedFailures.add(client);

        observer.emit('connection:error', {
            configName,
            phase: 'idle',
            error: 'PostgreSQL idle pool connection failed',
        });

    });

    const pins = trackPinnedConnections();

    const connect = async () => {

        const pinTo = pins.claim();
        const client = await pool.connect();
        const release = client.release;

        pinTo(client);
        client.release = () => {

            if (!pins.isDiscarded(client)) return release();

            // Closing it on purpose is not a failure to report.
            reportedFailures.add(client);
            release(true);

            // pg-pool serves queued checkouts only once the socket closes,
            // and a half-open one never answers pg's graceful end.
            if (client instanceof ConnectionClient) client.connection.stream.destroy();

        };

        return client;

    };

    const db = new Kysely<unknown>({
        dialect: new PostgresDialect({ pool: { connect, end: () => pool.end() } }),
    });

    return {
        db,
        dialect: 'postgres',
        destroy: () => db.destroy(),
        withConnection: pins.withConnection(db),
    };

}
