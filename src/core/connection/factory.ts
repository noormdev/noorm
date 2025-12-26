/**
 * Connection factory with retry logic.
 *
 * Creates database connections with automatic retry for transient failures.
 * Uses lazy imports to avoid requiring all database drivers.
 */
import { sql } from 'kysely'
import { retry, attempt } from '@logosdx/utils'
import type { ConnectionConfig, ConnectionResult, Dialect } from './types.js'
import { observer } from '../observer.js'


type DialectFactory = (config: ConnectionConfig) => ConnectionResult | Promise<ConnectionResult>


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
            return (await import('./dialects/sqlite.js')).createSqliteConnection

        case 'postgres':
            return (await import('./dialects/postgres.js')).createPostgresConnection

        case 'mysql':
            return (await import('./dialects/mysql.js')).createMysqlConnection

        case 'mssql':
            return (await import('./dialects/mssql.js')).createMssqlConnection

        default:
            throw new Error(`Unsupported dialect: ${dialect}`)
    }
}


/**
 * Get the install command for a dialect's driver.
 */
function getInstallCommand(dialect: Dialect): string {

    const commands: Record<Dialect, string> = {
        postgres: 'npm install pg',
        mysql: 'npm install mysql2',
        sqlite: 'npm install better-sqlite3',
        mssql: 'npm install tedious tarn',
    }
    return commands[dialect]
}


/**
 * Create a database connection with retry logic.
 *
 * Automatically retries on transient connection failures (ECONNREFUSED, ETIMEDOUT).
 * Does not retry authentication failures or missing drivers.
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
    configName: string = '__default__'
): Promise<ConnectionResult> {

    const [conn, err] = await attempt(() =>
        retry(
            async () => {

                const [createFn, importErr] = await attempt(() => getDialectFactory(config.dialect))

                if (importErr) {

                    const message = importErr.message
                    if (message.includes('Cannot find module')) {

                        throw new Error(
                            `Missing driver for ${config.dialect}. Install it with:\n` +
                            getInstallCommand(config.dialect)
                        )
                    }
                    throw importErr
                }

                const conn = await createFn!(config)

                // Test connection with simple query
                await sql`SELECT 1`.execute(conn.db)

                return conn
            },
            {
                retries: 3,
                delay: 1000,
                backoff: 2,  // 1s, 2s, 4s
                jitterFactor: 0.1,
                shouldRetry: (err) => {

                    const msg = err.message.toLowerCase()

                    // Don't retry auth failures
                    if (msg.includes('authentication')) return false
                    if (msg.includes('password')) return false
                    if (msg.includes('missing driver')) return false

                    // Retry connection issues
                    return msg.includes('econnrefused') ||
                           msg.includes('etimedout') ||
                           msg.includes('too many connections') ||
                           msg.includes('connection reset')
                }
            }
        )
    )

    if (err) {

        observer.emit('connection:error', { configName, error: err.message })
        throw err
    }

    observer.emit('connection:open', { configName, dialect: config.dialect })
    return conn!
}


/**
 * Default system databases by dialect.
 * Used for testing server connectivity without requiring the target database to exist.
 */
const SYSTEM_DATABASES: Record<Dialect, string | undefined> = {
    postgres: 'postgres',
    mysql: undefined,  // MySQL allows connecting without a database
    sqlite: undefined, // SQLite creates the file on connect
    mssql: 'master',
}


/**
 * Test a connection config without keeping the connection open.
 *
 * Useful for validating config before saving or for health checks.
 *
 * @param config - Connection configuration to test
 * @param options - Test options
 * @param options.testServerOnly - If true, connects to system database instead of target.
 *                                  Useful when the target database doesn't exist yet.
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
    options: { testServerOnly?: boolean } = {}
): Promise<{ ok: boolean; error?: string }> {

    let testConfig = config

    // If testing server only, swap to system database
    if (options.testServerOnly && config.dialect !== 'sqlite') {

        const systemDb = SYSTEM_DATABASES[config.dialect]

        testConfig = {
            ...config,
            database: systemDb ?? config.database,
        }
    }

    const [conn, err] = await attempt(() => createConnection(testConfig, '__test__'))

    if (err) {

        return { ok: false, error: err.message }
    }

    await conn!.destroy()
    return { ok: true }
}
