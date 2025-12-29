/**
 * MySQL dialect adapter.
 *
 * Uses the 'mysql2' package for MySQL connections.
 * Install with: npm install mysql2
 */
import { Kysely, MysqlDialect } from 'kysely';
import type { ConnectionConfig, ConnectionResult } from '../types.js';

/**
 * Create a MySQL connection.
 *
 * @example
 * ```typescript
 * const conn = createMysqlConnection({
 *     dialect: 'mysql',
 *     host: 'localhost',
 *     port: 3306,
 *     database: 'myapp',
 *     user: 'root',
 *     password: 'secret',
 * })
 * ```
 */
export async function createMysqlConnection(config: ConnectionConfig): Promise<ConnectionResult> {

    // Dynamic import to avoid compile-time dependency
    const mysql2 = await import('mysql2');
    const createPool = mysql2.default?.createPool ?? mysql2.createPool;

    const pool = createPool({
        host: config.host ?? 'localhost',
        port: config.port ?? 3306,
        user: config.user,
        password: config.password,
        database: config.database,
        connectionLimit: config.pool?.max ?? 10,
        ssl: config.ssl ? {} : undefined,
    });

    const db = new Kysely<unknown>({
        dialect: new MysqlDialect({ pool }),
    });

    return {
        db,
        dialect: 'mysql',
        destroy: () => db.destroy(),
    };

}
