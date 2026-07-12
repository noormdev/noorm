/**
 * SQL Server (MSSQL) dialect adapter.
 *
 * Uses 'tedious' and 'tarn' packages for MSSQL connections.
 * Install with: npm install tedious tarn
 *
 * Verifies database existence via sys.databases before connecting
 * to the target database, avoiding cryptic ECONNRESET errors when
 * the database doesn't exist.
 */
import { Kysely, MssqlDialect, sql } from 'kysely';
import type { ConnectionConfig, ConnectionResult } from '../types.js';
import { DEFAULT_PORTS } from '../defaults.js';
import { MssqlLimitPlugin } from './mssql-limit-plugin.js';

/**
 * Build tedious connection options from noorm config.
 *
 * Centralizes the tedious config so both the preflight check
 * and the real pool use the same settings.
 */
function buildTediousConfig(
    Tedious: typeof import('tedious'),
    config: ConnectionConfig,
    database?: string,
) {

    return new Tedious.Connection({
        server: config.host ?? 'localhost',
        authentication: {
            type: 'default',
            options: {
                userName: config.user,
                password: config.password,
            },
        },
        options: {
            port: config.port ?? DEFAULT_PORTS.mssql,
            database: database ?? config.database,
            trustServerCertificate: !config.ssl,
            encrypt: true,
        },
    });

}

/**
 * Verify the target database exists by querying sys.databases on master.
 *
 * Connects to 'master' first and checks sys.databases. Throws a clear
 * error if the database is missing, instead of letting tedious hang
 * with a cryptic ECONNRESET.
 */
async function verifyDatabaseExists(
    Tedious: typeof import('tedious'),
    Tarn: typeof import('tarn'),
    config: ConnectionConfig,
): Promise<void> {

    const masterDb = new Kysely<unknown>({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: 0,
                    max: 1,
                    propagateCreateError: true,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () => buildTediousConfig(Tedious, config, 'master'),
            },
        }),
        plugins: [new MssqlLimitPlugin()],
    });

    try {

        const { rows } = await sql<{ name: string }>`
            SELECT name FROM sys.databases WHERE name = ${config.database}
        `.execute(masterDb);

        if (rows.length === 0) {

            throw new Error(
                `Database '${config.database}' does not exist on ${config.host ?? 'localhost'}:${config.port ?? DEFAULT_PORTS.mssql}`,
            );

        }

    }
    finally {

        await masterDb.destroy();

    }

}

/**
 * Create a SQL Server connection.
 *
 * Verifies the target database exists via master before opening
 * the connection pool. This avoids the tedious/tarn hang that
 * occurs when MSSQL rejects login for a non-existent database.
 *
 * @example
 * ```typescript
 * const conn = createMssqlConnection({
 *     dialect: 'mssql',
 *     host: 'localhost',
 *     database: 'myapp',
 *     user: 'sa',
 *     password: 'secret',
 * })
 * ```
 */
export async function createMssqlConnection(config: ConnectionConfig): Promise<ConnectionResult> {

    // Dynamic import to avoid compile-time dependency. Normalize CJS interop:
    // when bundled (tsup), the module's exports land under `.default`, so a
    // bare `Tarn.Pool` is undefined and kysely throws "Pool is not a
    // constructor". Mirror the postgres dialect's `pkg.default ?? pkg` guard.
    const TediousImport = await import('tedious');
    const TarnImport = await import('tarn');
    const Tedious = TediousImport.default ?? TediousImport;
    const Tarn = TarnImport.default ?? TarnImport;

    // Preflight: verify database exists via master
    await verifyDatabaseExists(Tedious, Tarn, config);

    const db = new Kysely<unknown>({
        dialect: new MssqlDialect({
            tarn: {
                ...Tarn,
                options: {
                    min: config.pool?.min ?? 0,
                    max: config.pool?.max ?? 10,
                    propagateCreateError: true,
                },
            },
            tedious: {
                ...Tedious,
                connectionFactory: () => buildTediousConfig(Tedious, config),
            },
        }),
        plugins: [new MssqlLimitPlugin()],
    });

    return {
        db,
        dialect: 'mssql',
        destroy: () => db.destroy(),
    };

}
