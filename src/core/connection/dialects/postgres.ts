/**
 * PostgreSQL dialect adapter.
 *
 * Uses the 'pg' package for PostgreSQL connections.
 * Install with: npm install pg @types/pg
 */
import { checkServerIdentity } from 'node:tls';
import type { PeerCertificate } from 'node:tls';
import { Kysely, PostgresDialect } from 'kysely';
import type { Client as PgClient } from 'pg';
import type { ConnectionConfig, ConnectionResult, RuntimeConnectionOptions } from '../types.js';
import { observer } from '../../observer.js';
import { DEFAULT_PORTS, connectTimeoutFor } from '../defaults.js';

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

    // Dynamic import to avoid compile-time dependency
    const pg = await import('pg');
    const name = config.tlsServerName;
    const verifier = runtime?.checkServerIdentity;
    if ((name || verifier) && !config.ssl) {

        throw new Error('PostgreSQL TLS identity options require ssl to be enabled explicitly');

    }
    if ((name || verifier) && typeof config.ssl === 'object' && config.ssl.rejectUnauthorized === false) {

        throw new Error('PostgreSQL TLS identity options require certificate verification');

    }
    const ssl = name || verifier
        ? {
            ...(typeof config.ssl === 'object' ? config.ssl : {}),
            ...(name ? { servername: name } : {}),
            // pg overwrites servername with the dial host for DNS hosts. Verify
            // the configured identity explicitly, irrespective of that override.
            checkServerIdentity: (host: string, cert: PeerCertificate) =>
                (verifier ?? checkServerIdentity)(name ?? host, cert),
        }
        : config.ssl;

    const Pool = pg.default?.Pool ?? pg.Pool;
    const Client = pg.default?.Client ?? pg.Client;

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
            super.connect((error: Error | null) => {

                if (error) {

                    this.end(() => done(error));
                    // Failed authentication must not wait for the peer to
                    // finish a graceful protocol shutdown.
                    this.connection.stream.destroy();

                    return;

                }

                done(null, this);

            });

        }

    }

    const pool = new Pool({
        Client: ConnectionClient,
        host: config.host ?? 'localhost',
        port: config.port ?? DEFAULT_PORTS.postgres,
        user: config.user,
        password: runtime?.password ?? config.password,
        database: config.database,
        min: config.pool?.min ?? 0,
        max: config.pool?.max ?? 10,
        idleTimeoutMillis: config.pool?.idleTimeoutMillis,
        statement_timeout: config.statementTimeoutMs,
        query_timeout: config.queryTimeoutMs,
        application_name: config.applicationName,
        keepAlive: config.keepAlive,
        ssl,
        // pg's own default is 0, meaning wait forever: an unreachable host
        // never comes back without this.
        connectionTimeoutMillis: connectTimeoutFor(config),
    });

    // Driver errors can contain arbitrary secrets. Active query errors still
    // propagate to their caller; this listener covers idle clients only.
    pool.on('error', () => {

        observer.emit('connection:error', {
            configName,
            phase: 'idle',
            error: 'PostgreSQL idle pool connection failed',
        });

    });

    const db = new Kysely<unknown>({
        dialect: new PostgresDialect({ pool }),
    });

    return {
        db,
        dialect: 'postgres',
        destroy: () => db.destroy(),
    };

}
