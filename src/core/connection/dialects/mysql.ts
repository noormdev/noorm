/**
 * MySQL dialect adapter.
 *
 * Uses the 'mysql2' package for MySQL connections.
 * Install with: npm install mysql2
 */
import { Kysely, MysqlDialect } from 'kysely';
import type { MysqlPool, MysqlPoolConnection } from 'kysely';
import type { Connection } from 'mysql2';
import type { ConnectionConfig, ConnectionResult, RuntimeConnectionOptions } from '../types.js';
import { observer } from '../../observer.js';
import { DEFAULT_PORTS, connectTimeoutFor } from '../defaults.js';

/**
 * Create a MySQL connection.
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

    // Dynamic import to avoid compile-time dependency
    const mysql2 = await import('mysql2');
    const options = {
        host: config.host ?? 'localhost',
        port: config.port ?? DEFAULT_PORTS.mysql,
        user: config.user,
        database: config.database,
        ssl: config.ssl ? {} : undefined,
        connectTimeout: connectTimeoutFor(config),
    };

    let pool: MysqlPool;

    if (runtime?.password) {

        // mysql2's native pool uses synchronous creation from a shared config;
        // Tarn permits an async credential lookup for each physical connection.
        const TarnImport = await import('tarn');
        const Tarn = TarnImport.default ?? TarnImport;
        const createConnection = mysql2.default?.createConnection ?? mysql2.createConnection;
        const password = runtime.password;
        const failed = new WeakSet<object>();
        const checkedOut = new WeakSet<Connection>();
        const established = new WeakSet<Connection>();
        const physical = new Tarn.Pool<Connection>({
            min: config.pool?.min ?? 0,
            max: config.pool?.max ?? 10,
            propagateCreateError: true,
            create: async () => {

                const credential = await password();
                const connection = createConnection({ ...options, password: credential });
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

                            connection.destroy();
                            reject(err);

                            return;

                        }

                        resolve();

                    });

                });

                established.add(connection);

                return connection;

            },
            validate: (connection) => !failed.has(connection) && connection.state === 'authenticated',
            destroy: (connection) => {

                if (failed.has(connection) || connection.state !== 'authenticated') {

                    connection.destroy();

                    return Promise.resolve();

                }

                return new Promise<void>((resolve, reject) => {

                    connection.end((err) => err ? reject(err) : resolve());

                });

            },
        });

        pool = {
            getConnection(callback) {

                physical.acquire().promise.then(
                    (connection) => {

                        checkedOut.add(connection);
                        callback(null, {
                            query: connection.query.bind(connection) as MysqlPoolConnection['query'],
                            release: () => {

                                checkedOut.delete(connection);
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

    }
    else {

        const createPool = mysql2.default?.createPool ?? mysql2.createPool;
        pool = createPool({
            ...options,
            password: config.password,
            connectionLimit: config.pool?.max ?? 10,
        });

    }

    const db = new Kysely<unknown>({
        dialect: new MysqlDialect({ pool }),
    });

    return {
        db,
        dialect: 'mysql',
        destroy: () => db.destroy(),
    };

}
