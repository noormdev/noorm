/**
 * Connection manager with caching.
 *
 * Manages active database connections, providing caching and cleanup.
 * Use this for long-running processes that need to reuse connections.
 */
import { attempt } from '@logosdx/utils'
import type { Config } from '../config/types.js'
import type { ConnectionResult } from './types.js'
import { createConnection } from './factory.js'
import { observer } from '../observer.js'


/**
 * Manages a pool of named database connections.
 *
 * @example
 * ```typescript
 * const manager = getConnectionManager()
 *
 * // Get or create connection
 * const conn = await manager.getConnection(config)
 *
 * // Use it
 * await sql`SELECT 1`.execute(conn.db)
 *
 * // Close when done
 * await manager.closeAll()
 * ```
 */
class ConnectionManager {

    private connections = new Map<string, ConnectionResult>()

    /**
     * Get or create a connection for a config.
     *
     * If a connection already exists for this config name, returns it.
     * Otherwise creates a new connection and caches it.
     */
    async getConnection(config: Config): Promise<ConnectionResult> {

        const key = config.name

        if (this.connections.has(key)) {

            return this.connections.get(key)!
        }

        const conn = await createConnection(config.connection, config.name)
        this.connections.set(key, conn)
        return conn
    }

    /**
     * Close a specific connection by config name.
     */
    async closeConnection(configName: string): Promise<void> {

        const conn = this.connections.get(configName)
        if (conn) {

            const [, err] = await attempt(() => conn.destroy())
            this.connections.delete(configName)

            if (err) {

                observer.emit('error', { source: 'connection', error: err })
            }
            else {

                observer.emit('connection:close', { configName })
            }
        }
    }

    /**
     * Close all connections.
     *
     * Call this at app shutdown to clean up resources.
     */
    async closeAll(): Promise<void> {

        const names = Array.from(this.connections.keys())
        for (const name of names) {

            await this.closeConnection(name)
        }
    }

    /**
     * Check if a connection exists for a config name.
     */
    hasConnection(configName: string): boolean {

        return this.connections.has(configName)
    }

    /**
     * Get the number of active connections.
     */
    get size(): number {

        return this.connections.size
    }
}


// Singleton instance
let instance: ConnectionManager | null = null


/**
 * Get the global ConnectionManager instance.
 *
 * @example
 * ```typescript
 * const manager = getConnectionManager()
 * const conn = await manager.getConnection(config)
 * ```
 */
export function getConnectionManager(): ConnectionManager {

    if (!instance) {

        instance = new ConnectionManager()
    }
    return instance
}


/**
 * Reset the global ConnectionManager (closes all connections).
 *
 * Primarily for testing.
 *
 * @example
 * ```typescript
 * afterEach(async () => {
 *     await resetConnectionManager()
 * })
 * ```
 */
export async function resetConnectionManager(): Promise<void> {

    if (instance) {

        await instance.closeAll()
        instance = null
    }
}
