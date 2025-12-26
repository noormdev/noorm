/**
 * SQL Server (MSSQL) dialect adapter.
 *
 * Uses 'tedious' and 'tarn' packages for MSSQL connections.
 * Install with: npm install tedious tarn
 */
import { Kysely, MssqlDialect } from 'kysely'
import type { ConnectionConfig, ConnectionResult } from '../types.js'


/**
 * Create a SQL Server connection.
 *
 * @example
 * ```typescript
 * const conn = createMssqlConnection({
 *     dialect: 'mssql',
 *     host: 'localhost',
 *     port: 1433,
 *     database: 'myapp',
 *     user: 'sa',
 *     password: 'secret',
 * })
 * ```
 */
export async function createMssqlConnection(config: ConnectionConfig): Promise<ConnectionResult> {

    // Dynamic import to avoid compile-time dependency
    const Tedious = await import('tedious')
    // @ts-expect-error - tarn types not installed, loaded dynamically
    const Tarn = await import('tarn')

    const db = new Kysely<unknown>({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: config.pool?.min ?? 0,
                    max: config.pool?.max ?? 10,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () =>
                    new Tedious.Connection({
                        server: config.host ?? 'localhost',
                        authentication: {
                            type: 'default',
                            options: {
                                userName: config.user,
                                password: config.password,
                            },
                        },
                        options: {
                            port: config.port ?? 1433,
                            database: config.database,
                            trustServerCertificate: !config.ssl,
                            encrypt: !!config.ssl,
                        },
                    }),
            },
        }),
    })

    return {
        db,
        dialect: 'mssql',
        destroy: () => db.destroy(),
    }
}
