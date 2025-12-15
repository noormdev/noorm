/**
 * SQLite dialect adapter.
 *
 * Uses better-sqlite3 for synchronous, fast SQLite access.
 * Great for local development and testing.
 */
import { Kysely, SqliteDialect } from 'kysely'
import Database from 'better-sqlite3'
import type { ConnectionConfig, ConnectionResult } from '../types.js'


/**
 * Create a SQLite connection.
 *
 * @example
 * ```typescript
 * // In-memory database
 * const conn = createSqliteConnection({ dialect: 'sqlite', database: ':memory:' })
 *
 * // File-based database
 * const conn = createSqliteConnection({ dialect: 'sqlite', database: './data.db' })
 * ```
 */
export function createSqliteConnection(config: ConnectionConfig): ConnectionResult {

    const filename = config.filename ?? config.database

    const db = new Kysely<unknown>({
        dialect: new SqliteDialect({
            database: new Database(filename),
        }),
    })

    return {
        db,
        dialect: 'sqlite',
        destroy: () => db.destroy(),
    }
}
