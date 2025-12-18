/**
 * PostgreSQL dialect adapter.
 *
 * Uses the 'pg' package for PostgreSQL connections.
 * Install with: npm install pg @types/pg
 */
import { Kysely, PostgresDialect } from 'kysely'
import type { ConnectionConfig, ConnectionResult } from '../types.js'


/**
 * Create a PostgreSQL connection.
 *
 * @example
 * ```typescript
 * const conn = createPostgresConnection({
 *     dialect: 'postgres',
 *     host: 'localhost',
 *     port: 5432,
 *     database: 'myapp',
 *     user: 'postgres',
 *     password: 'secret',
 * })
 * ```
 */
export function createPostgresConnection(config: ConnectionConfig): ConnectionResult {

    // Dynamic require to avoid compile-time dependency
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const pg = require('pg')
    const { Pool } = pg

    const pool = new Pool({
        host: config.host ?? 'localhost',
        port: config.port ?? 5432,
        user: config.user,
        password: config.password,
        database: config.database,
        min: config.pool?.min ?? 0,
        max: config.pool?.max ?? 10,
        ssl: config.ssl,
    })

    const db = new Kysely<unknown>({
        dialect: new PostgresDialect({ pool }),
    })

    return {
        db,
        dialect: 'postgres',
        destroy: () => db.destroy(),
    }
}
